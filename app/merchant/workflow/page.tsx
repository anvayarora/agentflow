import { MerchantShell, PageIntro } from "../merchant-ui";
import WorkflowForm from "./WorkflowForm";

export default function WorkflowPage() {
  return <MerchantShell active="workflow" title="Workflow" description="Define exactly what your connected customer experience can do."><PageIntro eyebrow="Workflow studio" title="Your rules, made testable." text="Start with a draft, change the values, and open the customer demo to see the policy behave in context." action={<a className="button button-light" href="/customer">Open customer surface <span>↗</span></a>} /><WorkflowForm /></MerchantShell>;
}
