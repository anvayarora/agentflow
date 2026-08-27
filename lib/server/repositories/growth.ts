import { and, desc, eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "../../../db";
import { growthAttributions, growthOpportunities, growthPlays, growthSignals, inventorySnapshots } from "../../../db/schema";
import type { TrustedRequestContext } from "../context";
import { getCommerceRepository } from "./commerce";
import { growthOpportunitySchema, growthPlaySchema, growthSignalSchema, type GrowthOpportunity, type GrowthPlay, type GrowthSignal, type GrowthOpportunityStatus, type GrowthPlayStatus } from "../../growth/types";

export type InventorySnapshot = { id: string; organizationId: string; productId: string; variantId?: string | null; quantity: number; observedAt: string; source: string };
export type GrowthAttribution = { id: string; organizationId: string; growthPlayId: string; transactionId: string; baselineCartAmountPaise: number; actualPaidAmountPaise: number; incrementalAovPaise: number; verified: boolean; createdAt: string };

type GrowthState = { inventory: InventorySnapshot[]; signals: GrowthSignal[]; opportunities: GrowthOpportunity[]; plays: GrowthPlay[]; attributions: GrowthAttribution[] };
const memory = new Map<string, GrowthState>();
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
function state(organizationId: string): GrowthState {
  const existing = memory.get(organizationId);
  if (existing) return existing;
  const created = { inventory: [], signals: [], opportunities: [], plays: [], attributions: [] };
  memory.set(organizationId, created);
  return created;
}
function owned<T extends { organizationId: string }>(record: T, context: TrustedRequestContext) {
  if (record.organizationId !== context.organizationId) throw new Error("Growth record is not owned by this organization.");
  return record;
}

export class GrowthRepository {
  async listInventorySnapshots(context: TrustedRequestContext, productId?: string) {
    if (!isDatabaseConfigured()) return state(context.organizationId).inventory.filter((row) => !productId || row.productId === productId).sort((a, b) => b.observedAt.localeCompare(a.observedAt));
    const where = productId ? and(eq(inventorySnapshots.organizationId, context.organizationId), eq(inventorySnapshots.productId, productId)) : eq(inventorySnapshots.organizationId, context.organizationId);
    const rows = await getDb().select().from(inventorySnapshots).where(where).orderBy(desc(inventorySnapshots.observedAt));
    return rows.map((row) => ({ id: row.id, organizationId: row.organizationId, productId: row.productId, variantId: row.variantId, quantity: row.quantity, observedAt: row.observedAt.toISOString(), source: row.source }));
  }

  async recordInventorySnapshot(context: TrustedRequestContext, input: Omit<InventorySnapshot, "id" | "organizationId"> & { id?: string }) {
    const snapshot: InventorySnapshot = { ...input, id: input.id || id("inventory"), organizationId: context.organizationId };
    if (!Number.isSafeInteger(snapshot.quantity) || snapshot.quantity < 0) throw new Error("Inventory quantity must be a non-negative integer.");
    if (!isDatabaseConfigured()) { state(context.organizationId).inventory.push(snapshot); return snapshot; }
    await getDb().insert(inventorySnapshots).values({ id: snapshot.id, organizationId: snapshot.organizationId, productId: snapshot.productId, variantId: snapshot.variantId || null, quantity: snapshot.quantity, observedAt: new Date(snapshot.observedAt), source: snapshot.source }).onConflictDoNothing();
    return snapshot;
  }

  async upsertSignal(context: TrustedRequestContext, input: Omit<GrowthSignal, "id" | "organizationId" | "createdAt"> & { id?: string }) {
    const signal = growthSignalSchema.parse({ ...input, id: input.id || id("signal"), organizationId: context.organizationId, calculatedAt: input.calculatedAt || now() });
    if (!isDatabaseConfigured()) {
      const current = state(context.organizationId).signals.find((row) => row.type === signal.type && row.productId === signal.productId && row.relatedProductId === signal.relatedProductId);
      if (current) { Object.assign(current, signal); return current; }
      state(context.organizationId).signals.push(signal); return signal;
    }
    await getDb().insert(growthSignals).values({ id: signal.id, organizationId: signal.organizationId, type: signal.type, productId: signal.productId || null, variantId: signal.variantId || null, relatedProductId: signal.relatedProductId || null, severity: signal.severity, confidenceBps: signal.confidenceBps, evidence: signal.evidence, calculatedAt: new Date(signal.calculatedAt) }).onConflictDoUpdate({ target: growthSignals.id, set: { severity: signal.severity, confidenceBps: signal.confidenceBps, evidence: signal.evidence, calculatedAt: new Date(signal.calculatedAt) } });
    return signal;
  }

  async listSignals(context: TrustedRequestContext) {
    if (!isDatabaseConfigured()) return [...state(context.organizationId).signals].sort((a, b) => b.calculatedAt.localeCompare(a.calculatedAt));
    const rows = await getDb().select().from(growthSignals).where(eq(growthSignals.organizationId, context.organizationId)).orderBy(desc(growthSignals.calculatedAt));
    return rows.map((row) => growthSignalSchema.parse({ id: row.id, organizationId: row.organizationId, type: row.type, productId: row.productId, variantId: row.variantId, relatedProductId: row.relatedProductId, severity: row.severity, confidenceBps: row.confidenceBps, evidence: row.evidence, calculatedAt: row.calculatedAt.toISOString() }));
  }

  async createOpportunity(context: TrustedRequestContext, input: Omit<GrowthOpportunity, "id" | "organizationId" | "createdAt" | "updatedAt"> & { id?: string }) {
    const opportunity = growthOpportunitySchema.parse({ ...input, id: input.id || id("opportunity"), organizationId: context.organizationId, createdAt: now(), updatedAt: now() });
    if (!isDatabaseConfigured()) { state(context.organizationId).opportunities.push(opportunity); return opportunity; }
    await getDb().insert(growthOpportunities).values({ id: opportunity.id, organizationId: opportunity.organizationId, type: opportunity.type, sourceSignalIds: opportunity.sourceSignalIds, primaryProductId: opportunity.primaryProductId, secondaryProductIds: opportunity.secondaryProductIds, proposedAction: opportunity.proposedAction, estimatedImpact: opportunity.estimatedImpact, evidence: opportunity.evidence, riskFlags: opportunity.riskFlags, policyCompatibility: opportunity.policyCompatibility, scoreBps: opportunity.scoreBps, status: opportunity.status }).onConflictDoUpdate({ target: growthOpportunities.id, set: { proposedAction: opportunity.proposedAction, estimatedImpact: opportunity.estimatedImpact, evidence: opportunity.evidence, riskFlags: opportunity.riskFlags, policyCompatibility: opportunity.policyCompatibility, scoreBps: opportunity.scoreBps, status: opportunity.status, updatedAt: new Date() } });
    return opportunity;
  }

  async listOpportunities(context: TrustedRequestContext, status?: GrowthOpportunityStatus) {
    if (!isDatabaseConfigured()) return [...state(context.organizationId).opportunities].filter((row) => !status || row.status === status).sort((a, b) => b.scoreBps - a.scoreBps);
    const rows = await getDb().select().from(growthOpportunities).where(eq(growthOpportunities.organizationId, context.organizationId)).orderBy(desc(growthOpportunities.scoreBps));
    return rows.map((row) => growthOpportunitySchema.parse({ id: row.id, organizationId: row.organizationId, type: row.type, sourceSignalIds: row.sourceSignalIds, primaryProductId: row.primaryProductId, secondaryProductIds: row.secondaryProductIds, proposedAction: row.proposedAction, estimatedImpact: row.estimatedImpact, evidence: row.evidence, riskFlags: row.riskFlags, policyCompatibility: row.policyCompatibility, scoreBps: row.scoreBps, status: row.status, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })).filter((row) => !status || row.status === status);
  }

  async getOpportunity(context: TrustedRequestContext, opportunityId: string) {
    if (!isDatabaseConfigured()) return state(context.organizationId).opportunities.find((row) => row.id === opportunityId) || null;
    const rows = await getDb().select().from(growthOpportunities).where(and(eq(growthOpportunities.organizationId, context.organizationId), eq(growthOpportunities.id, opportunityId))).limit(1);
    const row = rows[0];
    return row ? growthOpportunitySchema.parse({ id: row.id, organizationId: row.organizationId, type: row.type, sourceSignalIds: row.sourceSignalIds, primaryProductId: row.primaryProductId, secondaryProductIds: row.secondaryProductIds, proposedAction: row.proposedAction, estimatedImpact: row.estimatedImpact, evidence: row.evidence, riskFlags: row.riskFlags, policyCompatibility: row.policyCompatibility, scoreBps: row.scoreBps, status: row.status, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }) : null;
  }

  async updateOpportunityStatus(context: TrustedRequestContext, opportunityId: string, status: GrowthOpportunityStatus) {
    const opportunity = await this.getOpportunity(context, opportunityId);
    if (!opportunity) return null;
    owned(opportunity, context);
    if (!isDatabaseConfigured()) { const next = { ...opportunity, status, updatedAt: now() }; const rows = state(context.organizationId).opportunities; rows[rows.findIndex((row) => row.id === opportunityId)] = next; return next; }
    await getDb().update(growthOpportunities).set({ status, updatedAt: new Date() }).where(and(eq(growthOpportunities.organizationId, context.organizationId), eq(growthOpportunities.id, opportunityId)));
    return { ...opportunity, status, updatedAt: now() };
  }

  async createPlay(context: TrustedRequestContext, input: Omit<GrowthPlay, "id" | "organizationId" | "createdAt" | "updatedAt"> & { id?: string }) {
    const play = growthPlaySchema.parse({ ...input, id: input.id || id("play"), organizationId: context.organizationId, createdAt: now(), updatedAt: now() });
    if (!isDatabaseConfigured()) { state(context.organizationId).plays.push(play); return play; }
    await getDb().insert(growthPlays).values({ id: play.id, organizationId: play.organizationId, opportunityId: play.opportunityId, primaryProductId: play.primaryProductId, secondaryProductIds: play.secondaryProductIds, eligibility: play.eligibility, commercialStrategy: play.commercialStrategy, maxIncentiveBps: play.maxIncentiveBps, minimumMarginBps: play.minimumMarginBps, requiredPolicyChecks: play.requiredPolicyChecks, customerEligibility: play.customerEligibility, frequencyLimit: play.frequencyLimit, expiresAt: play.expiresAt ? new Date(play.expiresAt) : null, approvalRequired: play.approvalRequired, status: play.status }).onConflictDoUpdate({ target: growthPlays.id, set: { status: play.status, commercialStrategy: play.commercialStrategy, maxIncentiveBps: play.maxIncentiveBps, updatedAt: new Date() } });
    return play;
  }

  async listPlays(context: TrustedRequestContext) {
    if (!isDatabaseConfigured()) return [...state(context.organizationId).plays].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const rows = await getDb().select().from(growthPlays).where(eq(growthPlays.organizationId, context.organizationId)).orderBy(desc(growthPlays.updatedAt));
    return rows.map((row) => growthPlaySchema.parse({ id: row.id, organizationId: row.organizationId, opportunityId: row.opportunityId, primaryProductId: row.primaryProductId, secondaryProductIds: row.secondaryProductIds, eligibility: row.eligibility, commercialStrategy: row.commercialStrategy, maxIncentiveBps: row.maxIncentiveBps, minimumMarginBps: row.minimumMarginBps, requiredPolicyChecks: row.requiredPolicyChecks, customerEligibility: row.customerEligibility, frequencyLimit: row.frequencyLimit, expiresAt: row.expiresAt?.toISOString() || null, approvalRequired: row.approvalRequired, status: row.status, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }));
  }

  async getPlay(context: TrustedRequestContext, playId: string) {
    const plays = await this.listPlays(context);
    return plays.find((play) => play.id === playId) || null;
  }

  async updatePlayStatus(context: TrustedRequestContext, playId: string, status: GrowthPlayStatus) {
    const play = await this.getPlay(context, playId);
    if (!play) return null;
    owned(play, context);
    if (!isDatabaseConfigured()) { const next = { ...play, status, updatedAt: now() }; const rows = state(context.organizationId).plays; rows[rows.findIndex((row) => row.id === playId)] = next; return next; }
    await getDb().update(growthPlays).set({ status, updatedAt: new Date() }).where(and(eq(growthPlays.organizationId, context.organizationId), eq(growthPlays.id, playId)));
    return { ...play, status, updatedAt: now() };
  }

  async createAttribution(context: TrustedRequestContext, input: Omit<GrowthAttribution, "id" | "organizationId" | "createdAt"> & { id?: string }) {
    const attribution = { ...input, id: input.id || id("attribution"), organizationId: context.organizationId, createdAt: now() };
    if (!isDatabaseConfigured()) { state(context.organizationId).attributions.push(attribution); return attribution; }
    await getDb().insert(growthAttributions).values({ id: attribution.id, organizationId: attribution.organizationId, growthPlayId: attribution.growthPlayId, transactionId: attribution.transactionId, baselineCartAmountPaise: attribution.baselineCartAmountPaise, actualPaidAmountPaise: attribution.actualPaidAmountPaise, incrementalAovPaise: attribution.incrementalAovPaise, verified: attribution.verified });
    return attribution;
  }

  async updateProductEconomics(context: TrustedRequestContext, productId: string, update: { costPaise?: number | null; brand?: string | null; category?: string; externalId?: string | null; privateTags?: string[]; supplier?: string | null }) {
    return getCommerceRepository().updateProductEconomics(context, productId, update);
  }
}

let repository: GrowthRepository | null = null;
export function getGrowthRepository() { if (!repository) repository = new GrowthRepository(); return repository; }
export function resetGrowthRepositoryForTests() { repository = null; memory.clear(); }
