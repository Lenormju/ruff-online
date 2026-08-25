export interface VersionEntry {
  version: string;
  wasmUrl: string;
  rulesPath: string;
}

/**
 * Numeric, dot-component-wise comparison of two version strings (e.g.
 * "0.16.4"). Standard comparator semantics: negative if a<b, positive if
 * a>b, 0 if equal.
 *
 * Deliberately NOT a string comparison: `"0.10.0" < "0.9.0"` lexicographically
 * (since "1" < "9"), but numerically 0.10.0 > 0.9.0.
 */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  const length = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < length; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

let versionsPromise: Promise<VersionEntry[]> | null = null;

export async function getVersions(): Promise<VersionEntry[]> {
  if (!versionsPromise) {
    versionsPromise = fetch(`${import.meta.env.BASE_URL}supported-versions.json`).then((res) =>
      res.json() as Promise<VersionEntry[]>,
    );
  }
  return versionsPromise;
}

export async function getLatestVersion(): Promise<VersionEntry> {
  const versions = await getVersions();
  if (versions.length === 0) {
    throw new Error("No supported Ruff versions found in supported-versions.json");
  }
  return versions.reduce((latest, entry) =>
    compareVersions(entry.version, latest.version) > 0 ? entry : latest,
  );
}
