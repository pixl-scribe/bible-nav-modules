import fs from 'node:fs';
import path from 'node:path';
import ModuleConfigService from './services/module-config-service';
import { moduleFiles } from './services/manifest-service';
import { checkSignatures, parseSignatures } from './services/signing-service';
import {
  CatalogEntry,
  gzipModule,
  readCatalog,
  RELEASE_BASE,
  sha256,
  statementsIn,
  withEntry,
  writeCatalog,
} from './services/catalog-service';
import ModuleFactory from './module-factory';
import { primaryKeys, STATEMENTS_FOLDER } from './keys';

/** Where packaged modules are written, ready to upload to a release. */
const DIST = 'dist';
const CATALOG = 'catalog.json';

export default class CatalogFactory {
  /**
   * Prepares a module for download (docs/catalog.md): checks it against the
   * USX and its manifest and signatures, requires the maintainer's primary
   * signature (release builds trust no other key), writes the compressed
   * module and its manifest and signatures to dist/, and adds its entry to
   * catalog.json, with every signed key statement.
   */
  public static package(moduleId: string): void {
    ModuleFactory.verify(moduleId);
    const config = ModuleConfigService.getModuleConfig(moduleId);
    const files = moduleFiles(
      path.resolve('exports'),
      moduleId,
      config.version
    );
    const manifest = fs.readFileSync(files.manifest);
    const signatures = fs.readFileSync(files.signatures, 'utf8');
    const primary = checkSignatures(
      manifest,
      parseSignatures(signatures),
      primaryKeys()
    );
    if (primary.valid.length === 0) {
      throw new Error(
        `${path.basename(files.manifest)} isn't signed with the primary key, ` +
          "so release builds of Bible Nav wouldn't load it. Sign it first: " +
          `npm start -- sign --id ${moduleId}`
      );
    }

    fs.mkdirSync(DIST, { recursive: true });
    const base = path.basename(files.db);
    const gzName = `${base}.gz`;
    const compressed = gzipModule(files.db, path.join(DIST, gzName));
    fs.copyFileSync(
      files.manifest,
      path.join(DIST, path.basename(files.manifest))
    );
    fs.copyFileSync(
      files.signatures,
      path.join(DIST, path.basename(files.signatures))
    );

    const tag = `${moduleId}-${config.version}`;
    const entry: CatalogEntry = {
      manifest: manifest.toString('utf8'),
      signatures,
      download: {
        name: gzName,
        size: compressed.length,
        sha256: sha256(compressed),
        urls: [`${RELEASE_BASE}/${tag}/${gzName}`],
      },
      about: {
        description: config.description.trim(),
        language: config.language,
        license: config.license,
      },
    };
    const catalog = withEntry(readCatalog(CATALOG), entry);
    catalog.statements = statementsIn(STATEMENTS_FOLDER);
    writeCatalog(CATALOG, catalog);

    console.log(
      `Wrote ${DIST}/${gzName} (${compressed.length} bytes), its manifest and signatures, and the ${tag} entry in ${CATALOG}.`
    );
    console.log(
      'To publish, upload them as a release, then commit catalog.json:'
    );
    console.log(
      `  gh release create ${tag} ${DIST}/${gzName} ${DIST}/${path.basename(files.manifest)} ${DIST}/${path.basename(files.signatures)} --title "${config.name} ${config.version}"`
    );
  }
}
