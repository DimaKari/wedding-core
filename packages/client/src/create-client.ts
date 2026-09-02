import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "@wedding-core/db";
import { assertHostMatchesBrand, type BrandSlug } from "@wedding-core/contract-core";

export interface WeddingCoreClientConfig {
  /** The single brand this deployment is permanently bound to — baked in via
   * each frontend's own WEDDING_CORE_BRAND env var, never derived
   * per-request (architecture doc, section L.9.3). */
  brandSlug: BrandSlug;
  /** Connection string for the low-privilege `wedding_core_app` role —
   * never a service_role/admin connection string. */
  databaseUrl: string;
}

export type WeddingCoreDb = NodePgDatabase<typeof schema>;

/**
 * Phase 0 skeleton. Deliberately does NOT yet expose contract/customer
 * data-access methods (getContract, createContractDraft, recordEvent, …) —
 * those land once the signing flow is actually built. What's here is the
 * one piece that must exist before any of that: a connection that is bound
 * to exactly one brand at construction time and cannot silently query
 * another, with `withBrandScope` as the single choke point every future
 * method must go through.
 */
export class WeddingCoreClient {
  readonly brandSlug: BrandSlug;
  private readonly db: WeddingCoreDb;
  private brandId: string | null = null;

  private constructor(brandSlug: BrandSlug, db: WeddingCoreDb) {
    this.brandSlug = brandSlug;
    this.db = db;
  }

  static async create(config: WeddingCoreClientConfig): Promise<WeddingCoreClient> {
    const pool = new Pool({ connectionString: config.databaseUrl });
    const db = drizzle(pool, { schema });
    const client = new WeddingCoreClient(config.brandSlug, db);
    await client.loadBrandId();
    return client;
  }

  private async loadBrandId(): Promise<void> {
    const row = await this.db.query.brands.findFirst({
      where: (b, { eq }) => eq(b.slug, this.brandSlug),
    });
    if (!row) {
      throw new Error(
        `No "brands" row for slug "${this.brandSlug}" — has migrations/0001_init.sql run yet?`,
      );
    }
    this.brandId = row.id;
  }

  /**
   * Runs `fn` inside a transaction with the Postgres session variable
   * `app.current_brand_id` set to this client's brand — the server-side
   * enforced tenant filter, independent of (and in addition to) the RLS
   * policies. Every future data-access method on this client must be built
   * on top of this, never on a bare `this.db` query, so brand scoping is
   * structural rather than something a call site could forget.
   */
  async withBrandScope<T>(fn: (tx: WeddingCoreDb) => Promise<T>): Promise<T> {
    if (!this.brandId) await this.loadBrandId();
    const brandId = this.brandId as string;
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_brand_id', ${brandId}, true)`);
      return fn(tx as unknown as WeddingCoreDb);
    });
  }

  /** Defense-in-depth: call once per request (e.g. from middleware) before
   * doing anything else, to catch a misconfigured deployment/proxy early. */
  assertRequestHost(host: string): void {
    assertHostMatchesBrand(host, this.brandSlug);
  }
}

export function createWeddingCoreClient(
  config: WeddingCoreClientConfig,
): Promise<WeddingCoreClient> {
  return WeddingCoreClient.create(config);
}
