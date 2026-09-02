/**
 * Drizzle schema mirroring migrations/*.sql — the SQL migrations are the
 * source of truth (RLS, roles, grants aren't expressible here), this is
 * just the typed reflection for query-building.
 *
 * Column names are currency-neutral by design (package_price_amount, not
 * package_price_chf/eur) — this table is shared by both brands, and each
 * brand's own frontend applies its own currency formatting (CHF for DIMAX,
 * EUR for DKHochzeitArt). The column itself carries no currency assumption.
 */
import { pgTable, uuid, text, integer, date, jsonb, timestamp, inet } from "drizzle-orm/pg-core";

export const contracts = pgTable("contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  brand: text("brand").notNull(),
  status: text("status").notNull().default("draft"),

  // customerName2 stays null for brands that only need one combined name
  // (DIMAX); DKHochzeitArt uses both ("Person 1"/"Person 2").
  customerName1: text("customer_name_1"),
  customerName2: text("customer_name_2"),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone"),
  customerAddress: text("customer_address"), // optional; DIMAX leaves this null

  packageId: text("package_id").notNull(),
  packageLabel: text("package_label").notNull(),
  packageServices: jsonb("package_services").notNull().default([]), // "enthaltene Leistungen" of the booked package
  packagePriceAmount: integer("package_price_amount").notNull(),
  weddingDate: date("wedding_date"),
  location: text("location"),
  additionalLocations: text("additional_locations"),
  startTime: text("start_time"),
  durationLabel: text("duration_label"),
  bookingType: text("booking_type"), // 'photo' | 'video' | 'photo_and_video', nullable -- DIMAX doesn't use this
  extras: jsonb("extras").notNull().default([]),
  extrasPriceAmount: integer("extras_price_amount").notNull().default(0), // separate from packagePriceAmount; 0 for brands that don't itemize (DIMAX)
  depositAmount: integer("deposit_amount"),
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
