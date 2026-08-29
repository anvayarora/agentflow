"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CoreProductData } from "./core-product-data";

type IconName = "home" | "spark" | "store" | "growth" | "shield" | "bell" | "calendar" | "chevron" | "arrow" | "search" | "plus" | "close" | "check" | "box" | "wallet" | "users" | "chart" | "lock" | "menu" | "external" | "play";
type Tone = "sage" | "amber" | "terracotta" | "blue" | "rose" | "lilac";

const storeUrl = "https://haven-home-k1gerlw9.myshopify.com";

function AppIcon({ name, size = 17 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const paths: Record<IconName, ReactNode> = {
    home: <><path d="m3 10 9-7 9 7v10H3z" /><path d="M9 21v-6h6v6" /></>,
    spark: <><path d="m12 2 1.8 7.2L21 12l-7.2 1.8L12 21l-1.8-7.2L3 12l7.2-2.8Z" /><path d="m19 3 .4 1.6L21 5l-1.6.4L19 7l-.4-1.6L17 5l1.6-.4Z" /></>,
    store: <><path d="M4 10h16v10H4z" /><path d="M3 10 5 4h14l2 6" /><path d="M8 14h3v6H8z" /><path d="M4 10c.5 2 3.5 2 4 0 .5 2 3.5 2 4 0 .5 2 3.5 2 4 0 .5 2 3.5 4 0" /></>,
    growth: <><path d="M4 18 9 12l4 3 7-8" /><path d="M15 7h5v5" /></>,
    shield: <><path d="M12 3 20 6v5.5c0 4.8-3.4 8.2-8 9.5-4.6-1.3-8-4.7-8-9.5V6l8-3Z" /><path d="m8.5 12 2.3 2.3 4.7-4.7" /></>,
    bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    chevron: <path d="m7 9 5 5 5-5" />,
    arrow: <><path d="M4 12h15" /><path d="m13 6 6 6-6 6" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.4" /><path d="m16 16 4.2 4.2" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    box: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4.4 7.7 7.6 4.4 7.6-4.4M12 12.1V21" /></>,
    wallet: <><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H19v16H6.5A2.5 2.5 0 0 1 4 17.5v-11Z" /><path d="M4 7h15" /><path d="M15 12h4v4h-4a2 2 0 0 1 0-4Z" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 6" /></>,
    chart: <><path d="M5 19V9M12 19V5M19 19v-7" /><path d="M3 19h18" /></>,
    lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" /></>,
    play: <path d="m9 6 8 6-8 6V6Z" />,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function go(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function formatPaise(value: number, currency = "INR") {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(Math.round(value / 100));
}

function relativeTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diff = Math.max(0, Date.now() - date.getTime());
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return date.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

function Brand() {
  return <div className="product-brand"><img src="/assets/agentflow-mark.svg" alt="" /><span>AgentFlow</span></div>;
}

function StatusBadge({ children, tone = "sage" }: { children: ReactNode; tone?: Tone | "neutral" | "danger" }) {
  return <span className={`status-badge badge-${tone}`}>{children}</span>;
}

function Button({ children, variant = "primary", onClick, icon, type = "button", disabled = false }: { children: ReactNode; variant?: "primary" | "secondary" | "ghost" | "danger" | "dark"; onClick?: () => void; icon?: IconName; type?: "button" | "submit"; disabled?: boolean }) {
  return <button type={type} disabled={disabled} className={`app-button button-${variant}`} onClick={onClick}>{children}{icon && <AppIcon name={icon} size={15} />}</button>;
}

function Panel({ children, className = "", title, action }: { children: ReactNode; className?: string; title?: string; action?: ReactNode }) {
  return <section className={`app-panel ${className}`}>{(title || action) && <div className="panel-heading"><h3>{title}</h3>{action}</div>}{children}</section>;
}

function PageHeader({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) {
  return <div className="page-header"><div><h1>{title}</h1><p>{subtitle}</p></div>{children}</div>;
}

function Sparkline({ points, tone }: { points: number[]; tone: Tone }) {
  const data = points.map((value, index) => ({ index, value }));
  return <div className={`mini-spark spark-${tone}`} aria-hidden="true"><ResponsiveContainer width="100%" height="100%"><LineChart data={data}><XAxis dataKey="index" hide /><YAxis hide domain={["dataMin", "dataMax"]} /><Tooltip content={() => null} /><Line type="monotone" dataKey="value" stroke="currentColor" strokeWidth={2.1} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>;
}

function KpiCard({ label, value, detail, tone, points }: { label: string; value: string; detail: string; tone: Tone; points: number[] }) {
  const icon: IconName = tone === "terracotta" ? "growth" : tone === "rose" ? "shield" : tone === "amber" ? "wallet" : "spark";
  return <article className="stat-card"><div className={`stat-icon tone-${tone}`}><AppIcon name={icon} size={20} /></div><div className="stat-content"><span>{label}</span><strong>{value}</strong><span className="trend up"><span>↑</span>{detail}</span></div><Sparkline points={points} tone={tone} /></article>;
}

function Sidebar({ active, collapsed, onCollapse, mobileOpen, onMobileClose }: { active: string; collapsed: boolean; onCollapse: () => void; mobileOpen: boolean; onMobileClose: () => void }) {
  const items: Array<{ path: string; label: string; icon: IconName; badge?: string }> = [
    { path: "/app/overview", label: "Overview", icon: "home" },
    { path: "/app/setup", label: "Setup Copilot", icon: "spark" },
    { path: "/app/storefront", label: "Storefront", icon: "store" },
    { path: "/app/growth", label: "Growth", icon: "growth" },
    { path: "/app/approvals", label: "Approvals", icon: "shield" },
  ];
  return <aside className={`app-sidebar ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "is-mobile-open" : ""}`}><div className="sidebar-top"><button className="sidebar-brand" onClick={() => go("/app/overview")}><Brand /></button><button className="mobile-close" onClick={onMobileClose} aria-label="Close navigation"><AppIcon name="close" /></button></div><nav className="sidebar-nav" aria-label="Product navigation">{items.map((item) => <button key={item.path} className={active === item.path ? "is-active" : ""} onClick={() => { go(item.path); onMobileClose(); }}><AppIcon name={item.icon} size={19} /><span>{item.label}</span>{item.badge && <em>{item.badge}</em>}</button>)}</nav><div className="sidebar-bottom"><button className="profile-control"><span className="avatar">AM</span><span className="profile-copy"><b>Aarav Mehta</b><small>Admin</small></span><AppIcon name="chevron" size={15} /></button><button className="collapse-control" onClick={onCollapse}><AppIcon name="chevron" size={15} /><span>Collapse</span></button></div></aside>;
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  return <header className="product-topbar"><button className="topbar-menu" onClick={onMenu} aria-label="Open navigation"><AppIcon name="menu" /></button><div className="topbar-spacer" /><button className="date-control"><AppIcon name="calendar" size={16} />Last 7 days<AppIcon name="chevron" size={14} /></button><button className="notification-control" aria-label="Notifications"><AppIcon name="bell" size={20} /><span /></button><span className="top-avatar">AM</span></header>;
}

function StoreStatus({ policyVersion }: { policyVersion: number | null }) {
  return <Panel className="store-status-panel"><div className="store-identity"><div className="store-logo">HAVEN<br /><b>HOME</b></div><div><strong>Haven Home <StatusBadge>● Connected</StatusBadge></strong><small><span className="shopify-glyph">S</span> haven-home-k1gerlw9.myshopify.com</small></div></div><div className="store-status-items"><div><AppIcon name="spark" size={24} /><span>AgentFlow AI<b>Live</b></span></div><div><AppIcon name="shield" size={24} /><span>Policy version<b>{policyVersion ? `v${policyVersion} • Published` : "Awaiting policy"}</b></span></div><div><AppIcon name="wallet" size={24} /><span>Payment rail<b>Test environment</b></span></div></div><Button variant="secondary" icon="external" onClick={() => window.open(storeUrl, "_blank", "noopener,noreferrer")}>View store</Button></Panel>;
}

function Overview({ data, onOpenApproval }: { data: CoreProductData; onOpenApproval: (id: string) => void }) {
  const verifiedRevenue = data.transactions.filter((item) => item.revenueState === "VERIFIED_REVENUE").reduce((sum, item) => sum + item.amountPaise, 0);
  const pending = data.approvals.filter((item) => item.status === "PENDING").length;
  const trend = data.trend.map((point) => point.events);
  const spark = trend.length ? trend : [0, 1, 0, 2, 1, 2, 2];
  return <div className="page-view overview-view"><PageHeader title="Overview" subtitle="Real-time performance and AI insights for your store." /><StoreStatus policyVersion={data.policyVersion} /><div className="stats-grid"><KpiCard label="Active growth plays" value={String(data.growth.activePlays)} detail={data.growth.activePlays ? "Live in the workspace" : "Ready to activate"} tone="terracotta" points={spark} /><KpiCard label="Pending approvals" value={String(pending)} detail={pending ? "Needs your review" : "Nothing waiting"} tone="rose" points={spark.map((value, index) => Math.max(0, value - index % 2))} /><KpiCard label="Verified revenue" value={verifiedRevenue ? formatPaise(verifiedRevenue) : "—"} detail={verifiedRevenue ? "Provider verified" : "No realized revenue yet"} tone="amber" points={spark.map((value) => value + 1)} /><KpiCard label="AI conversations" value={String(data.activities.filter((item) => item.eventType.includes("AGENT") || item.eventType.includes("VOICE")).length)} detail="Server-recorded activity" tone="blue" points={spark.map((value) => value + 2)} /></div><div className="overview-grid"><Panel title="Recent activity" action={<button className="panel-link" onClick={() => go("/app/approvals?tab=audit")}>View all activity <AppIcon name="arrow" size={14} /></button>} className="activity-panel"><div className="activity-list">{data.activities.length ? data.activities.slice(0, 5).map((event) => <div className="activity-row" key={event.id}><span className="activity-dot dot-sage"><AppIcon name={event.eventType.includes("POLICY") ? "shield" : event.eventType.includes("PAYMENT") ? "wallet" : "spark"} size={14} /></span><div><b>{event.eventType.replaceAll("_", " ")}</b><small>{event.explanation}</small></div><span className="activity-meta"><small>{relativeTime(event.createdAt)}</small><StatusBadge tone="sage">Recorded</StatusBadge></span></div>) : <EmptyState text="Your first server-recorded commerce event will appear here." />}</div></Panel><Panel title="Growth opportunities" action={<button className="panel-link" onClick={() => go("/app/growth")}>View all <AppIcon name="arrow" size={14} /></button>} className="opportunities-panel"><OpportunityRow icon="box" tone="sage" title="Policy-safe opportunities" detail={`${data.growth.opportunities} opportunit${data.growth.opportunities === 1 ? "y" : "ies"} detected from connected signals`} value={data.growth.opportunities ? "Review queue" : "Scanning"} /><OpportunityRow icon="growth" tone="blue" title="Active growth plays" detail="Every activation is re-evaluated by the policy runtime" value={String(data.growth.activePlays)} /><OpportunityRow icon="shield" tone="rose" title="Evidence before impact" detail={data.growth.history === "OBSERVED" ? `${data.growth.verifiedPurchases} verified purchase${data.growth.verifiedPurchases === 1 ? "" : "s"} attributed` : "Simulations stay clearly marked until verified"} value={data.growth.history === "OBSERVED" ? "Observed" : "Potential"} /></Panel><Panel title="Pending approvals" action={<button className="panel-link" onClick={() => go("/app/approvals")}>View all <AppIcon name="arrow" size={14} /></button>} className="pending-panel"><div className="pending-list">{data.approvals.filter((item) => item.status === "PENDING").slice(0, 2).map((approval) => <div className="pending-row" key={approval.id}><span className="pending-icon tone-rose"><AppIcon name="shield" size={18} /></span><div><b>{approval.productName}</b><small>{approval.customerSegment} customer · {Math.round(approval.requestedDiscountBps / 100)}% requested</small></div><span className="pending-impact"><small>Requested</small><b>{relativeTime(approval.createdAt)}</b></span><Button variant="secondary" onClick={() => onOpenApproval(approval.id)}>Review</Button><Button onClick={() => onOpenApproval(approval.id)}>Open</Button></div>)}</div>{pending === 0 && <EmptyState text="No approval requests are waiting for a merchant decision." />}</Panel><Panel title="Recent transactions" action={<button className="panel-link" onClick={() => go("/app/approvals?tab=transactions")}>View all <AppIcon name="arrow" size={14} /></button>} className="transactions-panel"><TransactionTable transactions={data.transactions.slice(0, 3)} /></Panel></div><Panel className="evidence-chart" title="Commerce evidence" action={<StatusBadge tone="neutral">Server activity</StatusBadge>}><div className="evidence-chart-body">{data.trend.length > 1 ? <ResponsiveContainer width="100%" height={190}><LineChart data={data.trend}><XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: "#8d8278", fontSize: 11 }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "#8d8278", fontSize: 11 }} width={28} /><Tooltip contentStyle={{ border: "1px solid #eadfd3", borderRadius: 10, background: "#fffdf9", fontSize: 12 }} /><Line type="monotone" dataKey="events" name="Events" stroke="#c86146" strokeWidth={2.5} dot={{ r: 3, fill: "#fffdf9" }} isAnimationActive={false} /></LineChart></ResponsiveContainer> : <EmptyState text="The trend will become useful after more server activity is recorded." />}</div></Panel><div className="overview-lower-grid"><a className="feature-card" href="/app/setup"><span className="feature-number">01</span><span className="feature-tag">Setup Copilot</span><h3>Make merchant intent executable.</h3><p>Describe your operating rules, review the structured draft, and publish explicitly.</p><span className="feature-link">Open setup ↗</span></a><a className="feature-card feature-card-soft" href="/merchant/catalog"><span className="feature-number">02</span><span className="feature-tag">Catalogue</span><h3>Keep product context close to every decision.</h3><p>Review connected products, inventory signals, and missing economics without exposing private fields.</p><span className="feature-link">View catalogue ↗</span></a><div className="feature-card feature-card-dark"><span className="feature-number">03</span><span className="feature-tag">Shopper destination</span><h3>Open the real conversation on Shopify.</h3><p>The customer experience and voice assistant remain on the connected storefront.</p><button className="feature-link" type="button" onClick={() => window.open(storeUrl, "_blank", "noopener,noreferrer")}>Open storefront ↗</button></div></div></div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="compile-empty"><span className="compile-empty-mark">◌</span><p>{text}</p></div>;
}

function OpportunityRow({ icon, tone, title, detail, value }: { icon: IconName; tone: Tone; title: string; detail: string; value: string }) {
  return <button className="opportunity-row" onClick={() => go("/app/growth")}><span className={`opportunity-icon tone-${tone}`}><AppIcon name={icon} size={20} /></span><span className="opportunity-copy"><b>{title}</b><small>{detail}</small></span><span className="opportunity-impact"><small>State</small><b>{value}</b></span><StatusBadge tone={tone === "rose" ? "amber" : "sage"}>{tone === "rose" ? "Review" : "Live"}</StatusBadge><span className="review-label">Review</span></button>;
}

function TransactionTable({ transactions }: { transactions: CoreProductData["transactions"] }) {
  return <div className="table-wrap is-compact"><table><thead><tr><th>Transaction</th><th>Amount</th><th>Status</th><th>Time</th></tr></thead><tbody>{transactions.map((item) => <tr key={item.id}><td><b>{item.id}</b></td><td>{formatPaise(item.amountPaise, item.currency)}</td><td><StatusBadge tone={item.revenueState === "VERIFIED_REVENUE" ? "sage" : item.status === "FAILED" ? "rose" : "neutral"}>{item.revenueState === "VERIFIED_REVENUE" ? "Verified" : item.status}</StatusBadge></td><td>{relativeTime(item.createdAt)}</td></tr>)}</tbody></table>{transactions.length === 0 && <EmptyState text="Verified transactions will appear here after a completed commerce loop." />}</div>;
}

function SetupPage() {
  return <div className="page-view setup-view"><PageHeader title="Setup Copilot" subtitle="Turn merchant intent into inspectable policy blocks before a shopper ever sees them." /><div className="setup-stepper"><span className="is-current"><b>1</b> Describe intent</span><span><b>2</b> Review blocks</span><span><b>3</b> Resolve logic</span><span><b>4</b> Publish</span></div><div className="setup-workspace"><Panel className="copilot-panel"><div className="copilot-heading"><div><span className="panel-eyebrow"><AppIcon name="spark" size={14} /> Setup Copilot</span><small>Connected to the server draft pipeline</small></div></div><div className="setup-empty"><div className="empty-icon tone-blue"><AppIcon name="spark" size={25} /></div><h3>Describe how Haven Home sells</h3><p>The production onboarding flow turns your natural language into a typed draft, validates it, and keeps publication in your hands.</p><Button icon="arrow" onClick={() => go("/merchant/onboarding")}>Open guided onboarding</Button><small className="copilot-disclaimer">AI proposes. Deterministic policy code authorizes.</small></div></Panel><Panel className="canvas-panel"><div className="canvas-toolbar"><div className="canvas-tabs"><b>Policy lifecycle</b><span>Server-backed</span></div><StatusBadge tone="neutral">Draft → Validate → Publish</StatusBadge></div><div className="canvas-body setup-lifecycle"><LifecycleStep number="01" icon="users" title="Merchant intent" detail="Your description is captured as a draft prompt." /><LifecycleStep number="02" icon="box" title="Proposed Policy IR" detail="Rules are typed, scoped, and validated before review." /><LifecycleStep number="03" icon="shield" title="Published authority" detail="Only an explicit merchant action activates a version." /></div></Panel></div><Panel className="setup-reassurance"><AppIcon name="lock" size={18} /><div><b>Safe by construction</b><p>Customer input cannot change policy, price, margin, stock, or trusted segment.</p></div><StatusBadge tone="sage">Server authoritative</StatusBadge></Panel></div>;
}

function LifecycleStep({ number, icon, title, detail }: { number: string; icon: IconName; title: string; detail: string }) {
  return <div className="flow-step"><span className="flow-step-icon tone-blue"><AppIcon name={icon} size={19} /></span><div><b>{number} · {title}</b><small>{detail}</small></div></div>;
}

function StorefrontPage({ data }: { data: CoreProductData }) {
  return <div className="page-view storefront-view"><PageHeader title="Storefront" subtitle="The connected Shopify destination and the customer-facing commerce experience." ><Button variant="secondary" icon="external" onClick={() => window.open(storeUrl, "_blank", "noopener,noreferrer")}>Open live store</Button></PageHeader><Panel className="connection-panel"><div className="connection-header"><div><span className="panel-eyebrow"><span className="shopify-glyph">S</span> Shopify development store</span><h2>Haven Home</h2><p>haven-home-k1gerlw9.myshopify.com</p></div><StatusBadge>● Connected</StatusBadge></div><div className="connection-status-row"><div><AppIcon name="store" size={20} /><span>Storefront<b>Live</b></span></div><div><AppIcon name="box" size={20} /><span>Catalogue<b>Synced</b></span></div><div><AppIcon name="shield" size={20} /><span>Policy<b>{data.policyVersion ? `v${data.policyVersion}` : "Awaiting"}</b></span></div><div><AppIcon name="spark" size={20} /><span>AI salesperson<b>Ready</b></span></div><div><AppIcon name="wallet" size={20} /><span>Payment rail<b>Test only</b></span></div><div><AppIcon name="lock" size={20} /><span>App Proxy<b>Signed</b></span></div></div></Panel><div className="storefront-grid"><Panel className="live-preview-panel" title="Live storefront"><div className="store-preview"><div className="preview-browser"><div className="preview-topline"><span /><span /><span /><b>Haven Home</b><nav>Furniture&nbsp;&nbsp; Lighting&nbsp;&nbsp; Accessories</nav><AppIcon name="search" size={12} /><AppIcon name="store" size={12} /><div className="preview-hero"><div><h3>Objects with a quieter point of view.</h3><p>Open the real development storefront to experience the AgentFlow salesperson.</p><Button variant="dark" onClick={() => window.open(storeUrl, "_blank", "noopener,noreferrer")}>Open storefront</Button></div></div><div className="preview-categories"><b>Explore the collection</b><div><span>Desks</span><span>Lighting</span><span>Accessories</span></div></div><button className="assistant-launcher" onClick={() => window.open(storeUrl, "_blank", "noopener,noreferrer")} aria-label="Open AgentFlow storefront"><AppIcon name="spark" size={19} /></button></div></div></div></Panel><Panel className="store-flow-panel" title="Customer loop"><p>Every shopper interaction stays connected to the same catalogue, policy runtime, and server evidence.</p><div className="flow-steps"><LifecycleStep number="01" icon="search" title="Discover" detail="Shopper asks in natural language or voice." /><LifecycleStep number="02" icon="shield" title="Evaluate" detail="Deterministic policy checks the canonical context." /><LifecycleStep number="03" icon="wallet" title="Complete" detail="Only approved actions can reach checkout." /></div><div className="flow-reassurance"><AppIcon name="check" size={15} />No merchant economics are sent to the browser.</div></Panel></div><div className="storefront-bottom"><Panel title="Recent shopper evidence"><div className="storefront-activity">{data.activities.filter((item) => item.eventType.includes("AGENT") || item.eventType.includes("SESSION") || item.eventType.includes("OFFER")).slice(0, 4).map((event) => <div key={event.id}><span className="activity-dot dot-blue"><AppIcon name="spark" size={13} /></span><b>{event.eventType.replaceAll("_", " ")}</b><small>{relativeTime(event.createdAt)}</small><StatusBadge tone="sage">Recorded</StatusBadge></div>)}{data.activities.length === 0 && <EmptyState text="Shopper evidence appears here after the first live session." />}</div></Panel><Panel className="storefront-callout"><span className="callout-illustration"><AppIcon name="users" size={23} /></span><div><h3>Customer and merchant surfaces stay separate.</h3><p>Open Shopify to test the customer experience. Use Setup Copilot and Approvals for merchant operations.</p></div><AppIcon name="arrow" size={18} /></Panel></div></div>;
}

function GrowthPage({ data }: { data: CoreProductData }) {
  return <div className="page-view growth-view"><PageHeader title="Growth" subtitle="Find profitable opportunities inside the boundaries your team already approved."><Button variant="secondary" icon="play" onClick={() => go("/merchant/growth")}>Open growth console</Button></PageHeader><div className="stats-grid growth-stats"><KpiCard label="Opportunities" value={String(data.growth.opportunities)} detail="From connected signals" tone="terracotta" points={[1, 2, 2, 3, 4, 4, Math.max(4, data.growth.opportunities)]} /><KpiCard label="Active plays" value={String(data.growth.activePlays)} detail="Re-evaluated by policy" tone="blue" points={[0, 1, 1, 2, 1, 2, data.growth.activePlays]} /><KpiCard label="Verified purchases" value={String(data.growth.verifiedPurchases)} detail="Provider-verified only" tone="sage" points={[0, 0, 1, 0, 1, 1, data.growth.verifiedPurchases]} /><KpiCard label="Realized revenue" value={data.growth.realizedRevenuePaise ? formatPaise(data.growth.realizedRevenuePaise) : "—"} detail={data.growth.history === "OBSERVED" ? "Observed" : "Insufficient history"} tone="amber" points={[0, 1, 1, 2, 2, 3, data.growth.realizedRevenuePaise ? 4 : 0]} /></div><div className="growth-columns"><Panel title="Opportunity queue" className="growth-list-panel"><div className="growth-empty-state"><span className="empty-icon tone-terracotta"><AppIcon name="growth" size={22} /></span><h3>{data.growth.opportunities ? `${data.growth.opportunities} policy-safe opportunities are ready to review.` : "The signal scan is ready."}</h3><p>Open the live console to inspect evidence, simulate a play, and activate only after policy evaluation.</p><Button icon="arrow" onClick={() => go("/merchant/growth")}>Review opportunities</Button></div></Panel><Panel title="Active plays" className="active-plays-panel"><div className="play-row"><div><b>Policy-aware growth engine</b><small><StatusBadge tone="sage">{data.growth.activePlays ? "Active" : "Ready"}</StatusBadge> Server re-check on every activation</small></div><span><small>Plays</small><b>{data.growth.activePlays}</b></span></div><button className="panel-link" onClick={() => go("/merchant/growth")}>Open growth console <AppIcon name="arrow" size={14} /></button></Panel><Panel title="Evidence state" className="signals-panel"><div className="signal-row"><span className="signal-icon tone-blue"><AppIcon name="chart" size={16} /></span><div><b>Attribution</b><small>{data.growth.verifiedPurchases ? "Verified purchase evidence available" : "Potential and simulated states remain distinct"}</small></div><StatusBadge tone={data.growth.verifiedPurchases ? "sage" : "amber"}>{data.growth.verifiedPurchases ? "Verified" : "Potential"}</StatusBadge></div><div className="signal-row"><span className="signal-icon tone-sage"><AppIcon name="shield" size={16} /></span><div><b>Margin safety</b><small>Every play requires the published policy runtime.</small></div><StatusBadge tone="sage">Enforced</StatusBadge></div></Panel></div></div>;
}

function ApprovalsPage({ data, selected, setSelected }: { data: CoreProductData; selected: string | null; setSelected: (id: string | null) => void }) {
  const pending = data.approvals.filter((approval) => approval.status === "PENDING");
  return <div className="page-view approvals-view"><PageHeader title="Approvals" subtitle="Review exceptions, money movement, and the evidence behind every decision."><StatusBadge tone={pending.length ? "amber" : "sage"}>{pending.length} pending</StatusBadge></PageHeader><div className="stats-grid approval-stats"><KpiCard label="Pending approvals" value={String(pending.length)} detail={pending.length ? "Needs merchant review" : "Queue clear"} tone="rose" points={[0, 1, 1, pending.length, pending.length, pending.length, pending.length]} /><KpiCard label="Transactions" value={String(data.transactions.length)} detail="Server-created records" tone="blue" points={[0, 1, 1, 2, 2, 3, data.transactions.length]} /><KpiCard label="Verified revenue" value={data.transactions.filter((item) => item.revenueState === "VERIFIED_REVENUE").length.toString()} detail="Verified records" tone="sage" points={[0, 0, 1, 1, 1, 2, 2]} /><KpiCard label="Audit events" value={String(data.activities.length)} detail="Recent evidence" tone="amber" points={[1, 1, 2, 3, 3, 4, data.activities.length]} /></div><Panel title="Pending approval requests" action={<StatusBadge tone="neutral">Merchant action required</StatusBadge>} className="approval-queue-panel"><div className="queue-table-wrap"><table className="queue-table"><thead><tr><th>Request</th><th>Product / customer</th><th>Requested</th><th>Reason</th><th>Created</th><th>Action</th></tr></thead><tbody>{pending.map((approval) => <tr className={selected === approval.id ? "is-selected" : ""} key={approval.id} onClick={() => setSelected(approval.id)}><td><b>{approval.id}</b><StatusBadge tone={approval.priority === "High" ? "rose" : "amber"}>{approval.priority}</StatusBadge></td><td><b>{approval.productName}</b><small>{approval.customerSegment} customer</small></td><td>{Math.round(approval.requestedDiscountBps / 100)}% off</td><td><small>{approval.reason}</small></td><td>{relativeTime(approval.createdAt)}</td><td><div className="row-actions"><Button variant="secondary" onClick={() => setSelected(approval.id)}>Review</Button><Button onClick={() => go(`/merchant/approvals?approvalId=${encodeURIComponent(approval.id)}`)}>Open console</Button></div></td></tr>)}</tbody></table>{pending.length === 0 && <EmptyState text="No approval requests are waiting for a merchant decision." />}</div></Panel><div className="approval-lower"><Panel title="Recent transactions"><TransactionTable transactions={data.transactions.slice(0, 5)} /></Panel><Panel title="Recent audit evidence"><div className="audit-preview">{data.activities.slice(0, 5).map((event) => <div key={event.id}><small>{relativeTime(event.createdAt)}</small><b>{event.eventType.replaceAll("_", " ")}</b><StatusBadge tone="neutral">Server</StatusBadge></div>)}{data.activities.length === 0 && <EmptyState text="No audit events yet." />}</div></Panel><Panel title="Decision boundary"><div className="security-preview"><div className="security-metrics"><span><b>100%</b><small>Policy evaluated</small><em>Server runtime</em></span><span><b>0</b><small>Client authority</small><em>Browser is untrusted</em></span><span><b>v{data.policyVersion || "—"}</b><small>Published policy</small><em>Immutable reference</em></span></div></div></Panel></div></div>;
}

export default function CoreProductApp({ initialPath, data }: { initialPath: string; data: CoreProductData }) {
  const [path, setPath] = useState(initialPath);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [selectedApproval, setSelectedApproval] = useState<string | null>(null);
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname + window.location.search);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const route = path.split("?")[0];
  const active = route === "/app/setup" ? "/app/setup" : route === "/app/storefront" ? "/app/storefront" : route === "/app/growth" ? "/app/growth" : route === "/app/approvals" ? "/app/approvals" : "/app/overview";
  const page = useMemo(() => {
    if (active === "/app/setup") return <SetupPage />;
    if (active === "/app/storefront") return <StorefrontPage data={data} />;
    if (active === "/app/growth") return <GrowthPage data={data} />;
    if (active === "/app/approvals") return <ApprovalsPage data={data} selected={selectedApproval} setSelected={setSelectedApproval} />;
    return <Overview data={data} onOpenApproval={(id) => { setSelectedApproval(id); go("/app/approvals"); }} />;
  }, [active, data, selectedApproval]);
  return <div className="product-shell"><Sidebar active={active} collapsed={collapsed} onCollapse={() => setCollapsed((value) => !value)} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} /><div className={`product-content ${collapsed ? "sidebar-collapsed" : ""}`}><Topbar onMenu={() => setMobileOpen(true)} /><main className="product-main">{page}</main></div>{mobileOpen && <button className="mobile-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}</div>;
}
