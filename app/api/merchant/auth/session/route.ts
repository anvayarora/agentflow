import { and, eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "../../../../../db";
import { organizationMembers } from "../../../../../db/schema";
import { demoOrganizationId } from "../../../../../lib/server/context";
import { persistMerchantSession, MERCHANT_SESSION_COOKIE, merchantRoles, type MerchantRole } from "../../../../../lib/server/auth";
import { getCommerceRepository } from "../../../../../lib/server/repositories/commerce";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { loginToken?: string };
    const configuredToken = process.env.AGENTFLOW_MERCHANT_LOGIN_TOKEN;
    if (process.env.NODE_ENV === "production" && (!configuredToken || body.loginToken !== configuredToken)) return Response.json({ error: "Merchant authentication failed.", code: "MERCHANT_AUTH_FAILED" }, { status: 401 });
    const organizationId = process.env.AGENTFLOW_MERCHANT_ORGANIZATION_ID || demoOrganizationId() || "org_haven_home_demo";
    const actorId = process.env.AGENTFLOW_MERCHANT_ACTOR_ID || "admin";
    let role = ((process.env.AGENTFLOW_MERCHANT_ROLE || "ADMIN").toUpperCase()) as MerchantRole;
    if (!merchantRoles.includes(role)) role = "ADMIN";
    if (isDatabaseConfigured()) {
      const rows = await getDb().select({ role: organizationMembers.role }).from(organizationMembers).where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.actorId, actorId))).limit(1);
      if (!rows[0]) return Response.json({ error: "Merchant has no membership in this organization.", code: "MERCHANT_MEMBERSHIP_REQUIRED" }, { status: 403 });
      role = rows[0].role.toUpperCase() as MerchantRole;
    }
    const token = await persistMerchantSession({ actorId, organizationId, role });
    await getCommerceRepository().recordAudit({ organizationId, actorType: "merchant", actorId, correlationId: request.headers.get("x-correlation-id") || crypto.randomUUID() }, { eventType: "MERCHANT_AUTHENTICATED", entityType: "auth_session", entityId: actorId, metadata: { role } });
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return Response.json({ authenticated: true, organizationId, role }, { headers: { "set-cookie": `${MERCHANT_SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=28800; Path=/; HttpOnly${secure}; SameSite=Lax` } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Merchant authentication failed." }, { status: 400 }); }
}

export async function DELETE() {
  return Response.json({ authenticated: false }, { headers: { "set-cookie": `${MERCHANT_SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax` } });
}
