/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs';
import { XMLParser } from 'fast-xml-parser';
import { Book } from './model/book';

export interface Module {
  usx: {
    '#text': string;
    '@_version': string;
    book: {
      '#text': string;
      '@_id': string;
      '@_code': string;
    };
    para: {
      '#text': string;
      '@_style': string;
    }[];
  };
}

const alwaysArray = ['usx.para'];

function getElemText(e: any, name: string): string {
  return e[name]?.[0]?.['#text'];
}

function getElemAttr(e: any, attr: string): string {
  return e?.[':@']?.[`@_${attr}`];
}

function getChildText(nodes: any[], name: string, withStyle: string) {
  const elem = nodes.find(
    (x: { [x: string]: any }) => !!x[name] && x[':@']?.['@_style'] === withStyle
  );
  return getElemText(elem, name);
}

export default class UsxParser {
  private parser: XMLParser;

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      ignoreDeclaration: true, // removes '?xml' declarations
      preserveOrder: true,
      trimValues: true,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      isArray: (_tagName, jPathOrMatcher, _isLeafNode, _isAttribute) => {
        return alwaysArray.indexOf(jPathOrMatcher as string) !== -1;
      },
    });
  }

  public static getUsxFiles(moduleId: string): string[] {
    return fs.globSync(`./assets/${moduleId}/*.usx`);
  }

  public parseBook(filename: string): Book {
    const xml: string = fs.readFileSync(filename, 'utf-8');
    const contents = this.parser.parse(xml);
    const usxAttr = contents.find((x: { [x: string]: any }) => !!x[':@']);
    const version = usxAttr?.[':@']?.['@_version'];
    if (version !== '3.0') {
      throw new Error('Only USX version 3.0 files are supported');
    }

    const usxChildren: any[] = usxAttr?.['usx'];
    if (!usxChildren) {
      throw new Error('No usx children found.');
    }

    const usxBook = usxChildren.find((x: { [x: string]: any }) => !!x['book']);
    // console.log(JSON.stringify(hPara, null, 2));
    return {
      name: getElemText(usxBook, 'book'),
      code: getElemAttr(usxBook, 'code'),
      header: getChildText(usxChildren, 'para', 'h'),
      toc1: getChildText(usxChildren, 'para', 'toc1'),
      toc2: getChildText(usxChildren, 'para', 'toc2'),
      toc3: getChildText(usxChildren, 'para', 'toc3'),
      mt1: getChildText(usxChildren, 'para', 'mt1'),
      children: [],
    };
  }
}
