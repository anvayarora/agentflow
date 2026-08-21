import type { ReactNode } from "react";
import Link from "next/link";

export type MerchantSection = "overview" | "onboarding" | "workflow" | "catalog" | "approvals" | "activity" | "connectors";

const links: Array<{ id: MerchantSection; label: string; href: string; icon: string }> = [
  { id: "overview", label: "Overview", href: "/merchant", icon: "⌂" },
  { id: "onboarding", label: "Onboarding", href: "/merchant/onboarding", icon: "✦" },
  { id: "workflow", label: "Workflow", href: "/merchant/workflow", icon: "◈" },
  { id: "catalog", label: "Catalogue", href: "/merchant/catalog", icon: "▦" },
  { id: "approvals", label: "Approvals", href: "/merchant/approvals", icon: "◌" },
  { id: "activity", label: "Activity", href: "/merchant/activity", icon: "↗" },
  { id: "connectors", label: "Connectors", href: "/merchant/connectors", icon: "⌘" },
];

export function Brand() {
  return <Link className="brand" href="/" aria-label="AgentFlow home"><span className="brand-symbol">✦</span><span>AgentFlow</span></Link>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warning" | "danger" }) {
  return <span className={`badge badge-${tone}`}><i />{children}</span>;
}

export function MerchantShell({ active, children, title, description }: { active: MerchantSection; children: ReactNode; title: string; description: string }) {
  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">
        <Brand />
        <div className="workspace-account"><span className="account-avatar">H</span><div><strong>Haven Home</strong><small>Merchant workspace</small></div><span className="account-chevron">⌄</span></div>
        <span className="sidebar-label">Workspace</span>
        <nav className="workspace-nav" aria-label="Merchant workspace navigation">{links.map((link) => <a className={active === link.id ? "workspace-nav-link active" : "workspace-nav-link"} href={link.href} key={link.id}><span>{link.icon}</span>{link.label}{link.id === "approvals" ? <b>1</b> : null}</a>)}</nav>
        <div className="sidebar-bottom"><div className="sidebar-health"><i /><div><strong>Preview systems</strong><small>Connector checks live</small></div></div><a className="customer-switch" href="/customer"><span>↗</span>View customer demo</a><div className="owner-row"><span className="owner-avatar">AA</span><div><strong>Anvay Arora</strong><small>Owner</small></div></div></div>
      </aside>
      <main className="workspace-main">
        <header className="workspace-topbar"><div><span className="topbar-crumb">Haven Home <i>/</i> {title}</span><h1>{title}</h1><p>{description}</p></div><div className="topbar-actions"><Badge tone="success">Preview environment</Badge><Link className="avatar-button" href="/">AA</Link></div></header>
        <div className="workspace-content">{children}</div>
      </main>
    </div>
  );
}

export function PageIntro({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: ReactNode }) {
  return <div className="page-intro"><div><span className="section-label">{eyebrow}</span><h2>{title}</h2><p>{text}</p></div>{action ? <div className="page-intro-action">{action}</div> : null}</div>;
}

export function StatCard({ label, value, detail, tone = "default" }: { label: string; value: string; detail: string; tone?: "default" | "blue" | "green" | "peach" }) {
  return <article className={`stat-card stat-${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}
