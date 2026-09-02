import { createHash } from "node:crypto";
import type { ContentSnapshot } from "./types.js";

/** Recursively sorts object keys so the hash is stable regardless of
 * insertion order at any nesting level. */
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

/** SHA-256 over the canonicalized snapshot JSON. */
export function hashSnapshot(snapshot: ContentSnapshot): string {
  const canonical = JSON.stringify(canonicalize(snapshot));
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function verifySnapshotHash(snapshot: ContentSnapshot, expectedHash: string): boolean {
  return hashSnapshot(snapshot) === expectedHash;
}
