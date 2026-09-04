import { z } from "zod";
import { comparePolicySimulation, type SimulationCase } from "../../../../lib/simulation/engine";
import { merchantContextOrResponse } from "../../../../lib/server/route-guards";
import { consumeRateLimit, rateLimitResponse } from "../../../../lib/server/rate-limit";

export const runtime = "nodejs";
const caseSchema = z.object({ id: z.string().min(1), productId: z.string().min(1), customerId: z.string().min(1).optional(), quantity: z.number().int().positive(), requestedDiscountBps: z.number().int().min(0).max(10_000).optional(), requestedPricePaise: z.number().int().nonnegative().optional() }).strict();
const schema = z.object({ draftId: z.string().min(1), cases: z.array(caseSchema).min(1).max(500) }).strict();
export async function POST(request: Request) {
  try { const auth = await merchantContextOrResponse(request, "ADMIN"); if ("response" in auth) return auth.response; const budget = await consumeRateLimit("POLICY_SIMULATION", auth.context); if (!budget.ok) return rateLimitResponse(budget.retryAfter); const input = schema.parse(await request.json()); return Response.json(await comparePolicySimulation(auth.context, input.draftId, input.cases satisfies SimulationCase[])); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Policy simulation failed." }, { status: 400 }); }
}
