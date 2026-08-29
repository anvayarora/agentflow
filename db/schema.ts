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

/** Merchant-configured presentation personas. They never carry policy or pricing authority. */
export const salespersonProfiles = pgTable("salesperson_profiles", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  displayName: text("display_name").notNull(),
  description: text("description").notNull(),
  speakerId: text("speaker_id").notNull(),
  languageSupport: text("language_support").array().notNull(),
  tonePreset: text("tone_preset").notNull(),
  pacePreset: text("pace_preset").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  isMerchantDefault: boolean("is_merchant_default").notNull().default(false),
  avatarKey: text("avatar_key"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  organizationDisplayNameUnique: uniqueIndex("salesperson_profiles_org_display_name_idx").on(table.organizationId, table.displayName),
}));

export const shoppingSessions = pgTable("shopping_sessions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  customerId: text("customer_id").notNull().references(() => customers.id),
  currency: text("currency").notNull(),
  status: text("status").notNull(),
  cart: jsonb("cart").$type<Record<string, unknown>>().notNull(),
  shopifyShopDomain: text("shopify_shop_domain"),
  shopifyCustomerId: text("shopify_customer_id"),
  shopifyCartId: text("shopify_cart_id"),
  salespersonProfileId: text("salesperson_profile_id").references(() => salespersonProfiles.id),
  preferredLanguage: text("preferred_language"),
  detectedLanguage: text("detected_language"),
  preferredScript: text("preferred_script"),
  voiceEnabled: boolean("voice_enabled").notNull().default(false),
  voicePace: text("voice_pace"),
  canonicalLineItems: jsonb("canonical_line_items").$type<unknown[]>().notNull().default([]),
  cartHash: text("cart_hash"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
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

/**
 * Observed inventory is kept separately from the current product row so growth
 * recommendations can explain what was actually observed over time.
 */
export const inventorySnapshots = pgTable("inventory_snapshots", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  productId: text("product_id").notNull().references(() => products.id),
  variantId: text("variant_id"),
  quantity: integer("quantity").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  source: text("source").notNull(),
  createdAt: createdAt(),
}, (table) => ({
  organizationProductObservedUnique: uniqueIndex("inventory_snapshots_org_product_observed_idx").on(table.organizationId, table.productId, table.observedAt),
}));

export const growthSignals = pgTable("growth_signals", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  type: text("type").notNull(),
  productId: text("product_id"),
  variantId: text("variant_id"),
  relatedProductId: text("related_product_id"),
  severity: text("severity").notNull(),
  confidenceBps: integer("confidence_bps").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
  calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (table) => ({
  organizationSignalUnique: uniqueIndex("growth_signals_org_type_product_idx").on(table.organizationId, table.type, table.productId, table.relatedProductId),
}));

export const growthOpportunities = pgTable("growth_opportunities", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  type: text("type").notNull(),
  sourceSignalIds: jsonb("source_signal_ids").$type<string[]>().notNull(),
  primaryProductId: text("primary_product_id").notNull().references(() => products.id),
  secondaryProductIds: text("secondary_product_ids").array().notNull(),
  proposedAction: jsonb("proposed_action").$type<Record<string, unknown>>().notNull(),
  estimatedImpact: jsonb("estimated_impact").$type<Record<string, unknown>>().notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
  riskFlags: text("risk_flags").array().notNull(),
  policyCompatibility: text("policy_compatibility").notNull(),
  scoreBps: integer("score_bps").notNull(),
  status: text("status").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const growthPlays = pgTable("growth_plays", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  opportunityId: text("opportunity_id").notNull().references(() => growthOpportunities.id),
  primaryProductId: text("primary_product_id").notNull().references(() => products.id),
  secondaryProductIds: text("secondary_product_ids").array().notNull(),
  eligibility: jsonb("eligibility").$type<Record<string, unknown>>().notNull(),
  commercialStrategy: jsonb("commercial_strategy").$type<Record<string, unknown>>().notNull(),
  maxIncentiveBps: integer("max_incentive_bps").notNull(),
  minimumMarginBps: integer("minimum_margin_bps").notNull(),
  requiredPolicyChecks: jsonb("required_policy_checks").$type<string[]>().notNull(),
  customerEligibility: jsonb("customer_eligibility").$type<Record<string, unknown>>().notNull(),
  frequencyLimit: jsonb("frequency_limit").$type<Record<string, unknown>>().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  approvalRequired: boolean("approval_required").notNull(),
  status: text("status").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const growthAttributions = pgTable("growth_attributions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  growthPlayId: text("growth_play_id").notNull().references(() => growthPlays.id),
  transactionId: text("transaction_id").notNull(),
  baselineCartAmountPaise: integer("baseline_cart_amount_paise").notNull(),
  actualPaidAmountPaise: integer("actual_paid_amount_paise").notNull(),
  incrementalAovPaise: integer("incremental_aov_paise").notNull(),
  verified: boolean("verified").notNull(),
  createdAt: createdAt(),
});

/**
 * Durable execution state for the storefront agent. Domain services validate
 * each payload before writing it; the organization/kind/id key keeps every
 * runtime object tenant-scoped and makes retries idempotent.
 */
export const runtimeRecords = pgTable("runtime_records", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  organizationKindIdUnique: uniqueIndex("runtime_records_organization_kind_id_idx").on(table.organizationId, table.kind, table.id),
}));

/** A durable, reviewable catalogue bootstrap/import run. */
export const importRuns = pgTable("import_runs", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  sourceFile: text("source_file").notNull(),
  sourceType: text("source_type").notNull(),
  status: text("status").notNull(),
  mappings: jsonb("mappings").$type<Record<string, string>>().notNull(),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull(),
  errors: jsonb("errors").$type<string[]>().notNull(),
  warnings: jsonb("warnings").$type<string[]>().notNull(),
  rows: jsonb("rows").$type<unknown[]>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Stable reconciliation between an AgentFlow product/variant and Shopify. */
export const productMappings = pgTable("product_mappings", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  productId: text("product_id").notNull().references(() => products.id),
  shopDomain: text("shop_domain").notNull(),
  shopifyProductGid: text("shopify_product_gid").notNull(),
  shopifyVariantGid: text("shopify_variant_gid"),
  sku: text("sku").notNull(),
  source: text("source").notNull(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  organizationProductUnique: uniqueIndex("product_mappings_org_product_idx").on(table.organizationId, table.productId),
  organizationSkuUnique: uniqueIndex("product_mappings_org_shop_sku_idx").on(table.organizationId, table.shopDomain, table.sku),
}));

export type ImportRunRecord = typeof importRuns.$inferSelect;
export type ProductMappingRecord = typeof productMappings.$inferSelect;

export type Organization = typeof organizations.$inferSelect;
export type ProductRecord = typeof products.$inferSelect;
export type CustomerRecord = typeof customers.$inferSelect;
export type PolicyVersionRecord = typeof policyVersions.$inferSelect;
export type PolicyRuleRecord = typeof policyRules.$inferSelect;
