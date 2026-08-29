import { and, asc, eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "../../../db";
import { salespersonProfiles } from "../../../db/schema";
import type { TrustedRequestContext } from "../context";
import { BULBUL_V3_SPEAKERS, salespersonProfileSchema, type SalespersonProfile } from "../../voice/salesperson";

export type SalespersonCreateInput = Omit<SalespersonProfile, "id" | "organizationId" | "createdAt" | "updatedAt" | "isActive" | "isMerchantDefault"> & { isActive?: boolean; isMerchantDefault?: boolean };

const now = () => new Date().toISOString();
const id = () => `salesperson-${crypto.randomUUID()}`;

export const DEFAULT_SALESPERSON_PROFILES: Array<SalespersonCreateInput & { id: string }> = [
  { id: "salesperson-maya", displayName: "Maya", description: "Warm and conversational", speakerId: "priya", languageSupport: ["en-IN", "hi-IN", "hinglish"], tonePreset: "WARM", pacePreset: "STANDARD", isActive: true, isMerchantDefault: true, avatarKey: "maya" },
  { id: "salesperson-aarav", displayName: "Aarav", description: "Calm product expert", speakerId: "anand", languageSupport: ["en-IN", "hi-IN", "hinglish"], tonePreset: "EXPERT", pacePreset: "RELAXED", isActive: true, isMerchantDefault: false, avatarKey: "aarav" },
  { id: "salesperson-sam", displayName: "Sam", description: "Fast and concise", speakerId: "shubh", languageSupport: ["en-IN", "hi-IN"], tonePreset: "CONCISE", pacePreset: "QUICK", isActive: true, isMerchantDefault: false, avatarKey: "sam" },
];
const scopedDefault = (profile: (typeof DEFAULT_SALESPERSON_PROFILES)[number], organizationId: string) => ({ ...profile, id: `${profile.id}-${organizationId}` });

type MemoryState = Map<string, SalespersonProfile>;
const memory = new Map<string, MemoryState>();
function memoryState(organizationId: string) {
  const existing = memory.get(organizationId);
  if (existing) return existing;
  const created = new Map<string, SalespersonProfile>();
  for (const profile of DEFAULT_SALESPERSON_PROFILES) { const scoped = scopedDefault(profile, organizationId); created.set(scoped.id, salespersonProfileSchema.parse({ ...scoped, organizationId, createdAt: now(), updatedAt: now() })); }
  memory.set(organizationId, created);
  return created;
}

function fromRow(row: typeof salespersonProfiles.$inferSelect): SalespersonProfile {
  return salespersonProfileSchema.parse({ id: row.id, organizationId: row.organizationId, displayName: row.displayName, description: row.description, speakerId: row.speakerId, languageSupport: row.languageSupport, tonePreset: row.tonePreset, pacePreset: row.pacePreset, isActive: row.isActive, isMerchantDefault: row.isMerchantDefault, avatarKey: row.avatarKey, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
}

export class SalespersonRepository {
  async ensureDefaults(context: TrustedRequestContext) {
    if (!isDatabaseConfigured()) return [...memoryState(context.organizationId).values()];
    for (const profile of DEFAULT_SALESPERSON_PROFILES) {
      const scoped = scopedDefault(profile, context.organizationId);
      await getDb().insert(salespersonProfiles).values({ ...scoped, organizationId: context.organizationId, languageSupport: [...scoped.languageSupport], speakerId: scoped.speakerId, tonePreset: scoped.tonePreset, pacePreset: scoped.pacePreset }).onConflictDoNothing();
    }
    return this.list(context);
  }

  async list(context: TrustedRequestContext) {
    if (!isDatabaseConfigured()) return [...memoryState(context.organizationId).values()].sort((a, b) => Number(b.isMerchantDefault) - Number(a.isMerchantDefault) || a.displayName.localeCompare(b.displayName));
    const rows = await getDb().select().from(salespersonProfiles).where(eq(salespersonProfiles.organizationId, context.organizationId)).orderBy(asc(salespersonProfiles.displayName));
    return rows.map(fromRow).sort((a, b) => Number(b.isMerchantDefault) - Number(a.isMerchantDefault) || a.displayName.localeCompare(b.displayName));
  }

  async get(context: TrustedRequestContext, profileId: string) {
    if (!isDatabaseConfigured()) return memoryState(context.organizationId).get(profileId) || null;
    const rows = await getDb().select().from(salespersonProfiles).where(and(eq(salespersonProfiles.organizationId, context.organizationId), eq(salespersonProfiles.id, profileId))).limit(1);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async create(context: TrustedRequestContext, input: SalespersonCreateInput) {
    if (!BULBUL_V3_SPEAKERS.includes(input.speakerId)) throw new Error("Speaker is not supported by Bulbul v3.");
    const created = salespersonProfileSchema.parse({ ...input, id: id(), organizationId: context.organizationId, isActive: input.isActive ?? true, isMerchantDefault: input.isMerchantDefault ?? false, createdAt: now(), updatedAt: now() });
    if (!isDatabaseConfigured()) { if (created.isMerchantDefault) for (const profile of memoryState(context.organizationId).values()) profile.isMerchantDefault = false; memoryState(context.organizationId).set(created.id, created); return created; }
    await getDb().transaction(async (tx) => {
      if (created.isMerchantDefault) await tx.update(salespersonProfiles).set({ isMerchantDefault: false, updatedAt: new Date() }).where(eq(salespersonProfiles.organizationId, context.organizationId));
      await tx.insert(salespersonProfiles).values({ id: created.id, organizationId: context.organizationId, displayName: created.displayName, description: created.description, speakerId: created.speakerId, languageSupport: [...created.languageSupport], tonePreset: created.tonePreset, pacePreset: created.pacePreset, isActive: created.isActive, isMerchantDefault: created.isMerchantDefault, avatarKey: created.avatarKey ?? null });
    });
    return this.get(context, created.id).then((profile) => profile || created);
  }

  async update(context: TrustedRequestContext, profileId: string, input: Partial<SalespersonCreateInput>) {
    const current = await this.get(context, profileId);
    if (!current) throw new Error("Salesperson profile was not found.");
    if (input.speakerId && !BULBUL_V3_SPEAKERS.includes(input.speakerId)) throw new Error("Speaker is not supported by Bulbul v3.");
    const next = salespersonProfileSchema.parse({ ...current, ...input, id: current.id, organizationId: context.organizationId, updatedAt: now() });
    if (!isDatabaseConfigured()) { if (next.isMerchantDefault) for (const profile of memoryState(context.organizationId).values()) profile.isMerchantDefault = false; memoryState(context.organizationId).set(profileId, next); return next; }
    await getDb().transaction(async (tx) => {
      if (next.isMerchantDefault) await tx.update(salespersonProfiles).set({ isMerchantDefault: false, updatedAt: new Date() }).where(eq(salespersonProfiles.organizationId, context.organizationId));
      await tx.update(salespersonProfiles).set({ displayName: next.displayName, description: next.description, speakerId: next.speakerId, languageSupport: [...next.languageSupport], tonePreset: next.tonePreset, pacePreset: next.pacePreset, isActive: next.isActive, isMerchantDefault: next.isMerchantDefault, avatarKey: next.avatarKey ?? null, updatedAt: new Date() }).where(and(eq(salespersonProfiles.organizationId, context.organizationId), eq(salespersonProfiles.id, profileId)));
    });
    return this.get(context, profileId).then((profile) => profile || next);
  }

  async select(context: TrustedRequestContext, profileId: string) {
    const profile = await this.get(context, profileId);
    if (!profile || !profile.isActive) throw new Error("That AI salesperson is not available.");
    return profile;
  }

  resetForTests() { memory.clear(); }
}

let repository: SalespersonRepository | null = null;
export function getSalespersonRepository() { if (!repository) repository = new SalespersonRepository(); return repository; }
export function resetSalespersonRepositoryForTests() { repository?.resetForTests(); repository = null; }
