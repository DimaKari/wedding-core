export type BrandSlug = "dimax" | "dkhochzeitart";

export type ContractStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "signed"
  | "completed"
  | "cancelled";

/**
 * Structured content facts frozen into contract_versions.content_snapshot —
 * deliberately NOT raw rendered HTML (architecture doc, section F), so the
 * hash stays stable against irrelevant formatting/markup changes and the
 * archive PDF can be regenerated identically from this JSON alone, years
 * later, independent of how the marketing site looks by then.
 */
export interface ContentSnapshot {
  contractId: string;
  brandSlug: BrandSlug;
  version: number;
  customer: {
    names: string;
    email: string;
  };
  packageId: string;
  weddingDate: string | null; // ISO date, or null if not yet fixed
  location: string | null;
  priceCents: number;
  depositCents: number | null;
  extras: unknown[];
  customTerms: Record<string, unknown>;
  /** The exact legal/terms text this snapshot was built against, frozen verbatim. */
  legalText: string;
  frozenAt: string; // ISO timestamp, server-generated
}

/** What the signing step records — the drawn signature is one input among
 * several, never the sole evidence (architecture doc, section G). */
export interface SignatureRecord {
  signerNameTyped: string;
  /** Vector stroke data, not a raster image — points with timestamps. */
  strokes: Array<{ x: number; y: number; t: number }>;
  consents: Record<string, boolean>;
  ipAddress: string | null;
  userAgent: string | null;
  signedAt: string; // ISO timestamp, server-generated
}

export type ContractEventType =
  | "created"
  | "sent"
  | "viewed"
  | "signed"
  | "completed"
  | "cancelled"
  | "redacted";
