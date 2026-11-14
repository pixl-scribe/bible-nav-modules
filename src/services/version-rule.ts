import fs from 'node:fs';
import path from 'node:path';

/**
 * The versioning rule from "Module versions" in docs/integrity-spec.md: the
 * major version changes whenever the text root changes, so every version
 * with the same major number has the same text. Bible Nav pins its bundled
 * texts by module id and major version, so a release that broke this rule
 * would be refused.
 */

/** The major version of `major.minor.patch`, or undefined if malformed. */
export function majorVersion(version: string): number | undefined {
  const match = /^(\d+)\.\d+\.\d+$/.exec(version);
  return match ? Number(match[1]) : undefined;
}

/**
 * Checks a new version's text root against the other exports of the same
 * module in `exportsDir`. Throws if one with the same major version has a
 * different text root, saying to raise the major version.
 */
export function checkVersionRule(
  exportsDir: string,
  moduleId: string,
  version: string,
  textRoot: string
): void {
  const major = majorVersion(version);
  if (major === undefined) {
    throw new Error(
      `Version ${version} must be written major.minor.patch, such as 1.2.0.`
    );
  }
  const prefix = `${moduleId}-`;
  const suffix = '.manifest.json';
  for (const name of fs.readdirSync(exportsDir)) {
    if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue;
    const other = name.slice(prefix.length, -suffix.length);
    if (other === version || majorVersion(other) !== major) continue;
    const manifest = JSON.parse(
      fs.readFileSync(path.join(exportsDir, name), 'utf8')
    ) as { text?: { textRoot?: string } };
    if (manifest.text?.textRoot !== textRoot) {
      throw new Error(
        `The text of ${moduleId} ${version} differs from ${moduleId} ${other}, ` +
          `but they share major version ${major}. A change to the text needs a ` +
          `new major version (${major + 1}.0.0): Bible Nav pins each major ` +
          `version's text and would refuse this one.`
      );
    }
  }
}
