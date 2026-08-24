export type CustomerSegment = "new" | "repeat";

export type CanonicalCustomer = {
  id: string;
  organizationId: string;
  externalCustomerId: string | null;
  emailHash: string | null;
  orderCount: number;
  lifetimeValuePaise: number;
  lastOrderAt: Date | null;
  attributes: Record<string, unknown>;
};

export function deriveCustomerSegment(customer: Pick<CanonicalCustomer, "orderCount">): CustomerSegment {
  return customer.orderCount > 0 ? "repeat" : "new";
}
