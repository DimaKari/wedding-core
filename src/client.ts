import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { contracts, type ContractRow } from "./schema";
import { hashSnapshot } from "./snapshot";
import type { BrandSlug, ContentSnapshot, CustomerDataInput, SignatureInput } from "./types";

export interface WeddingClientConfig {
  /** The single brand this deployment is permanently bound to — never
   * derived per-request (see brand-guard.ts). */
  brandSlug: BrandSlug;
  /** Connection string for the low-privilege `wedding_app` role — never a
   * service_role/admin/table-owner connection string. */
  databaseUrl: string;
}

export class ContractNotFoundError extends Error {
  constructor(id: string) {
    super(`No contract "${id}" for this brand.`);
    this.name = "ContractNotFoundError";
  }
}

export class ContractAlreadySignedError extends Error {
  constructor(id: string) {
    super(`Contract "${id}" is already signed and is read-only.`);
    this.name = "ContractAlreadySignedError";
  }
}

/** Thrown when the public customer flow (saveCustomerData/signContract) is
 * called on a contract that's still status='draft' -- i.e. internal staff
 * haven't released it yet. The frontend page itself already gates on this
 * (a draft's public link shows a neutral "not released yet" message and
 * never renders the form at all), so reaching this in practice means the
 * link was opened/guessed before release -- this is the defense-in-depth
 * check at the data layer, same principle as ContractAlreadySignedError. */
export class ContractNotReadyError extends Error {
  constructor(id: string) {
    super(`Contract "${id}" has not been released yet.`);
    this.name = "ContractNotReadyError";
  }
}

type Db = NodePgDatabase<Record<string, never>>;

/**
 * Brand-bound, minimal data-access client — exactly the three methods
 * approved in architecture doc section M.7: getContract, saveCustomerData,
 * signContract. Every method runs inside `withBrandScope`, which sets the
 * Postgres session variable the RLS policies key on — the server-side
 * enforced tenant filter, independent of (and in addition to) RLS itself.
 * A signed contract is additionally read-only at the database level (see
 * migrations/0001_init.sql, tenant_update_draft_only policy) — the
 * ContractAlreadySignedError thrown here is a clear early error, not the
 * only thing standing between a bug and an overwrite.
 */
export class WeddingClient {
  readonly brandSlug: BrandSlug;
  private readonly db: Db;

  constructor(config: WeddingClientConfig) {
    this.brandSlug = config.brandSlug;
    const pool = new Pool({ connectionString: config.databaseUrl });
    this.db = drizzle(pool);
  }

  private async withBrandScope<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_brand', ${this.brandSlug}, true)`);
      return fn(tx as unknown as Db);
    });
  }

  /** Read-only fetch by id (= the private link token). Returns null if the
   * row doesn't exist or belongs to a different brand (RLS hides it either way). */
  async getContract(id: string): Promise<ContractRow | null> {
    return this.withBrandScope(async (tx) => {
      const rows = await tx.select().from(contracts).where(eq(contracts.id, id));
      return rows[0] ?? null;
    });
  }

  /** Updates customer-completable fields. Refuses once status='signed' —
   * checked here for a clear error, enforced again at the database level
   * regardless (tenant_update_draft_only). Uses a plain SELECT (not `FOR
   * UPDATE`) to read the current row: Postgres RLS requires a locking
   * SELECT to *also* satisfy the UPDATE policy's USING clause, which for
   * an already-signed row (status != 'draft') makes the row invisible to
   * `FOR UPDATE` entirely — surfacing as a wrong "not found" instead of
   * "already signed". Concurrency safety doesn't need the lock anyway: the
   * UPDATE statement below is itself atomic under Postgres's normal
   * row-level locking, re-checking `status='draft'` against the committed
   * row, which is exactly what `updated.length === 0` below detects. */
  async saveCustomerData(id: string, input: CustomerDataInput): Promise<void> {
    await this.withBrandScope(async (tx) => {
      const rows = await tx.select().from(contracts).where(eq(contracts.id, id));
      const row = rows[0];
      if (!row) throw new ContractNotFoundError(id);
      if (row.status === "draft") throw new ContractNotReadyError(id);
      if (row.status === "signed") throw new ContractAlreadySignedError(id);

      const updated = await tx
        .update(contracts)
        .set({
          customerName1: input.name1,
          customerName2: input.name2,
          customerEmail: input.email,
          customerPhone: input.phone,
          customerAddress: input.address,
          weddingDate: input.weddingDate,
          location: input.location,
          updatedAt: new Date(),
        })
        .where(eq(contracts.id, id))
        .returning({ id: contracts.id });

      if (updated.length === 0) throw new ContractAlreadySignedError(id);
    });
  }

  /**
   * Freezes the current row into content_snapshot (structured JSON, never
   * raw HTML — includes a verbatim copy of the legal text the customer saw,
   * so the post-signing view stays immutable even if the frontend's
   * template code changes later), hashes it, records the signature, and
   * flips status to 'signed' — all in one transaction. Concurrency safety
   * comes from the final UPDATE statement's own atomicity under Postgres's
   * normal row-level locking (re-checked against `status='draft'` at
   * commit time), not from an explicit `FOR UPDATE` lock on the initial
   * read — see the comment on saveCustomerData for why `FOR UPDATE` is
   * deliberately not used here (it interacts badly with the
   * status-conditional RLS UPDATE policy).
   */
  async signContract(id: string, input: SignatureInput): Promise<{ contentHash: string }> {
    return this.withBrandScope(async (tx) => {
      const rows = await tx.select().from(contracts).where(eq(contracts.id, id));
      const row = rows[0];
      if (!row) throw new ContractNotFoundError(id);
      if (row.status === "draft") throw new ContractNotReadyError(id);
      if (row.status === "signed") throw new ContractAlreadySignedError(id);

      const signedAt = new Date();
      const snapshot: ContentSnapshot = {
        brand: row.brand as BrandSlug,
        packageId: row.packageId,
        packageLabel: row.packageLabel,
        packageServices: (row.packageServices as string[]) ?? [],
        packagePriceAmount: row.packagePriceAmount,
        extras: (row.extras as string[]) ?? [],
        extrasPriceAmount: row.extrasPriceAmount,
        depositAmount: row.depositAmount,
        weddingDate: row.weddingDate,
        location: row.location,
        additionalLocations: row.additionalLocations,
        startTime: row.startTime,
        durationLabel: row.durationLabel,
        bookingType: row.bookingType as ContentSnapshot["bookingType"],
        customTerms: (row.customTerms as Record<string, unknown>) ?? {},
        customer: {
          name1: row.customerName1 ?? "",
          name2: row.customerName2,
          email: row.customerEmail ?? "",
          phone: row.customerPhone,
          address: row.customerAddress,
        },
        legalText: input.legalText,
        signedAt: signedAt.toISOString(),
      };
      const contentHash = hashSnapshot(snapshot);

      const updated = await tx
        .update(contracts)
        .set({
          contentSnapshot: snapshot,
          contentHash,
          signerNameTyped: input.signerNameTyped,
          signatureStrokes: input.strokes,
          consents: input.consents,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          signedAt,
          status: "signed",
          updatedAt: signedAt,
        })
        .where(eq(contracts.id, id))
        .returning({ id: contracts.id });

      if (updated.length === 0) throw new ContractAlreadySignedError(id);
      return { contentHash };
    });
  }
}

export function createWeddingClient(config: WeddingClientConfig): WeddingClient {
  return new WeddingClient(config);
}
