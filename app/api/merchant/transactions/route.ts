import { getTransactionOperation, listTransactionOperations } from "../../../../lib/merchant/operations";
import { merchantContextOrResponse } from "../../../../lib/server/route-guards";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = await merchantContextOrResponse(request, "VIEWER");
    if ("response" in auth) return auth.response;
    const context = auth.context;
    const transactionId = new URL(request.url).searchParams.get("transactionId");
    return Response.json(transactionId ? { transaction: await getTransactionOperation(context, transactionId) } : { transactions: await listTransactionOperations(context) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Transactions unavailable." }, { status: 400 });
  }
}
