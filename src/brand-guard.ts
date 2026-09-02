import type { BrandSlug } from "./types.js";

/**
 * Each frontend is permanently bound to one brand via its own
 * WEDDING_CORE_BRAND env var, baked in at deploy time — never derived
 * per-request. This allowlist is a defense-in-depth check on top of that:
 * confirm the incoming request's Host actually belongs to the expected
 * brand's domains before touching the database at all, catching a
 * misconfigured env var or a misrouted proxy early.
 */

const HOST_ALLOWLIST: Record<string, BrandSlug> = {
  "dimaxwedding.ch": "dimax",
  "www.dimaxwedding.ch": "dimax",
  "dkhochzeitart.de": "dkhochzeitart",
  "www.dkhochzeitart.de": "dkhochzeitart",
};

export class BrandHostMismatchError extends Error {
  constructor(
    public readonly host: string,
    public readonly expectedBrand: BrandSlug,
    public readonly actualBrand: BrandSlug | null,
  ) {
    super(
      `Host "${host}" resolves to brand "${actualBrand ?? "unknown"}", ` +
        `but this deployment is bound to "${expectedBrand}".`,
    );
    this.name = "BrandHostMismatchError";
  }
}

function normalizeHost(host: string): string {
  return host.toLowerCase().split(":")[0];
}

function devOverrideActive(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.WEDDING_CORE_DEV_BRAND != null;
}

/** Call once per request (e.g. in a layout or the page itself) before doing
 * anything else, to catch a misconfigured deployment early. */
export function assertHostMatchesBrand(host: string, expectedBrand: BrandSlug): void {
  if (devOverrideActive()) return; // local dev, see WEDDING_CORE_DEV_BRAND
  const actual = HOST_ALLOWLIST[normalizeHost(host)] ?? null;
  if (actual !== expectedBrand) {
    throw new BrandHostMismatchError(host, expectedBrand, actual);
  }
}
