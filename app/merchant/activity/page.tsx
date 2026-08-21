import { Badge, MerchantShell, PageIntro } from "../merchant-ui";

const events = [
  ["14:31", "OFFER_ALLOWED", "Walnut Compact Desk · ₹12,500", "success"],
  ["14:28", "APPROVAL_REQUESTED", "Bulk desk order · scoped review", "warning"],
  ["14:24", "POLICY_PUBLISHED", "Workflow v18 · merchant approved", "success"],
  ["14:18", "BOUNDARY_HELD", "Untrusted discount proposal · no action taken", "danger"],
  ["14:10", "CATALOGUE_SYNCED", "Haven Home Preview · 6 products", "success"],
] as const;

export default function ActivityPage() {
  return <MerchantShell active="activity" title="Activity" description="A legible record of what the connected experience proposed and what the policy allowed."><PageIntro eyebrow="Append-only preview log" title="Every important moment has a reason." text="The activity view keeps customer intent, workflow decisions, and connector state in one quiet timeline." action={<Badge tone="success">Healthy</Badge>} /><section className="workspace-card timeline-card"><div className="card-heading"><div><span className="section-label">Today · 21 Aug 2026</span><h3>Decision timeline</h3></div><button className="button button-light" type="button">Export log <span>↗</span></button></div><div className="timeline-list">{events.map(([time, title, detail, tone]) => <div className="timeline-row" key={`${time}-${title}`}><time>{time}</time><span className={`timeline-dot timeline-${tone}`} /><div><strong>{title}</strong><small>{detail}</small></div><span className="timeline-arrow">↗</span></div>)}</div></section></MerchantShell>;
}
