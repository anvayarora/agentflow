import { probeNimHealth } from "../../../../../lib/ai/providers/nim";

/**
 * Explicit operator probe. This performs one bounded server-side inference and
 * never accepts or returns provider credentials or response bodies.
 */
export async function GET() {
  const health = await probeNimHealth();
  return Response.json({ ...health, generatedAt: new Date().toISOString() }, { status: health.status === "AVAILABLE" ? 200 : 503, headers: { "cache-control": "no-store" } });
}
