import { createHash } from "node:crypto";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "../../../db";
import { approvalRequests, auditEvents, checkoutReservations, commerceTransactionLines, commerceTransactions, customers, paymentRecords, paymentWebhookEvents, policies, policyRules, policyVersions, products, shoppingSessions } from "../../../db/schema";
import { products as displayProducts } from "../../catalogue";
import type { AuditEventInput } from "../../domain/audit";
import type { CanonicalCustomer } from "../../domain/customer";
import type { CanonicalProduct } from "../../domain/catalogue";
import { compileDemoPolicyProposal } from "../../policy/compiler";
import { policyVersionSchema, type PolicyVersionIR } from "../../policy/schema";
import { resolvePolicyDiscrepancy, validatePolicy, type PolicyDiscrepancy, type PolicyValidationResult } from "../../policy/validator";
import type { TrustedCommerceSession } from "../../policy/evaluator";
import type { TrustedRequestContext } from "../context";
import type { ShopifyUcpCart } from "../shopify/ucp";

export type SessionRecord = TrustedCommerceSession & {
  customerId: string;
  shopifyShopDomain?: string | null;
  shopifyCustomerId?: string | null;
  shopifyCartId?: string | null;
  canonicalLineItems?: unknown[];
  cartHash?: string | null;
  lastSyncedAt?: string | null;
  salespersonProfileId?: string | null;
  preferredLanguage?: string | null;
  detectedLanguage?: string | null;
  preferredScript?: string | null;
  voiceEnabled?: boolean;
  voicePace?: string | null;
};

export type ShopifySessionInput = {
  shopDomain: string;
  shopifyCustomerId?: string;
  currency?: string;
  cart?: ShopifyUcpCart;
};

export type SessionCartUpdate = {
  currency?: string;
  cartTotalPaise: number;
  shopifyCartId?: string | null;
  canonicalLineItems: unknown[];
  cartHash?: string | null;
};

export type SessionVoiceUpdate = {
  salespersonProfileId?: string | null;
  preferredLanguage?: string | null;
  detectedLanguage?: string | null;
  preferredScript?: string | null;
  voiceEnabled?: boolean;
  voicePace?: string | null;
};

export type CatalogueProductInput = {
  id?: string;
  externalId?: string | null;
  sku: string;
  name: string;
  description: string;
  category: string;
  brand?: string | null;
  currency?: string;
  listPricePaise: number;
  costPaise?: number | null;
  stock?: number;
  attributes?: Record<string, unknown>;
  tags?: string[];
  imageUrl?: string | null;
  source?: string;
};

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

export type ApprovalLedgerRecord = { id: string; offerId: string; status: string; decision?: string; decidedBy?: string; decidedAt?: string | null; createdAt?: string };
export type TransactionLedgerRecord = { id: string; sessionId: string; offerId?: string | null; policyVersionId: string; status: string; totalPaise: number; currency: string; provider?: string | null; providerOrderId?: string | null; idempotencyKey?: string | null; createdAt?: string };
export type PaymentLedgerRecord = { id: string; transactionId: string; provider: string; providerPaymentId?: string | null; status: string; amountPaise: number; currency: string; createdAt?: string };
export type CheckoutReservationStatus = "CREATING" | "CREATED" | "PAID" | "FAILED";
export type CheckoutReservationRecord = { id: string; organizationId: string; sessionId: string; idempotencyKey: string; status: CheckoutReservationStatus; provider?: string | null; providerOrderId?: string | null; transactionId?: string | null; amountPaise: number; currency: string; error?: string | null; createdAt: string; updatedAt: string };
export type TransactionLineSnapshot = { id: string; transactionId: string; productId?: string | null; shopifyProductGid?: string | null; shopifyVariantGid?: string | null; sku?: string | null; productTitle: string; quantity: number; unitPublicPricePaise: number; authorizedUnitPricePaise: number; lineTotalPaise: number; currency: string; growthPlayId?: string | null; snapshotStatus?: string };

