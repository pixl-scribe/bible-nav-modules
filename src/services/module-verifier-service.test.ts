import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import Database from 'better-sqlite3';
import ModuleFactory from '../module-factory';
import { DbExporterService } from './db-exporter-service';
import { verifyModule } from './module-verifier-service';
import UsxParserService from './usx-parser-service';
import { ModuleConfig } from '../model/module-config';

const USX = `<?xml version="1.0" encoding="UTF-8"?>
<usx version="3.0"><book style="id" code="TST">The Book of Test</book>
  <para style="h">Test</para>
  <para style="toc1">Long Test</para>
  <para style="toc2">Test</para>
  <para style="toc3">Tst</para>
  <para style="mt1">THE BOOK</para>
  <chapter style="c" number="1" sid="TST 1"/>
  <para style="d">A <char style="w" strong="H1">Psalm</char> of old.</para>
  <para style="p"><verse style="v" number="1" sid="TST 1:1"/>The <char style="nd"><char style="w" strong="H3068">LORD</char></char> is <char style="add">my</char> false guide.<note style="f" caller="+"><char style="fr">1.10 </char><char style="ft">or, the <char style="nd">LORD</char> here</char></note>
<verse eid="TST 1:1"/><verse style="v" number="2" sid="TST 1:2"/><char style="wj">Follow <char style="w" strong="G1">me</char>.</char><verse eid="TST 1:2"/></para>
  <para style="b"/>
  <para style="s1">The <char style="tl">end</char>.</para>
  <chapter eid="TST 1"/>
</usx>
`;

const CONFIG: ModuleConfig = {
  name: 'Test',
  description: 'Test',
  moduleType: 'bible',
  language: 'English',
  languageCode: 'eng',
  license: 'Public Domain',
  version: '1.0.0',
  testamentsIncluded: ['OT'],
};

describe('verifyModule', () => {
  let dir: string;
  let dbFile: string;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'module-verifier-'));
    fs.writeFileSync(path.join(dir, 'tst.usx'), USX);
    dbFile = path.join(dir, 'test.db');
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    const book = new UsxParserService().parseBookXml(USX);
    const exporter = new DbExporterService(dbFile);
    exporter.exportModule({ ...CONFIG, year: 1, fetchId: 'tst' });
    exporter.exportTestament('OT');
    ModuleFactory.exportBook(exporter, 'OT', book, {
      paragraph: 0,
      lastVerseId: 0,
    });
    exporter.close();
  });

  const corrupt = (sql: string, ...params: unknown[]) => {
    const db = new Database(dbFile);
    db.prepare(sql).run(...params);
    db.close();
  };

  test('passes for a faithful module', () => {
    assert.deepEqual(verifyModule(dbFile, dir), {
      books: 1,
      verses: 2,
      headings: 2,
      paragraphs: 4,
    });
  });

  test('catches a wrong paragraph style', () => {
    corrupt("UPDATE paragraphs SET style = 'q1' WHERE style = 'p'");
    assert.throws(() => verifyModule(dbFile, dir), /paragraph 1 is .*"q1"/);
  });

  test('catches a missing stanza break', () => {
    corrupt("DELETE FROM paragraphs WHERE style = 'b'");
    assert.throws(
      () => verifyModule(dbFile, dir),
      /3 paragraphs but the USX has 4/
    );
  });

  test('catches a verse in the wrong paragraph', () => {
    corrupt(
      "UPDATE verses SET paragraph = (SELECT id FROM paragraphs WHERE style = 'b') WHERE sid = 'TST 1:2'"
    );
    assert.throws(() => verifyModule(dbFile, dir), /paragraph 1 is /);
  });

  test('catches a heading in the wrong paragraph', () => {
    corrupt(
      "UPDATE headings SET paragraph = (SELECT id FROM paragraphs WHERE style = 'b') WHERE style = 's1'"
    );
    assert.throws(() => verifyModule(dbFile, dir), /paragraph 2 is /);
  });

  test('leaves no side files next to the module', () => {
    verifyModule(dbFile, dir);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['test.db', 'tst.usx']);
  });

  test('catches a word missing from raw', () => {
    corrupt(
      "UPDATE verses SET raw = 'The is my false guide.' WHERE sid = 'TST 1:1'"
    );
    assert.throws(() => verifyModule(dbFile, dir), /TST 1:1: raw is/);
  });

  test('catches a word missing from children', () => {
    corrupt(
      `UPDATE verses SET children = '["The is ",{"style":"add","children":["my"]}," false guide."]' WHERE sid = 'TST 1:1'`
    );
    assert.throws(
      () => verifyModule(dbFile, dir),
      /TST 1:1: children text differs/
    );
  });

  test("catches a changed Strong's number", () => {
    corrupt(
      "UPDATE verses SET children = replace(children, 'H3068', 'H9999') WHERE sid = 'TST 1:1'"
    );
    assert.throws(
      () => verifyModule(dbFile, dir),
      /TST 1:1: tags or Strong's numbers differ/
    );
  });

  test('catches a damaged footnote reference', () => {
    corrupt(
      `UPDATE verses SET children = replace(children, '"1.10"', '"1.1"') WHERE sid = 'TST 1:1'`
    );
    assert.throws(() => verifyModule(dbFile, dir), /TST 1:1: /);
  });

  test('catches a missing verse', () => {
    corrupt("DELETE FROM verses WHERE sid = 'TST 1:2'");
    assert.throws(() => verifyModule(dbFile, dir), /list or order of verses/);
  });

  test('catches a missing heading', () => {
    corrupt("DELETE FROM headings WHERE style = 's1'");
    assert.throws(
      () => verifyModule(dbFile, dir),
      /1 headings but the USX has 2/
    );
  });

  test('catches a misplaced heading', () => {
    corrupt("UPDATE headings SET afterVerseId = 1 WHERE style = 'd'");
    assert.throws(() => verifyModule(dbFile, dir), /wrong style or position/);
  });

  test('catches an unknown place for text in the USX', () => {
    fs.writeFileSync(
      path.join(dir, 'tst.usx'),
      USX.replace('<para style="b"/>', '<para style="zzz">stray</para>')
    );
    try {
      assert.throws(() => verifyModule(dbFile, dir), /outside any known place/);
    } finally {
      fs.writeFileSync(path.join(dir, 'tst.usx'), USX);
    }
  });
});
