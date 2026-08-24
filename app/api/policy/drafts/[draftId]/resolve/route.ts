import { z } from "zod";
import { policyToGraph } from "../../../../../../lib/policy/graph-projection";
import { getTrustedRequestContext } from "../../../../../../lib/server/context";
import { getCommerceRepository } from "../../../../../../lib/server/repositories/commerce";

export const runtime = "nodejs";

const resolutionSchema = z.object({ discrepancyId: z.string().min(1), resolution: z.union([z.string(), z.number(), z.object({ valueBps: z.number().int().min(0).max(10_000).optional(), ruleId: z.string().optional() }).strict()]) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  try {
    const parsed = resolutionSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Invalid discrepancy resolution." }, { status: 400 });
    const context = getTrustedRequestContext(request);
    const { draftId } = await params;
    const result = await getCommerceRepository().resolveDraftDiscrepancy(context, draftId, parsed.data.discrepancyId, parsed.data.resolution);
    return Response.json({ ...result, graph: policyToGraph(result.policy) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to resolve discrepancy." }, { status: 400 });
  }
}
