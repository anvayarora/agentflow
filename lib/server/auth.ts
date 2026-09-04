import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "../../db";
import { authSessions, organizationMembers } from "../../db/schema";
import type { TrustedRequestContext } from "./context";

export const MERCHANT_SESSION_COOKIE = "agentflow_merchant_session";
export const MERCHANT_SESSION_TTL_SECONDS = 8 * 60 * 60;
export const merchantRoles = ["OWNER", "ADMIN", "OPERATOR", "VIEWER"] as const;
export type MerchantRole = (typeof merchantRoles)[number];

export class MerchantAuthError extends Error {
  readonly status: 401 | 403;
  readonly code: string;
  constructor(message: string, status: 401 | 403, code: string) {
    super(message);
    this.name = "MerchantAuthError";
    this.status = status;
    this.code = code;
  }
}

type SessionClaims = { sid: string; actorId: string; organizationId: string; expiresAt: number };
type SessionRecord = SessionClaims & { role: MerchantRole };
const memorySessions = new Map<string, SessionRecord>();

function secret() {
  return process.env.AGENTFLOW_SESSION_SECRET || process.env.SHOPIFY_API_SECRET || (process.env.NODE_ENV === "production" ? "" : "agentflow-local-session-secret");
}
function encode(value: string) { return Buffer.from(value).toString("base64url"); }
function decode(value: string) { return Buffer.from(value, "base64url").toString("utf8"); }
function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
function sign(payload: string) { return createHmac("sha256", secret()).update(payload).digest("base64url"); }
function safeEqual(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Creates a signed, short-lived session token. Store only the hash server-side. */
export function createMerchantSessionCookie(input: { actorId: string; organizationId: string; role: MerchantRole; ttlSeconds?: number }) {
  if (!input.actorId || !input.organizationId || !merchantRoles.includes(input.role)) throw new Error("A valid merchant identity is required.");
  if (!secret()) throw new Error("AGENTFLOW_SESSION_SECRET is required for merchant sessions.");
  const claims: SessionRecord = { sid: randomBytes(18).toString("hex"), actorId: input.actorId, organizationId: input.organizationId, role: input.role, expiresAt: Math.floor(Date.now() / 1000) + (input.ttlSeconds || MERCHANT_SESSION_TTL_SECONDS) };
  const payload = encode(JSON.stringify({ sid: claims.sid, actorId: claims.actorId, organizationId: claims.organizationId, expiresAt: claims.expiresAt } satisfies SessionClaims));
  const token = `${payload}.${sign(payload)}`;
  memorySessions.set(digest(token), claims);
  return token;
}

export async function persistMerchantSession(input: { actorId: string; organizationId: string; role: MerchantRole; ttlSeconds?: number }) {
  const token = createMerchantSessionCookie(input);
  const payload = JSON.parse(decode(token.split(".")[0])) as SessionClaims;
  if (isDatabaseConfigured()) {
    await getDb().insert(authSessions).values({ id: payload.sid, organizationId: input.organizationId, actorId: input.actorId, tokenHash: digest(token), expiresAt: new Date(payload.expiresAt * 1000) }).onConflictDoNothing();
  }
  return token;
}

function readToken(request: Request) {
  const cookie = request.headers.get("cookie") || "";
  const entry = cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${MERCHANT_SESSION_COOKIE}=`));
  return entry ? decodeURIComponent(entry.slice(MERCHANT_SESSION_COOKIE.length + 1)) : null;
}

function parseToken(token: string): SessionClaims | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !secret() || !safeEqual(sign(payload), signature)) return null;
  try {
    const claims = JSON.parse(decode(payload)) as SessionClaims;
    return claims && claims.sid && claims.actorId && claims.organizationId && claims.expiresAt > Math.floor(Date.now() / 1000) ? claims : null;
  } catch { return null; }
}

export async function resolveMerchantSession(request: Request): Promise<SessionRecord | null> {
  const token = readToken(request);
  if (!token) return null;
  const claims = parseToken(token);
  if (!claims) return null;
  const cached = memorySessions.get(digest(token));
  if (!isDatabaseConfigured()) return cached || null;
  const rows = await getDb().select({ session: authSessions, memberRole: organizationMembers.role }).from(authSessions).innerJoin(organizationMembers, and(eq(organizationMembers.organizationId, authSessions.organizationId), eq(organizationMembers.actorId, authSessions.actorId))).where(and(eq(authSessions.tokenHash, digest(token)), isNull(authSessions.revokedAt))).limit(1);
  const row = rows[0];
  if (!row || row.session.expiresAt.getTime() <= Date.now()) return null;
  const role = row.memberRole.toUpperCase() as MerchantRole;
  return merchantRoles.includes(role) ? { ...claims, role } : null;
}

export async function requireMerchantContext(request: Request, requiredRole?: MerchantRole): Promise<TrustedRequestContext> {
  const session = await resolveMerchantSession(request);
  if (!session) throw new MerchantAuthError("Merchant authentication is required.", 401, "MERCHANT_UNAUTHENTICATED");
  if (requiredRole && !hasMerchantRole(session.role, requiredRole)) throw new MerchantAuthError("This merchant role is not allowed to perform the requested operation.", 403, "MERCHANT_FORBIDDEN");
  return { organizationId: session.organizationId, actorType: "merchant", actorId: session.actorId, role: session.role, authenticated: true, correlationId: request.headers.get("x-correlation-id") || crypto.randomUUID() };
}

export function hasMerchantRole(actual: MerchantRole | undefined, required: MerchantRole) {
  if (!actual) return false;
  const rank: Record<MerchantRole, number> = { VIEWER: 1, OPERATOR: 2, ADMIN: 3, OWNER: 4 };
  return rank[actual] >= rank[required];
}

export function resetMerchantAuthForTests() { memorySessions.clear(); }
