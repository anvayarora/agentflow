import { and, desc, eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "../../../db";
import { auditEvents, customers, policies, policyRules, policyVersions, products, shoppingSessions } from "../../../db/schema";
import { products as displayProducts } from "../../catalogue";
import type { AuditEventInput } from "../../domain/audit";
import type { CanonicalCustomer } from "../../domain/customer";
import type { CanonicalProduct } from "../../domain/catalogue";
import { compileDemoPolicyProposal } from "../../policy/compiler";
import { policyVersionSchema, type PolicyVersionIR } from "../../policy/schema";
import { resolvePolicyDiscrepancy, validatePolicy, type PolicyDiscrepancy, type PolicyValidationResult } from "../../policy/validator";
import type { TrustedCommerceSession } from "../../policy/evaluator";
import type { TrustedRequestContext } from "../context";

export type SessionRecord = TrustedCommerceSession & { customerId: string };

export type OfferRecord = {
  id: string;
  organizationId: string;
  sessionId: string;
  productId: string;
  policyVersionId: string;
  evaluation: import("../../policy/evaluator").CommerceEvaluation;
  quantity: number;
  requestedDiscountBps: number;
  createdAt: string;
};

export type CommerceRepository = {
  listProducts(context: TrustedRequestContext): Promise<CanonicalProduct[]>;
  getProduct(context: TrustedRequestContext, productId: string): Promise<CanonicalProduct | null>;
  getCustomer(context: TrustedRequestContext, customerId?: string): Promise<CanonicalCustomer | null>;
  createSession(context: TrustedRequestContext, customerId?: string): Promise<SessionRecord>;
  getSession(context: TrustedRequestContext, sessionId: string): Promise<SessionRecord | null>;
  getCurrentPolicy(context: TrustedRequestContext): Promise<PolicyVersionIR | null>;
  getPolicyVersion(context: TrustedRequestContext, versionId: string): Promise<PolicyVersionIR | null>;
  createDraft(context: TrustedRequestContext, proposed?: PolicyVersionIR): Promise<PolicyVersionIR>;
  getDraft(context: TrustedRequestContext, draftId: string): Promise<PolicyVersionIR | null>;
  updateDraft(context: TrustedRequestContext, draftId: string, policy: PolicyVersionIR): Promise<PolicyVersionIR>;
  validateDraft(context: TrustedRequestContext, draftId: string): Promise<PolicyValidationResult>;
  publishDraft(context: TrustedRequestContext, draftId: string): Promise<PolicyVersionIR>;
  resolveDraftDiscrepancy(context: TrustedRequestContext, draftId: string, discrepancyId: string, resolution: string | number | { valueBps?: number; ruleId?: string }): Promise<{ policy: PolicyVersionIR; validation: PolicyValidationResult; discrepancies: PolicyDiscrepancy[] }>;
  recordOffer(context: TrustedRequestContext, offer: OfferRecord): Promise<void>;
  recordAudit(context: TrustedRequestContext, event: Omit<AuditEventInput, "organizationId" | "actorType" | "actorId" | "correlationId"> & Partial<Pick<AuditEventInput, "actorType" | "actorId" | "correlationId">>): Promise<void>;
  listAudit(context: TrustedRequestContext, limit?: number): Promise<Array<AuditEventInput & { id: string; createdAt: string }>>;
};

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

function demoProducts(organizationId: string): CanonicalProduct[] {
  return displayProducts.map((product) => ({
    id: product.id,
    organizationId,
    externalId: `demo-${product.id}`,
    sku: product.sku,
    name: product.name,
    description: product.description,
    category: product.category,
    brand: product.id === "desk-041" ? "Aster" : "Haven Home",
    currency: "INR",
    listPricePaise: Math.round(product.price * 100),
    costPaise: product.id === "desk-017" ? null : product.cost === null ? null : Math.round(product.cost * 100),
    stock: product.stock,
    attributes: { finish: product.finish, material: product.material, width: product.width, art: product.art },
    tags: [product.tag || "catalogue"],
    imageUrl: null,
    source: "demo",
    sourceUpdatedAt: null,
  }));
}

function demoCustomers(organizationId: string): CanonicalCustomer[] {
  return [
    { id: "customer-haven-repeat", organizationId, externalCustomerId: "haven-repeat", emailHash: "demo-repeat", orderCount: 4, lifetimeValuePaise: 285_000_00, lastOrderAt: new Date("2026-07-15"), attributes: { name: "Returning customer" } },
    { id: "customer-haven-new", organizationId, externalCustomerId: "haven-new", emailHash: "demo-new", orderCount: 0, lifetimeValuePaise: 0, lastOrderAt: null, attributes: { name: "New customer" } },
  ];
}

type MemoryState = {
  organizations: Set<string>;
  products: CanonicalProduct[];
  customers: CanonicalCustomer[];
  sessions: Map<string, SessionRecord>;
  policies: Map<string, PolicyVersionIR>;
  currentPolicyId: string;
  offers: OfferRecord[];
  audit: Array<AuditEventInput & { id: string; createdAt: string }>;
};

const memoryStates = new Map<string, MemoryState>();

function memoryState(organizationId: string): MemoryState {
  const existing = memoryStates.get(organizationId);
  if (existing) return existing;
  const proposal = compileDemoPolicyProposal("Standard customers can receive up to 10%. Repeat customers can receive up to 15%. Never go below 25% gross margin. Do not discount products below 10 units in stock. Orders above ₹50,000 require merchant approval.", { organizationId, policyId: "policy-haven-home-commerce", version: 1 });
  const published = { ...proposal.policy, status: "PUBLISHED" as const };
  const state: MemoryState = {
    organizations: new Set([organizationId]),
    products: demoProducts(organizationId),
    customers: demoCustomers(organizationId),
    sessions: new Map(),
    policies: new Map([[published.id, published]]),
    currentPolicyId: published.id,
    offers: [],
    audit: [],
  };
  memoryStates.set(organizationId, state);
  return state;
}

class MemoryCommerceRepository implements CommerceRepository {
  private state(context: TrustedRequestContext) { return memoryState(context.organizationId); }

  async listProducts(context: TrustedRequestContext) { return this.state(context).products; }
  async getProduct(context: TrustedRequestContext, productId: string) { return this.state(context).products.find((product) => product.id === productId) || null; }
  async getCustomer(context: TrustedRequestContext, customerId = "customer-haven-repeat") { return this.state(context).customers.find((customer) => customer.id === customerId) || null; }
  async createSession(context: TrustedRequestContext, customerId = "customer-haven-repeat") {
    const customer = await this.getCustomer(context, customerId);
    if (!customer) throw new Error("Customer is not available in this organization.");
    const session: SessionRecord = { id: id("session"), organizationId: context.organizationId, customerId: customer.id, currency: "INR", status: "OPEN", cartTotalPaise: 0 };
    this.state(context).sessions.set(session.id, session);
    return session;
  }
  async getSession(context: TrustedRequestContext, sessionId: string) { return this.state(context).sessions.get(sessionId) || null; }
  async getCurrentPolicy(context: TrustedRequestContext) { return this.state(context).policies.get(this.state(context).currentPolicyId) || null; }
  async getPolicyVersion(context: TrustedRequestContext, versionId: string) { return this.state(context).policies.get(versionId) || null; }
  async createDraft(context: TrustedRequestContext, proposed?: PolicyVersionIR) {
    const state = this.state(context);
    const current = await this.getCurrentPolicy(context);
    if (!current && !proposed) throw new Error("No current policy is available.");
    const versions = [...state.policies.values()].map((policy) => policy.version);
    const source = proposed || current!;
    const draft: PolicyVersionIR = { ...structuredClone(source), id: id("policy-version"), version: Math.max(...versions, 0) + 1, status: "DRAFT", organizationId: context.organizationId, source: proposed?.source || "merchant" };
    state.policies.set(draft.id, draft);
    await this.recordAudit(context, { eventType: "POLICY_DRAFT_CREATED", entityType: "policy_version", entityId: draft.id, policyVersionId: draft.id, metadata: { version: draft.version } });
    return draft;
  }
  async getDraft(context: TrustedRequestContext, draftId: string) { const policy = await this.getPolicyVersion(context, draftId); return policy?.status === "DRAFT" ? policy : null; }
  async updateDraft(context: TrustedRequestContext, draftId: string, policy: PolicyVersionIR) {
    const draft = await this.getDraft(context, draftId);
    if (!draft) throw new Error("Draft policy was not found in this organization.");
    if (policy.id !== draft.id || policy.organizationId !== context.organizationId || policy.version !== draft.version || policy.status !== "DRAFT") throw new Error("Published policy identity and status cannot be changed.");
    const next = structuredClone(policy);
    this.state(context).policies.set(draftId, next);
    await this.recordAudit(context, { eventType: "POLICY_RULE_CHANGED", entityType: "policy_version", entityId: draftId, policyVersionId: draftId, metadata: { ruleCount: next.rules.length } });
    return next;
  }
  async validateDraft(context: TrustedRequestContext, draftId: string) {
    const draft = await this.getDraft(context, draftId);
    if (!draft) return { valid: false, policy: null, errors: ["Draft policy was not found."], discrepancies: [] };
    const result = validatePolicy(draft);
    await this.recordAudit(context, { eventType: "POLICY_VALIDATED", entityType: "policy_version", entityId: draftId, policyVersionId: draftId, metadata: { valid: result.valid, errors: result.errors.length, discrepancies: result.discrepancies.length } });
    return result;
  }
  async publishDraft(context: TrustedRequestContext, draftId: string) {
    const validation = await this.validateDraft(context, draftId);
    if (!validation.valid || !validation.policy) throw new Error(`Draft cannot be published: ${[...validation.errors, ...validation.discrepancies.map((item) => item.message)].join(" ")}`);
    const state = this.state(context);
    for (const [versionId, policy] of state.policies) if (policy.status === "PUBLISHED" && policy.policyId === validation.policy.policyId) state.policies.set(versionId, { ...policy, status: "ARCHIVED" });
    const published = { ...validation.policy, status: "PUBLISHED" as const };
    state.policies.set(draftId, published);
    state.currentPolicyId = draftId;
    await this.recordAudit(context, { eventType: "POLICY_PUBLISHED", entityType: "policy_version", entityId: draftId, policyVersionId: draftId, metadata: { version: published.version } });
    return published;
  }
  async resolveDraftDiscrepancy(context: TrustedRequestContext, draftId: string, discrepancyId: string, resolution: string | number | { valueBps?: number; ruleId?: string }) {
    const draft = await this.getDraft(context, draftId);
    if (!draft) throw new Error("Draft policy was not found.");
    const resolved = resolvePolicyDiscrepancy(draft, discrepancyId, resolution);
    const updated = await this.updateDraft(context, draftId, resolved.policy);
    const validation = await this.validateDraft(context, draftId);
    return { policy: updated, validation, discrepancies: validation.discrepancies };
  }
  async recordOffer(context: TrustedRequestContext, offer: OfferRecord) { this.state(context).offers.push(offer); }
  async recordAudit(context: TrustedRequestContext, event: Omit<AuditEventInput, "organizationId" | "actorType" | "actorId" | "correlationId"> & Partial<Pick<AuditEventInput, "actorType" | "actorId" | "correlationId">>) {
    this.state(context).audit.push({ ...event, id: id("audit"), organizationId: context.organizationId, actorType: event.actorType || context.actorType, actorId: event.actorId ?? context.actorId, correlationId: event.correlationId || context.correlationId, createdAt: now() });
  }
  async listAudit(context: TrustedRequestContext, limit = 100) { return this.state(context).audit.slice(-Math.min(limit, 200)).reverse(); }
}

function productFromRow(row: typeof products.$inferSelect): CanonicalProduct {
  return { ...row, organizationId: row.organizationId, attributes: row.attributes || {}, tags: row.tags || [] };
}

function customerFromRow(row: typeof customers.$inferSelect): CanonicalCustomer {
  return { ...row, attributes: row.attributes || {} };
}

class PostgresCommerceRepository implements CommerceRepository {
  async listProducts(context: TrustedRequestContext) {
    const rows = await getDb().select().from(products).where(eq(products.organizationId, context.organizationId));
    return rows.map(productFromRow);
  }
  async getProduct(context: TrustedRequestContext, productId: string) {
    const rows = await getDb().select().from(products).where(and(eq(products.organizationId, context.organizationId), eq(products.id, productId))).limit(1);
    return rows[0] ? productFromRow(rows[0]) : null;
  }
  async getCustomer(context: TrustedRequestContext, customerId?: string) {
    const query = customerId ? and(eq(customers.organizationId, context.organizationId), eq(customers.id, customerId)) : eq(customers.organizationId, context.organizationId);
    const rows = await getDb().select().from(customers).where(query).limit(1);
    return rows[0] ? customerFromRow(rows[0]) : null;
  }
  async createSession(context: TrustedRequestContext, customerId = "customer-haven-repeat") {
    const customer = await this.getCustomer(context, customerId);
    if (!customer) throw new Error("Customer is not available in this organization.");
    const session = { id: id("session"), organizationId: context.organizationId, customerId: customer.id, currency: "INR", status: "OPEN", cart: { totalPaise: 0 } };
    await getDb().insert(shoppingSessions).values(session);
    return { id: session.id, organizationId: session.organizationId, customerId: session.customerId, currency: session.currency, status: session.status, cartTotalPaise: 0 };
  }
  async getSession(context: TrustedRequestContext, sessionId: string) {
    const rows = await getDb().select().from(shoppingSessions).where(and(eq(shoppingSessions.organizationId, context.organizationId), eq(shoppingSessions.id, sessionId))).limit(1);
    const row = rows[0];
    if (!row) return null;
    const total = typeof row.cart === "object" && row.cart && typeof row.cart.totalPaise === "number" ? row.cart.totalPaise : 0;
    return { id: row.id, organizationId: row.organizationId, customerId: row.customerId, currency: row.currency, status: row.status, cartTotalPaise: total };
  }
  private async loadVersion(context: TrustedRequestContext, versionId: string) {
    const rows = await getDb().select().from(policyVersions).where(and(eq(policyVersions.organizationId, context.organizationId), eq(policyVersions.id, versionId))).limit(1);
    const row = rows[0];
    if (!row) return null;
    const rules = await getDb().select().from(policyRules).where(and(eq(policyRules.organizationId, context.organizationId), eq(policyRules.policyVersionId, versionId)));
    return policyVersionSchema.parse({ id: row.id, organizationId: row.organizationId, policyId: row.policyId, version: row.version, status: row.status, currency: row.currency, sourcePrompt: row.sourcePrompt, source: row.source, rules: rules.map((rule) => ({ id: rule.id.startsWith(`${versionId}::`) ? rule.id.slice(`${versionId}::`.length) : rule.id, name: rule.name, description: rule.description, priority: rule.priority, hardConstraint: rule.hardConstraint, scope: rule.scope, conditions: rule.conditions, effect: rule.effect })) });
  }
  async getCurrentPolicy(context: TrustedRequestContext) {
    const rows = await getDb().select().from(policies).where(eq(policies.organizationId, context.organizationId)).limit(1);
    return rows[0]?.currentPublishedVersionId ? this.loadVersion(context, rows[0].currentPublishedVersionId) : null;
  }
  async getPolicyVersion(context: TrustedRequestContext, versionId: string) { return this.loadVersion(context, versionId); }
  async createDraft(context: TrustedRequestContext, proposed?: PolicyVersionIR) {
    const current = await this.getCurrentPolicy(context);
    const source = proposed || current;
    if (!source) throw new Error("No current policy is available.");
    const all = await getDb().select({ version: policyVersions.version }).from(policyVersions).where(and(eq(policyVersions.organizationId, context.organizationId), eq(policyVersions.policyId, source.policyId))).orderBy(desc(policyVersions.version));
    const draft: PolicyVersionIR = { ...structuredClone(source), id: id("policy-version"), version: (all[0]?.version || 0) + 1, status: "DRAFT", organizationId: context.organizationId, source: proposed?.source || "merchant" };
    await getDb().transaction(async (tx) => {
      await tx.insert(policyVersions).values({ id: draft.id, organizationId: context.organizationId, policyId: draft.policyId, version: draft.version, status: draft.status, currency: draft.currency, sourcePrompt: draft.sourcePrompt ?? null, source: draft.source, createdBy: context.actorId });
      await tx.insert(policyRules).values(draft.rules.map((rule) => ({ id: `${draft.id}::${rule.id}`, organizationId: context.organizationId, policyVersionId: draft.id, name: rule.name, description: rule.description, priority: rule.priority, hardConstraint: rule.hardConstraint, scope: rule.scope, conditions: rule.conditions, effect: rule.effect })));
    });
    await this.recordAudit(context, { eventType: "POLICY_DRAFT_CREATED", entityType: "policy_version", entityId: draft.id, policyVersionId: draft.id, metadata: { version: draft.version } });
    return draft;
  }
  async getDraft(context: TrustedRequestContext, draftId: string) { const policy = await this.getPolicyVersion(context, draftId); return policy?.status === "DRAFT" ? policy : null; }
  async updateDraft(context: TrustedRequestContext, draftId: string, policy: PolicyVersionIR) {
    const draft = await this.getDraft(context, draftId);
    if (!draft || policy.id !== draft.id || policy.organizationId !== context.organizationId || policy.version !== draft.version || policy.status !== "DRAFT") throw new Error("Draft policy identity and status are invalid.");
    await getDb().transaction(async (tx) => {
      await tx.delete(policyRules).where(and(eq(policyRules.organizationId, context.organizationId), eq(policyRules.policyVersionId, draftId)));
      await tx.insert(policyRules).values(policy.rules.map((rule) => ({ id: `${draftId}::${rule.id}`, organizationId: context.organizationId, policyVersionId: draftId, name: rule.name, description: rule.description, priority: rule.priority, hardConstraint: rule.hardConstraint, scope: rule.scope, conditions: rule.conditions, effect: rule.effect })));
      await tx.update(policyVersions).set({ sourcePrompt: policy.sourcePrompt ?? null, source: policy.source, updatedAt: new Date() }).where(and(eq(policyVersions.organizationId, context.organizationId), eq(policyVersions.id, draftId)));
    });
    await this.recordAudit(context, { eventType: "POLICY_RULE_CHANGED", entityType: "policy_version", entityId: draftId, policyVersionId: draftId, metadata: { ruleCount: policy.rules.length } });
    return policy;
  }
  async validateDraft(context: TrustedRequestContext, draftId: string) {
    const draft = await this.getDraft(context, draftId);
    if (!draft) return { valid: false, policy: null, errors: ["Draft policy was not found."], discrepancies: [] };
    const result = validatePolicy(draft);
    await this.recordAudit(context, { eventType: "POLICY_VALIDATED", entityType: "policy_version", entityId: draftId, policyVersionId: draftId, metadata: { valid: result.valid, errors: result.errors.length, discrepancies: result.discrepancies.length } });
    return result;
  }
  async publishDraft(context: TrustedRequestContext, draftId: string) {
    const validation = await this.validateDraft(context, draftId);
    if (!validation.valid || !validation.policy) throw new Error(`Draft cannot be published: ${[...validation.errors, ...validation.discrepancies.map((item) => item.message)].join(" ")}`);
    const published = await getDb().transaction(async (tx) => {
      await tx.update(policyVersions).set({ status: "ARCHIVED", updatedAt: new Date() }).where(and(eq(policyVersions.organizationId, context.organizationId), eq(policyVersions.policyId, validation.policy!.policyId), eq(policyVersions.status, "PUBLISHED")));
      await tx.update(policyVersions).set({ status: "PUBLISHED", publishedAt: new Date(), updatedAt: new Date() }).where(and(eq(policyVersions.organizationId, context.organizationId), eq(policyVersions.id, draftId), eq(policyVersions.status, "DRAFT")));
      await tx.update(policies).set({ currentPublishedVersionId: draftId, updatedAt: new Date() }).where(and(eq(policies.organizationId, context.organizationId), eq(policies.id, validation.policy!.policyId)));
      return { ...validation.policy!, status: "PUBLISHED" as const };
    });
    await this.recordAudit(context, { eventType: "POLICY_PUBLISHED", entityType: "policy_version", entityId: draftId, policyVersionId: draftId, metadata: { version: published.version } });
    return published;
  }
  async resolveDraftDiscrepancy(context: TrustedRequestContext, draftId: string, discrepancyId: string, resolution: string | number | { valueBps?: number; ruleId?: string }) {
    const draft = await this.getDraft(context, draftId);
    if (!draft) throw new Error("Draft policy was not found.");
    const resolved = resolvePolicyDiscrepancy(draft, discrepancyId, resolution);
    const updated = await this.updateDraft(context, draftId, resolved.policy);
    const validation = await this.validateDraft(context, draftId);
    return { policy: updated, validation, discrepancies: validation.discrepancies };
  }
  async recordOffer(context: TrustedRequestContext, offer: OfferRecord) {
    const evaluation = offer.evaluation;
    await getDb().insert((await import("../../../db/schema")).offers).values({ id: offer.id, organizationId: context.organizationId, shoppingSessionId: offer.sessionId, productId: offer.productId, policyVersionId: offer.policyVersionId, quantity: offer.quantity, requestedPricePaise: evaluation.requestedPricePaise, requestedDiscountBps: offer.requestedDiscountBps, outcome: evaluation.outcome, approvedPricePaise: evaluation.approvedPricePaise ?? null, counterPricePaise: evaluation.counterPricePaise ?? null, maxDiscountBps: evaluation.maxDiscountBps ?? null, requiresApproval: evaluation.requiresApproval, matchedRules: evaluation.matchedRules, evidence: evaluation.evidence });
  }
  async recordAudit(context: TrustedRequestContext, event: Omit<AuditEventInput, "organizationId" | "actorType" | "actorId" | "correlationId"> & Partial<Pick<AuditEventInput, "actorType" | "actorId" | "correlationId">>) {
    await getDb().insert(auditEvents).values({ id: id("audit"), organizationId: context.organizationId, actorType: event.actorType || context.actorType, actorId: event.actorId ?? context.actorId, eventType: event.eventType, shoppingSessionId: event.shoppingSessionId ?? null, policyVersionId: event.policyVersionId ?? null, entityType: event.entityType, entityId: event.entityId, correlationId: event.correlationId || context.correlationId, metadata: event.metadata });
  }
  async listAudit(context: TrustedRequestContext, limit = 100) {
    const rows = await getDb().select().from(auditEvents).where(eq(auditEvents.organizationId, context.organizationId)).orderBy(desc(auditEvents.createdAt)).limit(Math.min(limit, 200));
    return rows.map((row) => ({ id: row.id, organizationId: row.organizationId, actorType: row.actorType as AuditEventInput["actorType"], actorId: row.actorId, eventType: row.eventType as AuditEventInput["eventType"], shoppingSessionId: row.shoppingSessionId, policyVersionId: row.policyVersionId, entityType: row.entityType, entityId: row.entityId, correlationId: row.correlationId, metadata: row.metadata, createdAt: row.createdAt.toISOString() }));
  }
}

let repository: CommerceRepository | null = null;
export function getCommerceRepository(): CommerceRepository {
  if (!repository) repository = isDatabaseConfigured() ? new PostgresCommerceRepository() : new MemoryCommerceRepository();
  return repository;
}

export function resetCommerceRepositoryForTests() { repository = null; memoryStates.clear(); }
