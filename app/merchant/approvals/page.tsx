import { Badge, MerchantShell, PageIntro } from "../merchant-ui";
import ApprovalsConsole from "./ApprovalsConsole";

export default function ApprovalsPage() {
  return <MerchantShell active="approvals" title="Approvals" description="Review exceptions, money movement, and the evidence behind every decision."><PageIntro eyebrow="Merchant operations" title="Keep the exceptions small and clear." text="Approvals, transactions, audit, and red-team checks stay together so your team can act from the same server-authoritative record." action={<Badge tone="success">Live operations</Badge>} /><ApprovalsConsole /></MerchantShell>;
}
