/**
 * Strong's numbers in normal form (docs/lexicon-format.md, "Strong's
 * numbers"): H or G, the number in decimal without leading zeros, and a
 * letter suffix, if any, in lower case. Sources write them in other ways:
 * H0430 in the KJV, 00025 and 25 in Strong's Greek Dictionary.
 */

const STRONG = /^([HGhg])0*([1-9]\d*)([A-Za-z]?)$/;

/** The normal form, or undefined if `raw` isn't a Strong's number. */
export function normalizeStrong(raw: string): string | undefined {
  const match = STRONG.exec(raw.trim());
  if (!match) return undefined;
  return `${match[1].toUpperCase()}${match[2]}${match[3].toLowerCase()}`;
}

/** True if `value` is already a Strong's number in normal form. */
export function isNormalStrong(value: string): boolean {
  return normalizeStrong(value) === value;
}
