import { MerchantShell, PageIntro } from "../merchant-ui";
import GrowthConsole from "./GrowthConsole";

export default function GrowthPage() {
  return <MerchantShell active="growth" title="Growth" description="Find profitable opportunities inside the boundaries you already approved."><PageIntro eyebrow="Merchant intelligence" title="Growth, with a clear line back to policy." text="AgentFlow surfaces observed inventory and margin signals, then turns them into reviewable plays. Every activation is re-evaluated by the published policy runtime." action={<a className="button button-light" href="/merchant/workflow">Open policy canvas <span>↗</span></a>} /><GrowthConsole /></MerchantShell>;
}
