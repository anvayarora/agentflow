import { z } from "zod";
import { deriveCustomerSegment } from "../../../../lib/domain/customer";
import { getTrustedRequestContext } from "../../../../lib/server/context";
import { getCommerceRepository } from "../../../../lib/server/repositories/commerce";

export const runtime = "nodejs";

const ignoredClientBody = z.object({}).passthrough();

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    ignoredClientBody.parse(body);
    const context = getTrustedRequestContext(request);
    const customerId = (typeof process === "undefined" ? undefined : process.env.AGENTFLOW_DEMO_CUSTOMER_ID) || "customer-haven-repeat";
    const repository = getCommerceRepository();
    const session = await repository.createSession(context, customerId);
    const customer = await repository.getCustomer(context, session.customerId);
    if (!customer) return Response.json({ error: "Trusted demo customer is unavailable." }, { status: 500 });
    return Response.json({ sessionId: session.id, currency: session.currency, customerSegment: deriveCustomerSegment(customer), customerId: customer.id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create a commerce session." }, { status: 400 });
  }
}
