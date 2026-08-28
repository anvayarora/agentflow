import { getTrustedRequestContext } from "../../../../lib/server/context";
import { getTransactionOperation, listTransactionOperations } from "../../../../lib/merchant/operations";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = getTrustedRequestContext(request);
    const transactionId = new URL(request.url).searchParams.get("transactionId");
    return Response.json(transactionId ? { transaction: await getTransactionOperation(context, transactionId) } : { transactions: await listTransactionOperations(context) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Transactions unavailable." }, { status: 400 });
  }
}
