/**
 * Drizzle schema mirroring migrations/0001_init.sql — the SQL migration is
 * the source of truth (RLS, roles, grants aren't expressible here), this is
 * just the typed reflection for query-building.
 */
import { pgTable, uuid, text, integer, date, jsonb, timestamp, inet } from "drizzle-orm/pg-core";

export const contracts = pgTable("contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  brand: text("brand").notNull(),
  status: text("status").notNull().default("draft"),

  customerNames: text("customer_names"),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone"),

  packageId: text("package_id").notNull(),
  packageLabel: text("package_label").notNull(),
  priceChf: integer("price_chf").notNull(),
  weddingDate: date("wedding_date"),
  location: text("location"),
  customTerms: jsonb("custom_terms").notNull().default({}),

  contentSnapshot: jsonb("content_snapshot"),
  contentHash: text("content_hash"),

  signerNameTyped: text("signer_name_typed"),
  signatureStrokes: jsonb("signature_strokes"),
  consents: jsonb("consents"),
  ipAddress: inet("ip_address"),
  userAgent: text("user_agent"),
  signedAt: timestamp("signed_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ContractRow = typeof contracts.$inferSelect;
