import { createHash } from "node:crypto";
import type { ContentSnapshot } from "./types.js";

/**
 * Recursively sorts object keys so the hash is stable regardless of
 * insertion order at any nesting level — JSON.stringify alone only
 * preserves whatever order the object was built in, which is not a safe
 * basis for a hash meant to stand as legal evidence.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize(obj[key]);
        return acc;
      }, {});
  }
  return value;
}

/** SHA-256 over the canonicalized snapshot JSON. Deterministic: the same
 * logical content always hashes identically, independent of key order. */
export function hashSnapshot(snapshot: ContentSnapshot): string {
  const canonical = JSON.stringify(canonicalize(snapshot));
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Re-hashes and compares — the primitive that both the completion flow and
 * any later "verify this archived contract" tooling should share, so there
 * is exactly one implementation of what "the hash matches" means. */
export function verifySnapshotHash(snapshot: ContentSnapshot, expectedHash: string): boolean {
  return hashSnapshot(snapshot) === expectedHash;
}
