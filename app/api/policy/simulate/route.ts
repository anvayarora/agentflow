import { z } from "zod";
import { comparePolicySimulation, type SimulationCase } from "../../../../lib/simulation/engine";
import { getTrustedRequestContext } from "../../../../lib/server/context";

export const runtime = "nodejs";
const caseSchema = z.object({ id: z.string().min(1), productId: z.string().min(1), customerId: z.string().min(1).optional(), quantity: z.number().int().positive(), requestedDiscountBps: z.number().int().min(0).max(10_000).optional(), requestedPricePaise: z.number().int().nonnegative().optional() }).strict();
const schema = z.object({ draftId: z.string().min(1), cases: z.array(caseSchema).min(1).max(500) }).strict();
export async function POST(request: Request) {
  try { const input = schema.parse(await request.json()); return Response.json(await comparePolicySimulation(getTrustedRequestContext(request), input.draftId, input.cases satisfies SimulationCase[])); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Policy simulation failed." }, { status: 400 }); }
}
