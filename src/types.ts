export type BrandSlug = "dimax" | "dkhochzeitart";

export type ContractStatus = "draft" | "signed";

/**
 * Frozen at signing, stored in contracts.content_snapshot — structured
 * content facts, NEVER raw rendered HTML, so the hash stays stable against
 * irrelevant markup/formatting changes and the post-signing view stays
 * reproducible independent of how the live site's template code evolves
 * later. `legalText` is a frozen plain-text/markdown copy of the contract
 * terms shown at signing — capturing that here (not just the data fields)
 * is what makes "render exclusively from content_snapshot after signing"
 * actually immutable, since the frontend's template component could
 * otherwise change later.
 */
export interface ContentSnapshot {
  brand: BrandSlug;
  packageId: string;
  packageLabel: string;
  priceChf: number;
  weddingDate: string | null;
  location: string | null;
  customTerms: Record<string, unknown>;
  customer: {
    names: string;
    email: string;
    phone: string | null;
  };
  legalText: string;
  signedAt: string; // ISO timestamp
}

export interface SignatureInput {
  signerNameTyped: string;
  /** Vector stroke data, not a raster image. */
  strokes: Array<{ x: number; y: number; t: number }>;
  consents: Record<string, boolean>;
  ipAddress: string | null;
  userAgent: string | null;
  /** The legal text shown to the customer at the moment of signing —
   * supplied by the frontend's own per-brand template, frozen verbatim
   * into the snapshot. This module has no opinion on brand-specific wording. */
  legalText: string;
}

export interface CustomerDataInput {
  names: string;
  email: string;
  phone: string | null;
  weddingDate: string | null;
  location: string | null;
}
