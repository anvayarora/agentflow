import { boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const organizationMembers = pgTable("organization_members", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  actorId: text("actor_id").notNull(),
  role: text("role").notNull(),
  createdAt: createdAt(),
}, (table) => ({
  organizationActorUnique: uniqueIndex("organization_members_organization_actor_idx").on(table.organizationId, table.actorId),
}));

export const products = pgTable("products", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  externalId: text("external_id"),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  brand: text("brand"),
  currency: text("currency").notNull(),
  listPricePaise: integer("list_price_paise").notNull(),
  costPaise: integer("cost_paise"),
  stock: integer("stock").notNull(),
  attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull(),
  tags: text("tags").array().notNull(),
  imageUrl: text("image_url"),
  source: text("source").notNull(),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  organizationSkuUnique: uniqueIndex("products_organization_sku_idx").on(table.organizationId, table.sku),
}));

export const customers = pgTable("customers", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  externalCustomerId: text("external_customer_id"),
  emailHash: text("email_hash"),
  orderCount: integer("order_count").notNull(),
  lifetimeValuePaise: integer("lifetime_value_paise").notNull(),
  lastOrderAt: timestamp("last_order_at", { withTimezone: true }),
  attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  organizationExternalCustomerUnique: uniqueIndex("customers_organization_external_id_idx").on(table.organizationId, table.externalCustomerId),
}));

export const customerSegments = pgTable("customer_segments", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  customerId: text("customer_id").notNull().references(() => customers.id),
  segment: text("segment").notNull(),
  source: text("source").notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  organizationCustomerUnique: uniqueIndex("customer_segments_organization_customer_idx").on(table.organizationId, table.customerId),
}));

export const policies = pgTable("policies", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  currentPublishedVersionId: text("current_published_version_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  organizationNameUnique: uniqueIndex("policies_organization_name_idx").on(table.organizationId, table.name),
}));

export const policyVersions = pgTable("policy_versions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  policyId: text("policy_id").notNull().references(() => policies.id),
  version: integer("version").notNull(),
  status: text("status").notNull(),
  currency: text("currency").notNull(),
  sourcePrompt: text("source_prompt"),
  source: text("source").notNull(),
  createdBy: text("created_by").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  policyVersionUnique: uniqueIndex("policy_versions_policy_version_idx").on(table.policyId, table.version),
}));

export const policyRules = pgTable("policy_rules", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  policyVersionId: text("policy_version_id").notNull().references(() => policyVersions.id),
  name: text("name").notNull(),
  description: text("description").notNull(),
  priority: integer("priority").notNull(),
  hardConstraint: boolean("hard_constraint").notNull(),
  scope: jsonb("scope").$type<Record<string, unknown>>().notNull(),
  conditions: jsonb("conditions").$type<unknown[]>().notNull(),
  effect: jsonb("effect").$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
}, (table) => ({
  policyRuleUnique: uniqueIndex("policy_rules_version_rule_idx").on(table.policyVersionId, table.id),
}));

export const shoppingSessions = pgTable("shopping_sessions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  customerId: text("customer_id").notNull().references(() => customers.id),
  currency: text("currency").notNull(),
  status: text("status").notNull(),
  cart: jsonb("cart").$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const offers = pgTable("offers", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  shoppingSessionId: text("shopping_session_id").notNull().references(() => shoppingSessions.id),
  productId: text("product_id").notNull().references(() => products.id),
  policyVersionId: text("policy_version_id").notNull().references(() => policyVersions.id),
  quantity: integer("quantity").notNull(),
  requestedPricePaise: integer("requested_price_paise").notNull(),
  requestedDiscountBps: integer("requested_discount_bps").notNull(),
  outcome: text("outcome").notNull(),
  approvedPricePaise: integer("approved_price_paise"),
  counterPricePaise: integer("counter_price_paise"),
  maxDiscountBps: integer("max_discount_bps"),
  requiresApproval: boolean("requires_approval").notNull(),
  matchedRules: jsonb("matched_rules").$type<string[]>().notNull(),
  evidence: jsonb("evidence").$type<unknown[]>().notNull(),
  createdAt: createdAt(),
});

export const approvalRequests = pgTable("approval_requests", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  offerId: text("offer_id").notNull().references(() => offers.id),
  status: text("status").notNull(),
  decision: text("decision"),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const scopedOverrides = pgTable("scoped_overrides", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  offerId: text("offer_id").notNull().references(() => offers.id),
  scope: jsonb("scope").$type<Record<string, unknown>>().notNull(),
  effect: jsonb("effect").$type<Record<string, unknown>>().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
});

export const commerceTransactions = pgTable("commerce_transactions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  shoppingSessionId: text("shopping_session_id").notNull().references(() => shoppingSessions.id),
  offerId: text("offer_id"),
  policyVersionId: text("policy_version_id").notNull().references(() => policyVersions.id),
  status: text("status").notNull(),
  totalPaise: integer("total_paise").notNull(),
  currency: text("currency").notNull(),
  createdAt: createdAt(),
});

export const paymentRecords = pgTable("payment_records", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  transactionId: text("transaction_id").notNull().references(() => commerceTransactions.id),
  provider: text("provider").notNull(),
  providerPaymentId: text("provider_payment_id"),
  status: text("status").notNull(),
  amountPaise: integer("amount_paise").notNull(),
  currency: text("currency").notNull(),
  createdAt: createdAt(),
});

export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id"),
  eventType: text("event_type").notNull(),
  shoppingSessionId: text("shopping_session_id"),
  policyVersionId: text("policy_version_id"),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  correlationId: text("correlation_id").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
});

export const integrations = pgTable("integrations", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  provider: text("provider").notNull(),
  status: text("status").notNull(),
  configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  organizationProviderUnique: uniqueIndex("integrations_organization_provider_idx").on(table.organizationId, table.provider),
}));

export const simulationRuns = pgTable("simulation_runs", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  policyVersionId: text("policy_version_id").notNull().references(() => policyVersions.id),
  status: text("status").notNull(),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
});

export const simulationCases = pgTable("simulation_cases", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  simulationRunId: text("simulation_run_id").notNull().references(() => simulationRuns.id),
  input: jsonb("input").$type<Record<string, unknown>>().notNull(),
  output: jsonb("output").$type<Record<string, unknown>>(),
  createdAt: createdAt(),
});

export type Organization = typeof organizations.$inferSelect;
export type ProductRecord = typeof products.$inferSelect;
export type CustomerRecord = typeof customers.$inferSelect;
export type PolicyVersionRecord = typeof policyVersions.$inferSelect;
export type PolicyRuleRecord = typeof policyRules.$inferSelect;
