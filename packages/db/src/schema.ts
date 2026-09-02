/**
 * Drizzle schema mirroring migrations/0001_init.sql.
 *
 * This file is the TYPED reflection of the schema for query-building — it is
 * NOT the source of truth for the schema shape (the SQL migration is, since
 * it also carries the RLS policies, the append-only trigger, the composite
 * FKs, and the role/grants that Drizzle's schema DSL can't express). Keep
 * both in sync by hand until a Drizzle-Kit migration workflow replaces the
 * hand-written SQL for *future* schema changes (the initial migration stays
 * hand-written SQL because so much of it — RLS, triggers, roles — sits
 * outside what `drizzle-kit generate` produces).
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  date,
  jsonb,
  timestamp,
  inet,
  unique,
  foreignKey,
  index,
} from "drizzle-orm/pg-core";

export const contractStatus = pgEnum("contract_status", [
  "draft",
  "sent",
  "viewed",
  "signed",
  "completed",
  "cancelled",
]);

export const brands = pgTable("brands", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  legalName: text("legal_name").notNull(),
  domain: text("domain").notNull(),
  emailFrom: text("email_from").notNull(),
  emailReplyTo: text("email_reply_to"),
  contractNumberPrefix: text("contract_number_prefix").notNull(),
  brandTheme: jsonb("brand_theme").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const brandSequences = pgTable(
  "brand_sequences",
  {
    brandId: uuid("brand_id").notNull().references(() => brands.id),
    sequenceName: text("sequence_name").notNull().default("contract_number"),
    year: integer("year").notNull(),
    nextValue: integer("next_value").notNull().default(1),
  },
  (t) => ({
    pk: unique().on(t.brandId, t.sequenceName, t.year),
  }),
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id),
    names: text("names").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    brandIdUnique: unique("customers_brand_id_key").on(t.brandId, t.id),
    brandIdx: index("idx_customers_brand").on(t.brandId),
  }),
);

export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id),
    customerId: uuid("customer_id").notNull(),
    status: contractStatus("status").notNull().default("draft"),
    contractNumber: text("contract_number"),
    packageId: text("package_id").notNull(),
    weddingDate: date("wedding_date"),
    location: text("location"),
    price: integer("price").notNull(),
    deposit: integer("deposit"),
    extras: jsonb("extras").notNull().default([]),
    customTerms: jsonb("custom_terms").notNull().default({}),
    currentVersionId: uuid("current_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    brandIdUnique: unique("contracts_brand_id_key").on(t.brandId, t.id),
    brandContractNumberUnique: unique("contracts_brand_contract_number_key").on(
      t.brandId,
      t.contractNumber,
    ),
    customerFk: foreignKey({
      columns: [t.brandId, t.customerId],
      foreignColumns: [customers.brandId, customers.id],
      name: "contracts_customer_same_brand",
    }),
    brandIdx: index("idx_contracts_brand").on(t.brandId),
    brandStatusIdx: index("idx_contracts_brand_status").on(t.brandId, t.status),
  }),
);

export const contractVersions = pgTable(
  "contract_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull(),
    contractId: uuid("contract_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    contentSnapshot: jsonb("content_snapshot").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    brandIdUnique: unique("contract_versions_brand_id_key").on(t.brandId, t.id),
    contractVersionUnique: unique("contract_versions_contract_version_key").on(
      t.contractId,
      t.versionNumber,
    ),
    contractFk: foreignKey({
      columns: [t.brandId, t.contractId],
      foreignColumns: [contracts.brandId, contracts.id],
      name: "contract_versions_contract_same_brand",
    }),
    brandIdx: index("idx_contract_versions_brand").on(t.brandId, t.contractId),
  }),
);

export const contractSignatures = pgTable(
  "contract_signatures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull(),
    contractId: uuid("contract_id").notNull(),
    versionId: uuid("version_id").notNull(),
    signerNameTyped: text("signer_name_typed").notNull(),
    signatureStrokes: jsonb("signature_strokes").notNull(),
    consents: jsonb("consents").notNull(),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    brandIdUnique: unique("contract_signatures_brand_id_key").on(t.brandId, t.id),
    contractFk: foreignKey({
      columns: [t.brandId, t.contractId],
      foreignColumns: [contracts.brandId, contracts.id],
      name: "contract_signatures_contract_same_brand",
    }),
    versionFk: foreignKey({
      columns: [t.brandId, t.versionId],
      foreignColumns: [contractVersions.brandId, contractVersions.id],
      name: "contract_signatures_version_same_brand",
    }),
    brandIdx: index("idx_contract_signatures_brand").on(t.brandId, t.contractId),
  }),
);

/** Append-only in practice: the app DB role only ever gets INSERT/SELECT
 * grants on this table (see the migration), and a trigger blocks UPDATE/
 * DELETE as a second, independent layer — Drizzle itself has no concept of
 * "no update", it's enforced entirely at the Postgres level. */
export const contractEvents = pgTable(
  "contract_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull(),
    contractId: uuid("contract_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    actor: text("actor"),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    contractFk: foreignKey({
      columns: [t.brandId, t.contractId],
      foreignColumns: [contracts.brandId, contracts.id],
      name: "contract_events_contract_same_brand",
    }),
    brandIdx: index("idx_contract_events_brand").on(t.brandId, t.contractId, t.createdAt),
  }),
);

export const contractDocuments = pgTable(
  "contract_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull(),
    contractId: uuid("contract_id").notNull(),
    versionId: uuid("version_id").notNull(),
    storagePath: text("storage_path").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    contractFk: foreignKey({
      columns: [t.brandId, t.contractId],
      foreignColumns: [contracts.brandId, contracts.id],
      name: "contract_documents_contract_same_brand",
    }),
    versionFk: foreignKey({
      columns: [t.brandId, t.versionId],
      foreignColumns: [contractVersions.brandId, contractVersions.id],
      name: "contract_documents_version_same_brand",
    }),
    brandIdx: index("idx_contract_documents_brand").on(t.brandId, t.contractId),
  }),
);
