import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { desc, eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { contracts, type ContractRow } from "./schema";
import type { AdminContractInput, BrandSlug } from "./types";

export interface WeddingAdminClientConfig {
  /** Same permanent one-brand binding as WeddingClient -- an internal tool
   * deployment still only ever manages its own brand's contracts, matching
   * the rest of this project's brand-isolation architecture (host
   * allowlist, RLS). No cross-brand admin surface in V1. */
  brandSlug: BrandSlug;
  /** Connection string for the wedding_admin role -- more privileged than
   * wedding_app (can insert/update/delete draft|ready|sent rows), but still
   * hard-blocked by RLS from ever touching a signed row. Never reuse the
   * wedding_app connection string here, and never expose this client to a
   * public-facing route. */
  databaseUrl: string;
}

export class ContractNotDraftError extends Error {
  constructor(id: string) {
    super(`Contract "${id}" is not a draft -- this action is only available while status='draft'.`);
    this.name = "ContractNotDraftError";
  }
}

export class ContractNotReleasableError extends Error {
  constructor(id: string, from: string, to: string) {
    super(`Contract "${id}" cannot move from "${from}" to "${to}".`);
    this.name = "ContractNotReleasableError";
  }
}

type Db = NodePgDatabase<Record<string, never>>;

/**
 * Internal-tool-only data access -- deliberately a separate class from
 * WeddingClient, not an extended/shared one, so the public customer routes
 * can never accidentally import admin capabilities (delete, status
 * transitions, unrestricted field edits) through the same import path.
 * Every method still runs inside the same brand-scoping pattern as
 * WeddingClient (set_config('app.current_brand', ...) per transaction).
 */
export class WeddingAdminClient {
  readonly brandSlug: BrandSlug;
  private readonly db: Db;

  constructor(config: WeddingAdminClientConfig) {
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

  async listContracts(): Promise<ContractRow[]> {
    return this.withBrandScope((tx) => tx.select().from(contracts).orderBy(desc(contracts.createdAt)));
  }

  async getContract(id: string): Promise<ContractRow | null> {
    return this.withBrandScope(async (tx) => {
      const rows = await tx.select().from(contracts).where(eq(contracts.id, id));
      return rows[0] ?? null;
    });
  }

  /** Always inserts status='draft' -- the tool has no path that creates a
   * contract in any other state (RLS's admin_insert_draft policy enforces
   * this too, redundantly). */
  async createDraft(input: AdminContractInput): Promise<{ id: string }> {
    return this.withBrandScope(async (tx) => {
      const rows = await tx
        .insert(contracts)
        .values({
          brand: this.brandSlug,
          status: "draft",
          customerName1: input.customerName1,
          customerName2: input.customerName2,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone,
          customerAddress: input.customerAddress,
          packageId: input.packageId,
          packageLabel: input.packageLabel,
          packageServices: input.packageServices,
          packagePriceAmount: input.packagePriceAmount,
          weddingDate: input.weddingDate,
          location: input.location,
          additionalLocations: input.additionalLocations,
          startTime: input.startTime,
          durationLabel: input.durationLabel,
          bookingType: input.bookingType,
          extras: input.extras,
          extrasPriceAmount: input.extrasPriceAmount,
          depositAmount: input.depositAmount,
          customTerms: input.customTerms,
        })
        .returning({ id: contracts.id });
      return { id: rows[0].id };
    });
  }

  /** Only while status='draft' -- once released (ready/sent), edits must go
   * through revertToDraft first (explicit, deliberate step, see
   * architecture doc: "Änderung nur über einen bewusst separaten Schritt"). */
  async updateDraft(id: string, input: AdminContractInput): Promise<void> {
    await this.withBrandScope(async (tx) => {
      const rows = await tx.select().from(contracts).where(eq(contracts.id, id));
      const row = rows[0];
      if (!row) throw new Error(`No contract "${id}" for this brand.`);
      if (row.status !== "draft") throw new ContractNotDraftError(id);

      await tx
        .update(contracts)
        .set({
          customerName1: input.customerName1,
          customerName2: input.customerName2,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone,
          customerAddress: input.customerAddress,
          packageId: input.packageId,
          packageLabel: input.packageLabel,
          packageServices: input.packageServices,
          packagePriceAmount: input.packagePriceAmount,
          weddingDate: input.weddingDate,
          location: input.location,
          additionalLocations: input.additionalLocations,
          startTime: input.startTime,
          durationLabel: input.durationLabel,
          bookingType: input.bookingType,
          extras: input.extras,
          extrasPriceAmount: input.extrasPriceAmount,
          depositAmount: input.depositAmount,
          customTerms: input.customTerms,
          updatedAt: new Date(),
        })
        .where(eq(contracts.id, id));
    });
  }

  /** Only while status='draft' -- matches what the internal list/detail UI
   * offers ("Entwurf löschen" only appears for drafts), enforced again here
   * and once more by RLS's admin_delete_draft_only policy. */
  async deleteDraft(id: string): Promise<void> {
    await this.withBrandScope(async (tx) => {
      const rows = await tx.select().from(contracts).where(eq(contracts.id, id));
      const row = rows[0];
      if (!row) throw new Error(`No contract "${id}" for this brand.`);
      if (row.status !== "draft") throw new ContractNotDraftError(id);
      await tx.delete(contracts).where(eq(contracts.id, id));
    });
  }

  /** draft -> ready. The one deliberate "release" step -- after this, the
   * public link starts working for the customer. */
  async releaseContract(id: string): Promise<void> {
    await this.transition(id, "draft", "ready");
  }

  /** ready -> draft. Only while still 'ready' (not 'sent') -- matches the
   * brief's chosen simpler/safer option: once an email has actually gone
   * out, pulling the contract back to an editable draft would be
   * confusing (the customer already has the "old" link/expectation), so
   * V1 doesn't offer that path at all. */
  async revertToDraft(id: string): Promise<void> {
    await this.transition(id, "ready", "draft");
  }

  /** ready -> sent, recorded the first time the contract is actually
   * emailed. Resending while already 'sent' doesn't call this again (no
   * status change on a resend) -- see the frontend's sendContractAction. */
  async markSent(id: string): Promise<void> {
    await this.transition(id, "ready", "sent");
  }

  private async transition(id: string, from: string, to: string): Promise<void> {
    await this.withBrandScope(async (tx) => {
      const rows = await tx.select().from(contracts).where(eq(contracts.id, id));
      const row = rows[0];
      if (!row) throw new Error(`No contract "${id}" for this brand.`);
      if (row.status !== from) throw new ContractNotReleasableError(id, row.status, to);

      const updated = await tx
        .update(contracts)
        .set({ status: to, updatedAt: new Date() })
        .where(eq(contracts.id, id))
        .returning({ id: contracts.id });
      if (updated.length === 0) throw new ContractNotReleasableError(id, row.status, to);
    });
  }
}

export function createWeddingAdminClient(config: WeddingAdminClientConfig): WeddingAdminClient {
  return new WeddingAdminClient(config);
}
