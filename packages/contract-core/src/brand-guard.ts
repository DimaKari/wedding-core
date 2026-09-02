import type { BrandSlug } from "./types.js";

/**
 * Brand resolution & guard (architecture doc, section L.9.3) — refined now
 * that DIMAX and DKHochzeitArt are confirmed to be two fully independent
 * Next.js apps/repos, never one shared app routing on Host:
 *
 * PRIMARY mechanism: each frontend deployment is permanently bound to one
 * brand via its own `WEDDING_CORE_BRAND` env var, baked in at deploy time —
 * not derived per-request. dimaxwedding_projekt only ever runs with
 * WEDDING_CORE_BRAND=dimax, DKHochzeitArt/Website only ever with
 * WEDDING_CORE_BRAND=dkhochzeitart. A frontend's server code structurally
 * cannot construct a client for the other brand.
 *
 * SECONDARY, defense-in-depth: this allowlist additionally asserts the
 * incoming request's actual Host belongs to the expected brand's domains —
 * catching a misconfigured env var, a misrouted proxy, or a preview
 * deployment sitting on the wrong domain, before any data access happens.
 * `brand_id` is still never taken from the client (body/query/header), and
 * an unrecognized host is a hard reject, never a fallback to any brand.
 */

const HOST_ALLOWLIST: Record<string, BrandSlug> = {
  "dimaxwedding.ch": "dimax",
  "www.dimaxwedding.ch": "dimax",
  "dkhochzeitart.de": "dkhochzeitart",
  "www.dkhochzeitart.de": "dkhochzeitart",
};

export class UnknownHostError extends Error {
  constructor(public readonly host: string) {
    super(`Unrecognized host, not on the brand allowlist: "${host}"`);
    this.name = "UnknownHostError";
  }
}

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
  return host.toLowerCase().split(":")[0]; // strip a possible :port
}

/** Dev-only override — never read in production, guarded explicitly rather
 * than by relying on the env var simply being absent in prod. */
function devOverrideBrand(): BrandSlug | null {
  if (process.env.NODE_ENV === "production") return null;
  const v = process.env.WEDDING_CORE_DEV_BRAND;
  return v === "dimax" || v === "dkhochzeitart" ? v : null;
}

/** Looks up which brand a host belongs to, per the static allowlist only. */
export function resolveBrandFromHost(host: string): BrandSlug {
  const dev = devOverrideBrand();
  if (dev) return dev;

  const brand = HOST_ALLOWLIST[normalizeHost(host)];
  if (!brand) throw new UnknownHostError(host);
  return brand;
}

/**
 * The defense-in-depth check a frontend's middleware/route handler should
 * run once per request: confirm the Host actually matches the brand this
 * deployment believes it is (from WEDDING_CORE_BRAND), before touching the
 * database at all.
 */
export function assertHostMatchesBrand(host: string, expectedBrand: BrandSlug): void {
  const dev = devOverrideBrand();
  if (dev) return; // dev override already bypasses host-based resolution entirely

  const normalized = normalizeHost(host);
  const actual = HOST_ALLOWLIST[normalized] ?? null;
  if (actual !== expectedBrand) {
    throw new BrandHostMismatchError(host, expectedBrand, actual);
  }
}
