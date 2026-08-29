import { MerchantShell, PageIntro } from "../merchant-ui";
import WorkflowForm from "./WorkflowForm";

export default function WorkflowPage() {
  return <MerchantShell active="workflow" title="Policy Canvas" description="Define exactly what your connected Shopify customer experience can do."><PageIntro eyebrow="Policy canvas" title="Your rules, made testable." text="Edit a persisted draft, validate it on the server, and open the real Shopify storefront to see the published policy behave in context." action={<a className="button button-light" href="https://haven-home-k1gerlw9.myshopify.com" target="_blank" rel="noreferrer">Open Shopify storefront <span>↗</span></a>} /><WorkflowForm /></MerchantShell>;
}
