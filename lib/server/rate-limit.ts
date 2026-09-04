import { and, eq, gt } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "../../db";
import { rateLimitBuckets } from "../../db/schema";
import type { TrustedRequestContext } from "./context";

export type RateLimitClass = "STORE_CHAT" | "VOICE_STT" | "VOICE_TTS" | "VOICE_PREVIEW" | "OFFER_REQUEST" | "POLICY_COMPILE" | "POLICY_SIMULATION" | "CATALOG_IMPORT" | "RED_TEAM" | "CHECKOUT";
const limits: Record<RateLimitClass, { max: number; windowMs: number }> = {
  STORE_CHAT: { max: 30, windowMs: 60_000 }, VOICE_STT: { max: 12, windowMs: 60_000 }, VOICE_TTS: { max: 20, windowMs: 60_000 }, VOICE_PREVIEW: { max: 5, windowMs: 60_000 }, OFFER_REQUEST: { max: 8, windowMs: 60_000 }, POLICY_COMPILE: { max: 10, windowMs: 60_000 }, POLICY_SIMULATION: { max: 10, windowMs: 60_000 }, CATALOG_IMPORT: { max: 3, windowMs: 60_000 }, RED_TEAM: { max: 2, windowMs: 60_000 }, CHECKOUT: { max: 8, windowMs: 60_000 },
};
const memory = new Map<string, { startedAt: number; count: number }>();

function key(kind: RateLimitClass, identity: string) { return `${kind}:${identity}`; }
export async function consumeRateLimit(kind: RateLimitClass, identity: string | TrustedRequestContext, override?: Partial<{ max: number; windowMs: number }>) {
  const config = { ...limits[kind], ...(override || {}) };
  const identityKey = typeof identity === "string" ? identity : `${identity.organizationId}:${identity.actorId}`;
  const bucketKey = key(kind, identityKey);
  const now = Date.now();
  if (!isDatabaseConfigured()) {
    const current = memory.get(bucketKey);
    if (!current || now - current.startedAt >= config.windowMs) { memory.set(bucketKey, { startedAt: now, count: 1 }); return { ok: true, retryAfter: 0 }; }
    if (current.count >= config.max) return { ok: false, retryAfter: Math.ceil((config.windowMs - (now - current.startedAt)) / 1000) };
    current.count += 1; return { ok: true, retryAfter: 0 };
  }
  const db = getDb();
  const rows = await db.select().from(rateLimitBuckets).where(eq(rateLimitBuckets.bucketKey, bucketKey)).limit(1);
  const row = rows[0];
  if (!row || now - row.windowStartedAt.getTime() >= config.windowMs) {
    await db.insert(rateLimitBuckets).values({ id: row?.id || crypto.randomUUID(), bucketKey, windowStartedAt: new Date(now), count: 1 }).onConflictDoUpdate({ target: rateLimitBuckets.bucketKey, set: { windowStartedAt: new Date(now), count: 1, updatedAt: new Date(now) } });
    return { ok: true, retryAfter: 0 };
  }
  if (row.count >= config.max) return { ok: false, retryAfter: Math.ceil((config.windowMs - (now - row.windowStartedAt.getTime())) / 1000) };
  await db.update(rateLimitBuckets).set({ count: row.count + 1, updatedAt: new Date(now) }).where(and(eq(rateLimitBuckets.id, row.id), gt(rateLimitBuckets.count, 0)));
  return { ok: true, retryAfter: 0 };
}

export function rateLimitResponse(retryAfter: number) { return Response.json({ error: "Rate limit exceeded.", code: "RATE_LIMITED", retryAfter }, { status: 429, headers: { "Retry-After": String(Math.max(1, retryAfter)) } }); }
export function resetRateLimitsForTests() { memory.clear(); }