export type CommerceRepository = {
  listProducts(context: TrustedRequestContext): Promise<CanonicalProduct[]>;
  getProduct(context: TrustedRequestContext, productId: string): Promise<CanonicalProduct | null>;
  getCustomer(context: TrustedRequestContext, customerId?: string): Promise<CanonicalCustomer | null>;
  createSession(context: TrustedRequestContext, customerId?: string): Promise<SessionRecord>;
  createShopifySession(context: TrustedRequestContext, input: ShopifySessionInput): Promise<SessionRecord>;
  getSession(context: TrustedRequestContext, sessionId: string): Promise<SessionRecord | null>;
  updateSessionCart(context: TrustedRequestContext, sessionId: string, update: SessionCartUpdate): Promise<SessionRecord | null>;
  updateSessionVoice(context: TrustedRequestContext, sessionId: string, update: SessionVoiceUpdate): Promise<SessionRecord | null>;
  upsertCatalogueProduct(context: TrustedRequestContext, input: CatalogueProductInput): Promise<CanonicalProduct>;
  updateProductEconomics(context: TrustedRequestContext, productId: string, update: { costPaise?: number | null; brand?: string | null; category?: string; externalId?: string | null; supplier?: string | null; privateTags?: string[] }): Promise<CanonicalProduct | null>;
  getCurrentPolicy(context: TrustedRequestContext): Promise<PolicyVersionIR | null>;
  getPolicyVersion(context: TrustedRequestContext, versionId: string): Promise<PolicyVersionIR | null>;
  createDraft(context: TrustedRequestContext, proposed?: PolicyVersionIR): Promise<PolicyVersionIR>;
  getDraft(context: TrustedRequestContext, draftId: string): Promise<PolicyVersionIR | null>;
  updateDraft(context: TrustedRequestContext, draftId: string, policy: PolicyVersionIR): Promise<PolicyVersionIR>;
  validateDraft(context: TrustedRequestContext, draftId: string): Promise<PolicyValidationResult>;
  publishDraft(context: TrustedRequestContext, draftId: string): Promise<PolicyVersionIR>;
  resolveDraftDiscrepancy(context: TrustedRequestContext, draftId: string, discrepancyId: string, resolution: string | number | { valueBps?: number; ruleId?: string }): Promise<{ policy: PolicyVersionIR; validation: PolicyValidationResult; discrepancies: PolicyDiscrepancy[] }>;
  recordOffer(context: TrustedRequestContext, offer: OfferRecord): Promise<void>;
  recordApproval(context: TrustedRequestContext, approval: ApprovalLedgerRecord): Promise<void>;
  updateApproval(context: TrustedRequestContext, approvalId: string, update: Pick<ApprovalLedgerRecord, "status" | "decision" | "decidedBy" | "decidedAt">): Promise<void>;
  recordTransaction(context: TrustedRequestContext, transaction: TransactionLedgerRecord): Promise<void>;
  updateTransactionStatus(context: TrustedRequestContext, transactionId: string, status: string): Promise<void>;
  markTransactionPaidOnce(context: TrustedRequestContext, transactionId: string): Promise<boolean>;
  findTransactionByProviderOrder(context: TrustedRequestContext, providerOrderId: string): Promise<TransactionLedgerRecord | null>;
  recordPayment(context: TrustedRequestContext, payment: PaymentLedgerRecord): Promise<void>;
  updatePayment(context: TrustedRequestContext, paymentId: string, update: Pick<PaymentLedgerRecord, "status" | "providerPaymentId">): Promise<void>;
  recordTransactionLines(context: TrustedRequestContext, lines: TransactionLineSnapshot[]): Promise<void>;
  listVerifiedTransactionLines(context: TrustedRequestContext): Promise<TransactionLineSnapshot[]>;
  incrementCustomerAfterVerifiedPayment(context: TrustedRequestContext, customerId: string, amountPaise: number, paidAt?: string): Promise<void>;
  reserveCheckout(context: TrustedRequestContext, input: { sessionId: string; idempotencyKey: string; amountPaise: number; currency: string }): Promise<{ reservation: CheckoutReservationRecord; acquired: boolean }>;
  getCheckoutReservation(context: TrustedRequestContext, sessionId: string, idempotencyKey: string): Promise<CheckoutReservationRecord | null>;
  updateCheckoutReservation(context: TrustedRequestContext, reservationId: string, update: Partial<Pick<CheckoutReservationRecord, "status" | "provider" | "providerOrderId" | "transactionId" | "error">>): Promise<CheckoutReservationRecord | null>;
  recordWebhookReceipt(context: TrustedRequestContext, input: { id: string; provider: string; providerEventId: string; rawBodyHash: string }): Promise<boolean>;
  updateWebhookReceipt(context: TrustedRequestContext, id: string, status: string): Promise<void>;
  recordAudit(context: TrustedRequestContext, event: Omit<AuditEventInput, "organizationId" | "actorType" | "actorId" | "correlationId"> & Partial<Pick<AuditEventInput, "actorType" | "actorId" | "correlationId">>): Promise<void>;
  listAudit(context: TrustedRequestContext, limit?: number): Promise<Array<AuditEventInput & { id: string; createdAt: string }>>;
};

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const externalCustomerId = (shopDomain: string, shopifyCustomerId: string) => `shopify:${shopDomain}:${shopifyCustomerId}`;
const customerIdForExternal = (value: string) => `customer-shopify-${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;

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
  transactions: Map<string, TransactionLedgerRecord>;
  payments: Map<string, PaymentLedgerRecord>;
  transactionLines: Map<string, TransactionLineSnapshot[]>;
  reservations: Map<string, CheckoutReservationRecord>;
  webhookEvents: Set<string>;
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
    transactions: new Map(),
    payments: new Map(),
    transactionLines: new Map(),
    reservations: new Map(),
    webhookEvents: new Set(),
  };
  memoryStates.set(organizationId, state);
  return state;
}

class MemoryCommerceRepository implements CommerceRepository {
  private state(context: TrustedRequestContext) { return memoryState(context.organizationId); }

  async listProducts(context: TrustedRequestContext) { return this.state(context).products; }
  async getProduct(context: TrustedRequestContext, productId: string) { return this.state(context).products.find((product) => product.id === productId) || null; }
  async getCustomer(context: TrustedRequestContext, customerId = "customer-haven-repeat") { return this.state(context).customers.find((customer) => customer.id === customerId) || null; }
  async getOrCreateExternalCustomer(context: TrustedRequestContext, shopDomain: string, shopifyCustomerId: string) {
    const externalId = externalCustomerId(shopDomain, shopifyCustomerId);
    const existing = this.state(context).customers.find((customer) => customer.externalCustomerId === externalId);
    if (existing) return existing;
    const customer: CanonicalCustomer = { id: customerIdForExternal(externalId), organizationId: context.organizationId, externalCustomerId: externalId, emailHash: null, orderCount: 0, lifetimeValuePaise: 0, lastOrderAt: null, attributes: { source: "shopify", shopDomain } };
    this.state(context).customers.push(customer);
    return customer;
  }
  async createSession(context: TrustedRequestContext, customerId = "customer-haven-repeat") {
    const customer = await this.getCustomer(context, customerId);
    if (!customer) throw new Error("Customer is not available in this organization.");
    const session: SessionRecord = { id: id("session"), organizationId: context.organizationId, customerId: customer.id, currency: "INR", status: "OPEN", cartTotalPaise: 0, voiceEnabled: false };
    this.state(context).sessions.set(session.id, session);
    return session;
  }
  async createShopifySession(context: TrustedRequestContext, input: ShopifySessionInput) {
    const customer = input.shopifyCustomerId ? await this.getOrCreateExternalCustomer(context, input.shopDomain, input.shopifyCustomerId) : await this.getCustomer(context, "customer-haven-new");
    if (!customer) throw new Error("Anonymous Shopify customer is not available in this organization.");
    const cartTotalMinorUnits = input.cart?.totals.find((total) => total.type === "total")?.amount || 0;
    const cartTotal = input.currency === "INR" || input.cart?.currency === "INR" ? cartTotalMinorUnits : 0;
    const session: SessionRecord = {
      id: id("session"), organizationId: context.organizationId, customerId: customer.id, currency: input.currency || input.cart?.currency || "USD", status: "OPEN", cartTotalPaise: cartTotal,
      shopifyShopDomain: input.shopDomain, shopifyCustomerId: input.shopifyCustomerId || null, shopifyCartId: input.cart?.id || null, canonicalLineItems: input.cart?.lineItems || [], cartHash: input.cart ? JSON.stringify(input.cart.lineItems) : null, lastSyncedAt: now(),
      voiceEnabled: false,
    };
    this.state(context).sessions.set(session.id, session);
    return session;
  }
  async getSession(context: TrustedRequestContext, sessionId: string) { return this.state(context).sessions.get(sessionId) || null; }
  async updateSessionCart(context: TrustedRequestContext, sessionId: string, update: SessionCartUpdate) {
    const current = await this.getSession(context, sessionId);
    if (!current) return null;
    const next = { ...current, ...(update.currency ? { currency: update.currency } : {}), cartTotalPaise: update.cartTotalPaise, shopifyCartId: update.shopifyCartId === undefined ? current.shopifyCartId : update.shopifyCartId, canonicalLineItems: update.canonicalLineItems, cartHash: update.cartHash === undefined ? current.cartHash : update.cartHash, lastSyncedAt: now() };
    this.state(context).sessions.set(sessionId, next);
    return next;
  }
  async updateSessionVoice(context: TrustedRequestContext, sessionId: string, update: SessionVoiceUpdate) {
    const current = await this.getSession(context, sessionId);
    if (!current) return null;
    const next = { ...current, ...update };
    this.state(context).sessions.set(sessionId, next);
    return next;
  }
  async upsertCatalogueProduct(context: TrustedRequestContext, input: CatalogueProductInput) {
    if (!Number.isSafeInteger(input.listPricePaise) || input.listPricePaise < 0) throw new Error("Public price must be a non-negative integer amount in paise.");
    if (!Number.isSafeInteger(input.stock ?? 0) || (input.stock ?? 0) < 0) throw new Error("Inventory must be a non-negative whole number.");
    const rows = this.state(context).products;
    const current = rows.find((product) => product.sku.toLowerCase() === input.sku.toLowerCase());
    const next: CanonicalProduct = { id: current?.id || input.id || `product-${createHash("sha256").update(`${context.organizationId}:${input.sku}`).digest("hex").slice(0, 24)}`, organizationId: context.organizationId, externalId: input.externalId ?? current?.externalId ?? null, sku: input.sku, name: input.name, description: input.description, category: input.category, brand: input.brand ?? current?.brand ?? null, currency: input.currency || current?.currency || "INR", listPricePaise: input.listPricePaise, costPaise: input.costPaise === undefined ? current?.costPaise ?? null : input.costPaise, stock: input.stock ?? current?.stock ?? 0, attributes: input.attributes || current?.attributes || {}, tags: input.tags || current?.tags || [], imageUrl: input.imageUrl ?? current?.imageUrl ?? null, source: input.source || current?.source || "bootstrap", sourceUpdatedAt: new Date() };
    if (current) rows[rows.indexOf(current)] = next; else rows.push(next);
    return next;
  }
  async updateProductEconomics(context: TrustedRequestContext, productId: string, update: { costPaise?: number | null; brand?: string | null; category?: string; externalId?: string | null; supplier?: string | null; privateTags?: string[] }) {
    const product = await this.getProduct(context, productId);
    if (!product) return null;
    if (update.costPaise !== undefined && update.costPaise !== null && (!Number.isSafeInteger(update.costPaise) || update.costPaise < 0)) throw new Error("Private product cost must be a non-negative integer amount in paise.");
    const next = { ...product, ...(update.costPaise !== undefined ? { costPaise: update.costPaise } : {}), ...(update.brand !== undefined ? { brand: update.brand } : {}), ...(update.category !== undefined ? { category: update.category } : {}), ...(update.externalId !== undefined ? { externalId: update.externalId } : {}), attributes: { ...product.attributes, ...(update.supplier === undefined ? {} : { supplier: update.supplier }), ...(update.privateTags === undefined ? {} : { privateTags: update.privateTags }) } };
    const rows = this.state(context).products;
    rows[rows.findIndex((row) => row.id === productId)] = next;
    return next;
  }
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
  async recordApproval() { /* Runtime records are the source of truth in memory-backed tests. */ }
  async updateApproval() { /* Runtime records are the source of truth in memory-backed tests. */ }
  async recordTransaction(context: TrustedRequestContext, transaction: TransactionLedgerRecord) { this.state(context).transactions.set(transaction.id, { ...transaction }); }
  async updateTransactionStatus(context: TrustedRequestContext, transactionId: string, status: string) { const transaction = this.state(context).transactions.get(transactionId); if (transaction) transaction.status = status; }
  async markTransactionPaidOnce(context: TrustedRequestContext, transactionId: string) { const transaction = this.state(context).transactions.get(transactionId); if (!transaction || transaction.status === "PAID") return false; transaction.status = "PAID"; return true; }
  async findTransactionByProviderOrder(context: TrustedRequestContext, providerOrderId: string) { return [...this.state(context).transactions.values()].find((transaction) => transaction.providerOrderId === providerOrderId) || null; }
  async recordPayment(context: TrustedRequestContext, payment: PaymentLedgerRecord) { this.state(context).payments.set(payment.id, { ...payment }); }
  async updatePayment(context: TrustedRequestContext, paymentId: string, update: Pick<PaymentLedgerRecord, "status" | "providerPaymentId">) { const payment = this.state(context).payments.get(paymentId); if (payment) Object.assign(payment, update); }
  async recordTransactionLines(context: TrustedRequestContext, lines: TransactionLineSnapshot[]) { if (!lines.length) return; this.state(context).transactionLines.set(lines[0].transactionId, lines.map((line) => ({ ...line }))); }
  async listVerifiedTransactionLines(context: TrustedRequestContext) { return [...this.state(context).transactions.values()].filter((transaction) => transaction.status === "PAID").flatMap((transaction) => this.state(context).transactionLines.get(transaction.id) || []); }
  async incrementCustomerAfterVerifiedPayment(context: TrustedRequestContext, customerId: string, amountPaise: number, paidAt = now()) { const customer = await this.getCustomer(context, customerId); if (!customer) return; customer.orderCount += 1; customer.lifetimeValuePaise += amountPaise; customer.lastOrderAt = new Date(paidAt); }
  async reserveCheckout(context: TrustedRequestContext, input: { sessionId: string; idempotencyKey: string; amountPaise: number; currency: string }) {
    const state = this.state(context);
    const key = `${input.sessionId}:${input.idempotencyKey}`;
    const existing = state.reservations.get(key);
    if (existing && existing.status !== "FAILED") return { reservation: existing, acquired: false };
    const reservation: CheckoutReservationRecord = { id: existing?.id || id("checkout-reservation"), organizationId: context.organizationId, sessionId: input.sessionId, idempotencyKey: input.idempotencyKey, status: "CREATING", amountPaise: input.amountPaise, currency: input.currency, provider: null, providerOrderId: null, transactionId: null, error: null, createdAt: existing?.createdAt || now(), updatedAt: now() };
    state.reservations.set(key, reservation);
    return { reservation, acquired: true };
  }
  async getCheckoutReservation(context: TrustedRequestContext, sessionId: string, idempotencyKey: string) { return this.state(context).reservations.get(`${sessionId}:${idempotencyKey}`) || null; }
  async updateCheckoutReservation(context: TrustedRequestContext, reservationId: string, update: Partial<Pick<CheckoutReservationRecord, "status" | "provider" | "providerOrderId" | "transactionId" | "error">>) { const state = this.state(context); const reservation = [...state.reservations.values()].find((item) => item.id === reservationId); if (!reservation) return null; Object.assign(reservation, update, { updatedAt: now() }); return reservation; }
  async recordWebhookReceipt(context: TrustedRequestContext, input: { id: string; provider: string; providerEventId: string; rawBodyHash: string }) { const key = `${input.provider}:${input.providerEventId}`; const events = this.state(context).webhookEvents; if (events.has(key)) return false; events.add(key); return true; }
  async updateWebhookReceipt() { /* Memory receipt state is sufficient for tests. */ }
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

function reservationFromRow(row: typeof checkoutReservations.$inferSelect): CheckoutReservationRecord {
  return { id: row.id, organizationId: row.organizationId, sessionId: row.shoppingSessionId, idempotencyKey: row.idempotencyKey, status: row.status as CheckoutReservationStatus, provider: row.provider, providerOrderId: row.providerOrderId, transactionId: row.transactionId, amountPaise: row.amountPaise, currency: row.currency, error: row.error, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

function sessionFromRow(row: Pick<typeof shoppingSessions.$inferSelect, "id" | "organizationId" | "customerId" | "currency" | "status" | "cart" | "shopifyShopDomain" | "shopifyCustomerId" | "shopifyCartId" | "salespersonProfileId" | "preferredLanguage" | "detectedLanguage" | "preferredScript" | "voiceEnabled" | "voicePace" | "canonicalLineItems" | "cartHash" | "lastSyncedAt">): SessionRecord {
  const cart = typeof row.cart === "object" && row.cart ? row.cart : {};
  const total = typeof cart.totalPaise === "number" ? cart.totalPaise : 0;
  return { id: row.id, organizationId: row.organizationId, customerId: row.customerId, currency: row.currency, status: row.status, cartTotalPaise: total, shopifyShopDomain: row.shopifyShopDomain, shopifyCustomerId: row.shopifyCustomerId, shopifyCartId: row.shopifyCartId, salespersonProfileId: row.salespersonProfileId, preferredLanguage: row.preferredLanguage, detectedLanguage: row.detectedLanguage, preferredScript: row.preferredScript, voiceEnabled: row.voiceEnabled, voicePace: row.voicePace, canonicalLineItems: row.canonicalLineItems || [], cartHash: row.cartHash, lastSyncedAt: row.lastSyncedAt?.toISOString() || null };
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
    const session = { id: id("session"), organizationId: context.organizationId, customerId: customer.id, currency: "INR", status: "OPEN", cart: { totalPaise: 0 }, salespersonProfileId: null, preferredLanguage: null, detectedLanguage: null, preferredScript: null, voiceEnabled: false, voicePace: null };
    await getDb().insert(shoppingSessions).values(session);
    return { id: session.id, organizationId: session.organizationId, customerId: session.customerId, currency: session.currency, status: session.status, cartTotalPaise: 0 };
  }
  private async getOrCreateExternalCustomer(context: TrustedRequestContext, shopDomain: string, shopifyCustomerId: string) {
    const externalId = externalCustomerId(shopDomain, shopifyCustomerId);
    const existing = await getDb().select().from(customers).where(and(eq(customers.organizationId, context.organizationId), eq(customers.externalCustomerId, externalId))).limit(1);
    if (existing[0]) return customerFromRow(existing[0]);
    const customer = { id: customerIdForExternal(externalId), organizationId: context.organizationId, externalCustomerId: externalId, emailHash: null, orderCount: 0, lifetimeValuePaise: 0, lastOrderAt: null, attributes: { source: "shopify", shopDomain } };
    await getDb().insert(customers).values(customer).onConflictDoNothing();
    const created = await getDb().select().from(customers).where(and(eq(customers.organizationId, context.organizationId), eq(customers.externalCustomerId, externalId))).limit(1);
    return created[0] ? customerFromRow(created[0]) : null;
  }
  async createShopifySession(context: TrustedRequestContext, input: ShopifySessionInput) {
    const customer = input.shopifyCustomerId ? await this.getOrCreateExternalCustomer(context, input.shopDomain, input.shopifyCustomerId) : await this.getCustomer(context, "customer-haven-new");
    if (!customer) throw new Error("Anonymous Shopify customer is not available in this organization.");
    const cartTotalMinorUnits = input.cart?.totals.find((total) => total.type === "total")?.amount || 0;
    const cartTotal = input.currency === "INR" || input.cart?.currency === "INR" ? cartTotalMinorUnits : 0;
    const session = { id: id("session"), organizationId: context.organizationId, customerId: customer.id, currency: input.currency || input.cart?.currency || "USD", status: "OPEN", cart: { totalPaise: cartTotal, totalMinorUnits: cartTotalMinorUnits, source: "shopify_ucp" }, shopifyShopDomain: input.shopDomain, shopifyCustomerId: input.shopifyCustomerId || null, shopifyCartId: input.cart?.id || null, salespersonProfileId: null, preferredLanguage: null, detectedLanguage: null, preferredScript: null, voiceEnabled: false, voicePace: null, canonicalLineItems: input.cart?.lineItems || [], cartHash: input.cart ? JSON.stringify(input.cart.lineItems) : null, lastSyncedAt: new Date() };
    await getDb().insert(shoppingSessions).values(session);
    return sessionFromRow(session);
  }
  async getSession(context: TrustedRequestContext, sessionId: string) {
    const rows = await getDb().select().from(shoppingSessions).where(and(eq(shoppingSessions.organizationId, context.organizationId), eq(shoppingSessions.id, sessionId))).limit(1);
    const row = rows[0];
    if (!row) return null;
    return sessionFromRow(row);
  }
  async updateSessionCart(context: TrustedRequestContext, sessionId: string, update: SessionCartUpdate) {
    const current = await this.getSession(context, sessionId);
    if (!current) return null;
    await getDb().update(shoppingSessions).set({ ...(update.currency ? { currency: update.currency } : {}), cart: { totalPaise: update.cartTotalPaise }, shopifyCartId: update.shopifyCartId === undefined ? current.shopifyCartId : update.shopifyCartId, canonicalLineItems: update.canonicalLineItems, cartHash: update.cartHash === undefined ? current.cartHash : update.cartHash, lastSyncedAt: new Date(), updatedAt: new Date() }).where(and(eq(shoppingSessions.organizationId, context.organizationId), eq(shoppingSessions.id, sessionId)));
    return this.getSession(context, sessionId);
  }
  async updateSessionVoice(context: TrustedRequestContext, sessionId: string, update: SessionVoiceUpdate) {
    const current = await this.getSession(context, sessionId);
    if (!current) return null;
    await getDb().update(shoppingSessions).set({ salespersonProfileId: update.salespersonProfileId === undefined ? current.salespersonProfileId || null : update.salespersonProfileId, preferredLanguage: update.preferredLanguage === undefined ? current.preferredLanguage || null : update.preferredLanguage, detectedLanguage: update.detectedLanguage === undefined ? current.detectedLanguage || null : update.detectedLanguage, preferredScript: update.preferredScript === undefined ? current.preferredScript || null : update.preferredScript, voiceEnabled: update.voiceEnabled === undefined ? Boolean(current.voiceEnabled) : update.voiceEnabled, voicePace: update.voicePace === undefined ? current.voicePace || null : update.voicePace, updatedAt: new Date() }).where(and(eq(shoppingSessions.organizationId, context.organizationId), eq(shoppingSessions.id, sessionId)));
    return this.getSession(context, sessionId);
  }
  async upsertCatalogueProduct(context: TrustedRequestContext, input: CatalogueProductInput) {
    if (!Number.isSafeInteger(input.listPricePaise) || input.listPricePaise < 0) throw new Error("Public price must be a non-negative integer amount in paise.");
    if (!Number.isSafeInteger(input.stock ?? 0) || (input.stock ?? 0) < 0) throw new Error("Inventory must be a non-negative whole number.");
    const existing = await getDb().select().from(products).where(and(eq(products.organizationId, context.organizationId), eq(products.sku, input.sku))).limit(1);
    const idValue = existing[0]?.id || input.id || `product-${createHash("sha256").update(`${context.organizationId}:${input.sku}`).digest("hex").slice(0, 24)}`;
    await getDb().insert(products).values({ id: idValue, organizationId: context.organizationId, externalId: input.externalId ?? null, sku: input.sku, name: input.name, description: input.description, category: input.category, brand: input.brand ?? null, currency: input.currency || "INR", listPricePaise: input.listPricePaise, costPaise: input.costPaise ?? null, stock: input.stock ?? 0, attributes: input.attributes || {}, tags: input.tags || [], imageUrl: input.imageUrl ?? null, source: input.source || "bootstrap", sourceUpdatedAt: new Date() }).onConflictDoUpdate({ target: [products.organizationId, products.sku], set: { externalId: input.externalId ?? null, name: input.name, description: input.description, category: input.category, brand: input.brand ?? null, currency: input.currency || "INR", listPricePaise: input.listPricePaise, ...(input.costPaise === undefined ? {} : { costPaise: input.costPaise }), stock: input.stock ?? 0, attributes: input.attributes || {}, tags: input.tags || [], imageUrl: input.imageUrl ?? null, source: input.source || "bootstrap", sourceUpdatedAt: new Date(), updatedAt: new Date() } });
    const saved = await this.getProduct(context, idValue);
    if (!saved) throw new Error("Catalogue product could not be persisted.");
    return saved;
  }
  async updateProductEconomics(context: TrustedRequestContext, productId: string, update: { costPaise?: number | null; brand?: string | null; category?: string; externalId?: string | null; supplier?: string | null; privateTags?: string[] }) {
    if (update.costPaise !== undefined && update.costPaise !== null && (!Number.isSafeInteger(update.costPaise) || update.costPaise < 0)) throw new Error("Private product cost must be a non-negative integer amount in paise.");
    const current = await this.getProduct(context, productId);
    if (!current) return null;
    const attributes = { ...current.attributes, ...(update.supplier === undefined ? {} : { supplier: update.supplier }), ...(update.privateTags === undefined ? {} : { privateTags: update.privateTags }) };
    await getDb().update(products).set({ ...(update.costPaise !== undefined ? { costPaise: update.costPaise } : {}), ...(update.brand !== undefined ? { brand: update.brand } : {}), ...(update.category !== undefined ? { category: update.category } : {}), ...(update.externalId !== undefined ? { externalId: update.externalId } : {}), attributes, updatedAt: new Date() }).where(and(eq(products.organizationId, context.organizationId), eq(products.id, productId)));
    return this.getProduct(context, productId);
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
  async recordApproval(context: TrustedRequestContext, approval: ApprovalLedgerRecord) {
    await getDb().insert(approvalRequests).values({ id: approval.id, organizationId: context.organizationId, offerId: approval.offerId, status: approval.status, decision: approval.decision ?? null, decidedBy: approval.decidedBy ?? null, decidedAt: approval.decidedAt ? new Date(approval.decidedAt) : null, createdAt: approval.createdAt ? new Date(approval.createdAt) : undefined }).onConflictDoNothing();
  }
  async updateApproval(context: TrustedRequestContext, approvalId: string, update: Pick<ApprovalLedgerRecord, "status" | "decision" | "decidedBy" | "decidedAt">) {
    await getDb().update(approvalRequests).set({ status: update.status, decision: update.decision ?? null, decidedBy: update.decidedBy ?? null, decidedAt: update.decidedAt ? new Date(update.decidedAt) : null }).where(and(eq(approvalRequests.organizationId, context.organizationId), eq(approvalRequests.id, approvalId)));
  }
  async recordTransaction(context: TrustedRequestContext, transaction: TransactionLedgerRecord) {
    await getDb().insert(commerceTransactions).values({ id: transaction.id, organizationId: context.organizationId, shoppingSessionId: transaction.sessionId, offerId: transaction.offerId ?? null, policyVersionId: transaction.policyVersionId, status: transaction.status, totalPaise: transaction.totalPaise, currency: transaction.currency, provider: transaction.provider ?? null, providerOrderId: transaction.providerOrderId ?? null, idempotencyKey: transaction.idempotencyKey ?? null, createdAt: transaction.createdAt ? new Date(transaction.createdAt) : undefined }).onConflictDoNothing();
  }
  async updateTransactionStatus(context: TrustedRequestContext, transactionId: string, status: string) {
    await getDb().update(commerceTransactions).set({ status }).where(and(eq(commerceTransactions.organizationId, context.organizationId), eq(commerceTransactions.id, transactionId)));
  }
  async markTransactionPaidOnce(context: TrustedRequestContext, transactionId: string) {
    const rows = await getDb().update(commerceTransactions).set({ status: "PAID" }).where(and(eq(commerceTransactions.organizationId, context.organizationId), eq(commerceTransactions.id, transactionId), ne(commerceTransactions.status, "PAID"))).returning({ id: commerceTransactions.id });
    return rows.length > 0;
  }
  async findTransactionByProviderOrder(context: TrustedRequestContext, providerOrderId: string) {
    const rows = await getDb().select().from(commerceTransactions).where(and(eq(commerceTransactions.organizationId, context.organizationId), eq(commerceTransactions.providerOrderId, providerOrderId))).limit(1);
    const row = rows[0];
    return row ? { id: row.id, sessionId: row.shoppingSessionId, offerId: row.offerId, policyVersionId: row.policyVersionId, status: row.status, totalPaise: row.totalPaise, currency: row.currency, provider: row.provider, providerOrderId: row.providerOrderId, idempotencyKey: row.idempotencyKey, createdAt: row.createdAt.toISOString() } : null;
  }
  async recordPayment(context: TrustedRequestContext, payment: PaymentLedgerRecord) {
    await getDb().insert(paymentRecords).values({ id: payment.id, organizationId: context.organizationId, transactionId: payment.transactionId, provider: payment.provider, providerPaymentId: payment.providerPaymentId ?? null, status: payment.status, amountPaise: payment.amountPaise, currency: payment.currency, createdAt: payment.createdAt ? new Date(payment.createdAt) : undefined }).onConflictDoNothing();
  }
  async updatePayment(context: TrustedRequestContext, paymentId: string, update: Pick<PaymentLedgerRecord, "status" | "providerPaymentId">) {
    await getDb().update(paymentRecords).set({ status: update.status, providerPaymentId: update.providerPaymentId ?? null }).where(and(eq(paymentRecords.organizationId, context.organizationId), eq(paymentRecords.id, paymentId)));
  }
  async recordTransactionLines(context: TrustedRequestContext, lines: TransactionLineSnapshot[]) {
    if (!lines.length) return;
    await getDb().insert(commerceTransactionLines).values(lines.map((line) => ({ id: line.id, organizationId: context.organizationId, transactionId: line.transactionId, productId: line.productId ?? null, shopifyProductGid: line.shopifyProductGid ?? null, shopifyVariantGid: line.shopifyVariantGid ?? null, sku: line.sku ?? null, productTitle: line.productTitle, quantity: line.quantity, unitPublicPricePaise: line.unitPublicPricePaise, authorizedUnitPricePaise: line.authorizedUnitPricePaise, lineTotalPaise: line.lineTotalPaise, currency: line.currency, growthPlayId: line.growthPlayId ?? null, snapshotStatus: line.snapshotStatus || "IMMUTABLE" }))).onConflictDoNothing();
  }
  async listVerifiedTransactionLines(context: TrustedRequestContext) {
    const paid = await getDb().select({ id: commerceTransactions.id }).from(commerceTransactions).where(and(eq(commerceTransactions.organizationId, context.organizationId), eq(commerceTransactions.status, "PAID")));
    if (!paid.length) return [];
    const rows = await getDb().select().from(commerceTransactionLines).where(and(eq(commerceTransactionLines.organizationId, context.organizationId), inArray(commerceTransactionLines.transactionId, paid.map((row) => row.id))));
    return rows.map((row) => ({ id: row.id, transactionId: row.transactionId, productId: row.productId, shopifyProductGid: row.shopifyProductGid, shopifyVariantGid: row.shopifyVariantGid, sku: row.sku, productTitle: row.productTitle, quantity: row.quantity, unitPublicPricePaise: row.unitPublicPricePaise, authorizedUnitPricePaise: row.authorizedUnitPricePaise, lineTotalPaise: row.lineTotalPaise, currency: row.currency, growthPlayId: row.growthPlayId, snapshotStatus: row.snapshotStatus }));
  }
  async incrementCustomerAfterVerifiedPayment(context: TrustedRequestContext, customerId: string, amountPaise: number, paidAt = now()) {
    await getDb().update(customers).set({ orderCount: sql`${customers.orderCount} + 1`, lifetimeValuePaise: sql`${customers.lifetimeValuePaise} + ${amountPaise}`, lastOrderAt: new Date(paidAt), updatedAt: new Date() }).where(and(eq(customers.organizationId, context.organizationId), eq(customers.id, customerId)));
  }
  async reserveCheckout(context: TrustedRequestContext, input: { sessionId: string; idempotencyKey: string; amountPaise: number; currency: string }) {
    const createdAt = new Date();
    const idValue = id("checkout-reservation");
    const values = { id: idValue, organizationId: context.organizationId, shoppingSessionId: input.sessionId, idempotencyKey: input.idempotencyKey, status: "CREATING", amountPaise: input.amountPaise, currency: input.currency, provider: null, providerOrderId: null, transactionId: null, error: null, createdAt, updatedAt: createdAt };
    const inserted = await getDb().insert(checkoutReservations).values(values).onConflictDoNothing().returning();
    if (inserted[0]) return { reservation: reservationFromRow(inserted[0]), acquired: true };
    const rows = await getDb().select().from(checkoutReservations).where(and(eq(checkoutReservations.organizationId, context.organizationId), eq(checkoutReservations.shoppingSessionId, input.sessionId), eq(checkoutReservations.idempotencyKey, input.idempotencyKey))).limit(1);
    const existing = rows[0];
    if (!existing) throw new Error("Checkout reservation could not be read after conflict.");
    if (existing.status === "FAILED") {
      const retried = await getDb().update(checkoutReservations).set({ status: "CREATING", amountPaise: input.amountPaise, currency: input.currency, error: null, updatedAt: new Date() }).where(and(eq(checkoutReservations.organizationId, context.organizationId), eq(checkoutReservations.id, existing.id), eq(checkoutReservations.status, "FAILED"))).returning();
      if (retried[0]) return { reservation: reservationFromRow(retried[0]), acquired: true };
    }
    return { reservation: reservationFromRow(existing), acquired: false };
  }
  async getCheckoutReservation(context: TrustedRequestContext, sessionId: string, idempotencyKey: string) {
    const rows = await getDb().select().from(checkoutReservations).where(and(eq(checkoutReservations.organizationId, context.organizationId), eq(checkoutReservations.shoppingSessionId, sessionId), eq(checkoutReservations.idempotencyKey, idempotencyKey))).limit(1);
    return rows[0] ? reservationFromRow(rows[0]) : null;
  }
  async updateCheckoutReservation(context: TrustedRequestContext, reservationId: string, update: Partial<Pick<CheckoutReservationRecord, "status" | "provider" | "providerOrderId" | "transactionId" | "error">>) {
    const rows = await getDb().update(checkoutReservations).set({ ...update, updatedAt: new Date() }).where(and(eq(checkoutReservations.organizationId, context.organizationId), eq(checkoutReservations.id, reservationId))).returning();
    return rows[0] ? reservationFromRow(rows[0]) : null;
  }
  async recordWebhookReceipt(context: TrustedRequestContext, input: { id: string; provider: string; providerEventId: string; rawBodyHash: string }) {
    const inserted = await getDb().insert(paymentWebhookEvents).values({ id: input.id, organizationId: context.organizationId, provider: input.provider, providerEventId: input.providerEventId, rawBodyHash: input.rawBodyHash, status: "RECEIVED" }).onConflictDoNothing().returning({ id: paymentWebhookEvents.id });
    return inserted.length > 0;
  }
  async updateWebhookReceipt(context: TrustedRequestContext, idValue: string, status: string) { await getDb().update(paymentWebhookEvents).set({ status, processedAt: new Date() }).where(and(eq(paymentWebhookEvents.organizationId, context.organizationId), eq(paymentWebhookEvents.id, idValue))); }
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
