export type BrandSlug = "dimax" | "dkhochzeitart";

/**
 * draft  -- created internally, editable, public link inert.
 * ready  -- internally reviewed and released; public link now works, no
 *           email sent yet.
 * sent   -- same as ready for the customer-facing flow; internal
 *           bookkeeping only ("we emailed them").
 * signed -- final, read-only.
 */
export type ContractStatus = "draft" | "ready" | "sent" | "signed";

export type BookingType = "photo" | "video" | "photo_and_video";

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
 *
 * Amounts are currency-neutral numbers — the brand determines the currency
 * (CHF for dimax, EUR for dkhochzeitart), applied by each frontend's own
 * formatting, not stored here.
 */
export interface ContentSnapshot {
  brand: BrandSlug;
  packageId: string;
  packageLabel: string;
  packageServices: string[];
  packagePriceAmount: number;
  extras: string[];
  extrasPriceAmount: number;
  /** Anzahlung. Restbetrag = (packagePriceAmount + extrasPriceAmount) -
   * depositAmount, computed at render time, not stored separately —
   * avoids numbers drifting apart. */
  depositAmount: number | null;
  weddingDate: string | null;
  location: string | null;
  additionalLocations: string | null;
  startTime: string | null;
  durationLabel: string | null;
  bookingType: BookingType | null;
  customTerms: Record<string, unknown>;
  customer: {
    name1: string;
    name2: string | null;
    email: string;
    phone: string | null;
    address: string | null;
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
  name1: string;
  name2: string | null;
  email: string;
  phone: string | null;
  address: string | null;
  weddingDate: string | null;
  location: string | null;
}

/**
 * Everything the internal tool sets when staff create or edit a draft --
 * deliberately a separate shape from CustomerDataInput, which only covers
 * the few fields the customer themselves may fill in once a contract is
 * released. Booking specifics (package, price, wedding date, ...) are only
 * ever set here, never by the public customer flow.
 */
export interface AdminContractInput {
  customerName1: string;
  customerName2: string | null;
  customerEmail: string;
  customerPhone: string | null;
  customerAddress: string | null;
  packageId: string;
  packageLabel: string;
  packageServices: string[];
  packagePriceAmount: number;
  weddingDate: string | null;
  location: string | null;
  additionalLocations: string | null;
  startTime: string | null;
  durationLabel: string | null;
  bookingType: BookingType | null;
  extras: string[];
  extrasPriceAmount: number;
  depositAmount: number | null;
  customTerms: Record<string, unknown>;
}
