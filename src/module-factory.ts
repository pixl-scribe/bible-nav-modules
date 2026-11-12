import fs from 'fs';
import path from 'path';
import { createPrivateKey, createPublicKey, KeyObject } from 'crypto';
import UsxParserService from './services/usx-parser-service';
import {
  DbExporterService,
  MODULE_FORMAT_VERSION,
} from './services/db-exporter-service';
import { VerseCountService } from './services/verse-count-service';
import ModuleConfigService from './services/module-config-service';
import { verifyModule } from './services/module-verifier-service';
import { TestamentVerseCounts } from './model/bible-verse-counts';
import { Book, Paragraph } from './model/book';
import { moduleRoots } from './services/text-tree-service';
import {
  buildManifest,
  fileSha256,
  Manifest,
  MANIFEST_TYPE,
  manifestBytes,
  moduleFiles,
} from './services/manifest-service';
import {
  addSignature,
  checkSignatures,
  formatSignatures,
  keyId,
  parseSignatures,
  readPrivateKey,
  signManifest,
} from './services/signing-service';

/**
 * Tracks position across books while exporting. paragraph numbers are global,
 * and each heading records the verse it follows.
 */
export interface ExportPosition {
  paragraph: number;
  lastVerseId: number;
}

/**
 * The development key: public by design, so anyone can build and test. Only
 * development builds of Bible Nav accept it.
 */
const DEVELOPMENT_KEY = path.join('keys', 'development', 'private.pem');

/**
 * Public keys `verify` checks signatures with, where present: the development
 * key, and the maintainer's primary and backup keys once they exist.
 */
const PUBLIC_KEYS = ['development', 'primary', 'backup'].map((role) =>
  path.join('keys', role, 'public.pem')
);

export default class ModuleFactory {
  /**
   * Writes the module to a temporary file and keeps it only after it matches
   * the USX, so a failure can't leave a bad export behind. Then writes its
   * manifest and signs that with the development key.
   */
  public static async generate(moduleId: string): Promise<void> {
    const config = ModuleConfigService.getModuleConfig(moduleId);
    const files = moduleFiles(
      path.resolve('exports'),
      moduleId,
      config.version
    );
    const tempFile = `${files.db}.tmp`;

    try {
      await ModuleFactory.writeModule(moduleId, tempFile);
      const summary = verifyModule(tempFile, path.resolve('assets', moduleId));
      console.log(
        `Verified ${summary.books} books, ${summary.paragraphs} paragraphs, ${summary.verses} verses, and ${summary.headings} headings against the USX.`
      );
      const roots = moduleRoots(tempFile);
      const manifest = buildManifest(
        moduleId,
        config,
        tempFile,
        path.basename(files.db),
        roots,
        new Date()
      );
      const bytes = manifestBytes(manifest);
      const developmentKey = createPrivateKey(
        fs.readFileSync(path.resolve(DEVELOPMENT_KEY))
      );

      fs.renameSync(tempFile, files.db);
      fs.writeFileSync(files.manifest, bytes);
      // A new manifest makes every earlier signature invalid, so start the
      // signature file again.
      fs.writeFileSync(
        files.signatures,
        formatSignatures([signManifest(bytes, developmentKey)])
      );
      console.log(`Text root:    ${roots.textRoot}`);
      console.log(`Content root: ${roots.contentRoot}`);
      console.log(`File SHA-256: ${manifest.file.sha256}`);
      console.log(
        `Wrote ${path.basename(files.db)} with its manifest, signed with the development key.`
      );
    } finally {
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        fs.rmSync(`${tempFile}${suffix}`, { force: true });
      }
    }
  }

  /**
   * Checks an existing export against the USX, and its manifest and
   * signatures against the module, without changing anything.
   */
  public static verify(moduleId: string): void {
    const config = ModuleConfigService.getModuleConfig(moduleId);
    const files = moduleFiles(
      path.resolve('exports'),
      moduleId,
      config.version
    );
    const summary = verifyModule(files.db, path.resolve('assets', moduleId));
    console.log(
      `Verified ${summary.books} books, ${summary.paragraphs} paragraphs, ${summary.verses} verses, and ${summary.headings} headings against the USX.`
    );
    const manifest = ModuleFactory.checkManifest(
      moduleId,
      config.version,
      files
    );
    console.log(
      `The manifest matches the module (text root ${manifest.text.textRoot}).`
    );

    const signatures = checkSignatures(
      fs.readFileSync(files.manifest),
      parseSignatures(fs.readFileSync(files.signatures, 'utf8')),
      ModuleFactory.publicKeys()
    );
    for (const id of signatures.valid) console.log(`Valid signature: ${id}`);
    for (const id of signatures.unknown) {
      console.log(`Signature by a key not in keys/: ${id}`);
    }
    if (signatures.invalid.length > 0) {
      throw new Error(
        `Invalid signatures by: ${signatures.invalid.join(', ')}`
      );
    }
    if (signatures.valid.length === 0) {
      throw new Error('The manifest has no valid signature from a known key.');
    }
  }

  /**
   * Adds a signature to a module's manifest, after checking the module, so a
   * key never signs a module that doesn't match the USX and its manifest.
   *
   * @param keyFile a PEM Ed25519 private key file. Without one (or with
   *   '-'), the key is read from standard input, so it never has to be
   *   written to disk.
   */
  public static async sign(moduleId: string, keyFile?: string): Promise<void> {
    ModuleFactory.verifyBeforeSigning(moduleId);
    const config = ModuleConfigService.getModuleConfig(moduleId);
    const files = moduleFiles(
      path.resolve('exports'),
      moduleId,
      config.version
    );
    const fromStdin = keyFile === undefined || keyFile === '-';
    if (fromStdin && process.stdin.isTTY) {
      console.error('Paste the private key PEM, then press Enter and Ctrl+D.');
    }
    const pem = fromStdin ? await readStdin() : fs.readFileSync(keyFile);
    const privateKey = readPrivateKey(pem);
    const line = signManifest(fs.readFileSync(files.manifest), privateKey);
    addSignature(files.signatures, line);
    console.log(
      `Signed ${path.basename(files.manifest)} with key ${line.keyId}.`
    );
  }

  private static verifyBeforeSigning(moduleId: string): void {
    const config = ModuleConfigService.getModuleConfig(moduleId);
    const files = moduleFiles(
      path.resolve('exports'),
      moduleId,
      config.version
    );
    verifyModule(files.db, path.resolve('assets', moduleId));
    ModuleFactory.checkManifest(moduleId, config.version, files);
  }

  /** Checks a manifest against its module: identity, file hash, and roots. */
  private static checkManifest(
    moduleId: string,
    version: string,
    files: ReturnType<typeof moduleFiles>
  ): Manifest {
    const manifest = JSON.parse(
      fs.readFileSync(files.manifest, 'utf8')
    ) as Manifest;
    const problems: string[] = [];
    const expect = (what: string, actual: unknown, wanted: unknown) => {
      if (actual !== wanted) {
        problems.push(
          `${what} is ${String(actual)}, expected ${String(wanted)}`
        );
      }
    };
    expect('type', manifest.type, MANIFEST_TYPE);
    expect('manifestVersion', manifest.manifestVersion, 1);
    expect('module.id', manifest.module?.id, moduleId);
    expect('module.version', manifest.module?.version, version);
    expect(
      'module.formatVersion',
      manifest.module?.formatVersion,
      MODULE_FORMAT_VERSION
    );
    expect('file.name', manifest.file?.name, path.basename(files.db));
    expect('file.size', manifest.file?.size, fs.statSync(files.db).size);
    expect('file.sha256', manifest.file?.sha256, fileSha256(files.db));
    const roots = moduleRoots(files.db);
    expect('text.textRoot', manifest.text?.textRoot, roots.textRoot);
    expect('text.contentRoot', manifest.text?.contentRoot, roots.contentRoot);
    if (problems.length > 0) {
      throw new Error(
        `The manifest doesn't match the module:\n  ${problems.join('\n  ')}`
      );
    }
    return manifest;
  }

  private static publicKeys(): KeyObject[] {
    return PUBLIC_KEYS.map((file) => path.resolve(file))
      .filter((file) => fs.existsSync(file))
      .map((file) => {
        const key = createPublicKey(fs.readFileSync(file));
        keyId(key); // Fails for anything but an Ed25519 key.
        return key;
      });
  }

  private static async writeModule(
    moduleId: string,
    dbFile: string
  ): Promise<void> {
    const dbExporter = new DbExporterService(dbFile);

    console.log(`Generating module ${moduleId}...`);
    const config = ModuleConfigService.getModuleConfig(moduleId);
    console.log(`Name:    ${config.name}`);
    console.log(`Version: ${config.version}`);
    dbExporter.exportModule(config);

    const verseCounts = VerseCountService.getVerseCounts();
    const position: ExportPosition = { paragraph: 0, lastVerseId: 0 };

    for (const testament of config.testamentsIncluded) {
      let chapters: TestamentVerseCounts | undefined = undefined;
      switch (testament) {
        case 'OT':
          chapters = verseCounts.OT;
          break;
        case 'NT':
          chapters = verseCounts.NT;
          break;
      }
      if (testament === 'OT' || testament === 'NT') {
        dbExporter.exportTestament(testament);
      }
      const usxFiles = UsxParserService.getUsxFiles(moduleId, chapters);

      const usxParser = new UsxParserService();
      for (const usxFile of usxFiles) {
        console.log(`  importing ${usxFile}...`);
        const book = usxParser.parseBook(usxFile);
        ModuleFactory.checkVerseCounts(book, chapters);
        ModuleFactory.exportBook(dbExporter, testament, book, position);
      }
    }

    dbExporter.close();
  }

  /**
   * Fails unless the book has the expected number of chapters, and each
   * chapter the expected number of verses (assets/bible-verse-counts.yaml).
   */
  public static checkVerseCounts(
    book: Book,
    chapters: TestamentVerseCounts | undefined
  ): void {
    const bookVerseCounts = chapters?.[book.code];
    if (bookVerseCounts === undefined) return;
    if (book.chapters.length !== bookVerseCounts.length) {
      throw new Error(
        `Book ${book.code} chapter count of ${book.chapters.length} did not match the expected count of ${bookVerseCounts.length}.`
      );
    }
    book.chapters.forEach((chapter, index) => {
      const expected = bookVerseCounts[index];
      const parsed = chapter.paragraphs.reduce(
        (acc: number, paragraph: Paragraph) => acc + paragraph.verses.length,
        0
      );
      if (expected !== parsed) {
        throw new Error(
          `Chapter ${chapter.sid} verse count of ${parsed} did not match the expected count of ${expected}.`
        );
      }
    });
  }

  public static exportBook(
    dbExporter: DbExporterService,
    testament: string | undefined,
    book: Book,
    position: ExportPosition
  ): void {
    const bookId = dbExporter.exportBook(testament, book);
    for (const chapter of book.chapters) {
      dbExporter.exportChapter(bookId, chapter);
      for (const paragraph of chapter.paragraphs) {
        dbExporter.exportParagraph(
          position.paragraph,
          bookId,
          chapter.nbr,
          paragraph.style
        );
        if (paragraph.heading) {
          dbExporter.exportHeading(
            bookId,
            chapter.nbr,
            position.paragraph,
            position.lastVerseId,
            paragraph.heading
          );
        }
        for (const verse of paragraph.verses) {
          position.lastVerseId = dbExporter.exportVerse(
            bookId,
            chapter.nbr,
            position.paragraph,
            verse
          );
        }
        position.paragraph += 1;
      }
    }
  }
}

/**
 * Reads standard input to its end as a stream. A synchronous read fails with
 * EAGAIN when the terminal is in non-blocking mode, as it is under tsx.
 */
async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks);
}
