"use client";

import { useState, type ReactNode } from "react";

type IconName =
  | "arrow"
  | "chevron"
  | "spark"
  | "shield"
  | "clock"
  | "lock"
  | "nodes"
  | "route"
  | "explain"
  | "search"
  | "bag"
  | "menu"
  | "close"
  | "check"
  | "chart"
  | "gift"
  | "wallet"
  | "user"
  | "box"
  | "link"
  | "mail"
  | "pin"
  | "linkedin"
  | "play"
  | "github";

function Icon({ name, size = 18, stroke = 1.8 }: { name: IconName; size?: number; stroke?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };

  if (name === "arrow") {
    return <svg {...common}><path d="M4 12h15" /><path d="m13 6 6 6-6 6" /></svg>;
  }
  if (name === "chevron") {
    return <svg {...common}><path d="m7 9 5 5 5-5" /></svg>;
  }
  if (name === "spark") {
    return <svg {...common}><path d="m12 2 1.5 6.5L20 12l-6.5 1.5L12 20l-1.5-6.5L4 12l6.5-3.5L12 2Z" /><path d="m19 3 .5 2.5L22 6l-2.5.5L19 9l-.5-2.5L16 6l2.5-.5L19 3Z" /></svg>;
  }
  if (name === "shield") {
    return <svg {...common}><path d="M12 3 20 6v5.5c0 4.8-3.4 8.2-8 9.5-4.6-1.3-8-4.7-8-9.5V6l8-3Z" /><path d="m8.5 12 2.3 2.3 4.7-4.7" /></svg>;
  }
  if (name === "clock") {
    return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></svg>;
  }
  if (name === "lock") {
    return <svg {...common}><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><path d="M12 14v2" /></svg>;
  }
  if (name === "nodes") {
    return <svg {...common}><circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="12" cy="18" r="2" /><path d="M8 7.1 10.6 16M16 7.1 13.4 16M8 6h8" /></svg>;
  }
  if (name === "route") {
    return <svg {...common}><circle cx="6" cy="6" r="2.3" /><circle cx="18" cy="18" r="2.3" /><path d="M8.5 6h3a4 4 0 0 1 4 4v2a4 4 0 0 0 4 4" /></svg>;
  }
  if (name === "explain") {
    return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M12 8v5" /><path d="M12 16h.01" /></svg>;
  }
  if (name === "search") {
    return <svg {...common}><circle cx="10.8" cy="10.8" r="6.4" /><path d="m16 16 4.2 4.2" /></svg>;
  }
  if (name === "bag") {
    return <svg {...common}><path d="M5 8.5h14l-1 11H6l-1-11Z" /><path d="M9 9V6a3 3 0 0 1 6 0v3" /></svg>;
  }
  if (name === "menu") {
    return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
  }
  if (name === "close") {
    return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
  }
  if (name === "check") {
    return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
  }
  if (name === "chart") {
    return <svg {...common}><path d="M5 19V9M12 19V5M19 19v-7" /><path d="M3 19h18" /></svg>;
  }
  if (name === "gift") {
    return <svg {...common}><path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13" /><path d="M12 7H8.7a2.2 2.2 0 1 1 2.2-2.2L12 7Zm0 0h3.3a2.2 2.2 0 1 0-2.2-2.2L12 7Z" /></svg>;
  }
  if (name === "wallet") {
    return <svg {...common}><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H19v16H6.5A2.5 2.5 0 0 1 4 17.5v-11Z" /><path d="M4 7h15" /><path d="M15 12h4v4h-4a2 2 0 0 1 0-4Z" /></svg>;
  }
  if (name === "user") {
    return <svg {...common}><circle cx="12" cy="8" r="3" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></svg>;
  }
  if (name === "box") {
    return <svg {...common}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4.4 7.7 7.6 4.4 7.6-4.4M12 12.1V21" /></svg>;
  }
  if (name === "link") {
    return <svg {...common}><path d="M10 13.5 14.5 9" /><path d="M7.4 16.1 5.7 17.8a3.2 3.2 0 0 1-4.5-4.5l3.1-3.1a3.2 3.2 0 0 1 4.5 0" /><path d="m16.6 7.9 1.7-1.7a3.2 3.2 0 0 1 4.5 4.5l-3.1 3.1a3.2 3.2 0 0 1-4.5 0" /></svg>;
  }
  if (name === "mail") {
    return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></svg>;
  }
  if (name === "pin") {
    return <svg {...common}><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.2" /></svg>;
  }
  if (name === "linkedin") {
    return <svg {...common}><path d="M6 9v9M6 6v.01M10 18v-5a4 4 0 0 1 8 0v5M10 9v9" /></svg>;
  }
  if (name === "play") {
    return <svg {...common}><path d="m9 6 8 6-8 6V6Z" /></svg>;
  }
  if (name === "github") {
    return <svg {...common}><path d="M9 19c-4.2 1.4-4.2-2.1-5.9-2.8M14.9 21v-3.2a2.8 2.8 0 0 0-.8-2.2c2.7-.3 5.5-1.3 5.5-5.9a4.6 4.6 0 0 0-1.2-3.2 4.3 4.3 0 0 0-.1-3.2s-1-.3-3.3 1.2a11.4 11.4 0 0 0-6 0C6.7 3.2 5.7 3.5 5.7 3.5a4.3 4.3 0 0 0-.1 3.2 4.6 4.6 0 0 0-1.2 3.2c0 4.6 2.8 5.6 5.5 5.9a2.8 2.8 0 0 0-.8 2.2V21" /></svg>;
  }
  return null;
}

function BrandMark({ dark = false }: { dark?: boolean }) {
  return (
    <span className="brand-lockup">
      <img className="brand-mark-image" src="/assets/agentflow-mark.svg" alt="" aria-hidden="true" />
      <svg className="brand-mark" viewBox="0 0 48 48" aria-hidden="true">
        <g fill="none" stroke={dark ? "#c96145" : "#d26749"} strokeWidth="2.6" strokeLinecap="round">
          <path d="M24 5c3.4 0 4.7 5.8 4.7 9.6C28.7 9.7 31 5 34.1 6.3c3.2 1.4-.1 6.7-3.1 9.3 3.2-2.4 8.4-4.5 9.7-1.3 1.2 3-4.1 5.2-8 5.8 3.9.2 9.4 1.8 8.8 5.1-.6 3.5-6 2-9.3.1 2.8 2.8 5.8 7.7 3 9.4-2.9 1.8-5.7-3.1-7.2-6.7-.3 3.8-2.1 9.4-5.4 8.7-3.4-.7-1.9-6.3 0-9.6-2.8 2.7-7.7 5.7-9.4 2.8-1.8-2.9 3.2-5.6 6.7-7-3.9-.4-9.4-2.2-8.6-5.5.8-3.3 6.3-1.6 9.5.2-2.6-2.8-5.4-7.9-2.5-9.4 2.9-1.4 5.5 3.5 6.8 7.1C20.9 10.2 20.6 5 24 5Z" />
          <circle cx="24" cy="24" r="3.5" fill={dark ? "#c96145" : "#d26749"} stroke="none" />
        </g>
      </svg>
      <span className="brand-name">AgentFlow</span>
    </span>
  );
}

function ButtonLink({
  href,
  children,
  variant = "primary",
  icon = "arrow"
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "dark";
  icon?: IconName;
}) {
  return (
    <a className={"button button-" + variant} href={href}>
      <span>{children}</span>
      <Icon name={icon} size={17} />
    </a>
  );
}

function Eyebrow({ children, icon = "spark" }: { children: ReactNode; icon?: IconName }) {
  return <div className="eyebrow"><Icon name={icon} size={14} /><span>{children}</span></div>;
}

function FeatureItem({ icon, title, children, tone = "sage" }: { icon: IconName; title: string; children: ReactNode; tone?: string }) {
  return (
    <div className="feature-item">
      <span className={"feature-icon tone-" + tone}><Icon name={icon} size={21} /></span>
      <span className="feature-copy"><strong>{title}</strong><small>{children}</small></span>
    </div>
  );
}

function StatusDot({ tone = "green" }: { tone?: string }) {
  return <span className={"status-dot status-" + tone} />;
}

function JaliAccent({ side = "right" }: { side?: "left" | "right" }) {
  return <div className={"jali-accent jali-" + side} aria-hidden="true" />;
}

function HeroScene() {
  return (
      <div className="hero-scene" aria-label="AgentFlow commerce flow illustration">
      <div className="arch-outline" />
      <svg className="hero-connector-map" viewBox="0 0 970 650" preserveAspectRatio="none" aria-hidden="true">
        <path d="M210 399H231V451" />
        <path d="M495 440V459" />
        <path d="M770 318H790" />
        <path d="M341 533H392M435 533H461" />
        <g>
          <circle cx="210" cy="399" r="4" />
          <circle cx="231" cy="443" r="4" />
          <circle cx="495" cy="440" r="4" />
          <circle cx="495" cy="451" r="4" />
          <circle cx="770" cy="318" r="4" />
          <circle cx="790" cy="318" r="4" />
          <circle cx="341" cy="533" r="4" />
          <circle cx="392" cy="533" r="4" />
          <circle cx="435" cy="533" r="4" />
          <circle cx="461" cy="533" r="4" />
        </g>
      </svg>
      <div className="hero-wires" aria-hidden="true">
        <span className="wire wire-policy" />
        <span className="wire wire-store" />
        <span className="wire wire-assistant" />
        <span className="wire wire-payment" />
        <span className="wire wire-flow" />
        <span className="flow-node">✦</span>
      </div>
      <div className="scene-glow glow-one" />
      <div className="scene-glow glow-two" />
      <div className="policy-card floating-card">
        <div className="card-kicker"><span>COMMERCE POLICIES</span><span className="circle-icon"><Icon name="shield" size={18} /></span></div>
        {[
          ["Discount Guardrails", "Max 20% off", "green"],
          ["Category Rules", "Restricted categories", "green"],
          ["Role-based Access", "Approvals by role", "green"],
          ["Payment Controls", "Allowed methods", "green"]
        ].map(([title, detail, tone]) => (
          <div className="policy-row" key={title}>
            <span className="row-icon"><Icon name={title === "Payment Controls" ? "wallet" : title === "Role-based Access" ? "user" : title === "Category Rules" ? "route" : "chart"} size={15} /></span>
            <span className="row-copy"><strong>{title}</strong><small>{detail}</small></span>
            <span className="active-label"><StatusDot tone={tone} />Active</span>
          </div>
        ))}
        <div className="card-link">View all policies <Icon name="chevron" size={15} /></div>
      </div>

      <div className="store-window floating-card">
        <div className="window-chrome"><span /><span /><span /><div className="store-pill"><Icon name="spark" size={14} />AI Storefront</div></div>
        <div className="store-nav"><span className="store-brand"><span className="hamburger-mark">≡</span>HAVEN HOME</span><span>New arrivals</span><span>Dining</span><span>Seating</span><span>Storage</span><span>Decor</span><Icon name="search" size={15} /><Icon name="bag" size={15} /></div>
        <div className="store-hero">
          <div className="store-hero-backdrop" />
          <div className="store-hero-content"><strong>Made for<br />living well</strong><small>Furniture with a softer point of view.</small><span className="store-cta">Shop collection</span></div>
          <div className="model-cutout" />
        </div>
        <div className="store-trust-row">
          <span><Icon name="shield" size={15} /><b>Premium Quality</b><small>Assured</small></span>
          <span><Icon name="clock" size={15} /><b>Easy Returns</b><small>7-day return</small></span>
          <span><Icon name="wallet" size={15} /><b>Secure Payments</b><small>Multiple options</small></span>
          <span><Icon name="spark" size={15} /><b>Made in India</b><small>Proudly Indian</small></span>
        </div>
      </div>

      <div className="assistant-card floating-card">
        <div className="assistant-head"><span><Icon name="spark" size={15} /> AI SALESPERSON</span><span>— ×</span></div>
        <div className="chat chat-in"><span className="chat-avatar"><Icon name="spark" size={13} /></span><p>Hi! I&apos;m your AI shopping assistant. How can I help you today?</p></div>
        <div className="chat chat-out"><p>I need a dining set for a small apartment under ₹50,000.</p></div>
        <div className="chat chat-in"><span className="chat-avatar"><Icon name="spark" size={13} /></span><p>Great choice! Here are some curated picks.</p></div>
        <div className="chat-products"><span /><span /><span /></div>
        <div className="chat-input">Ask anything... <span className="send-circle"><Icon name="arrow" size={14} /></span></div>
      </div>

      <div className="approval-card floating-card mini-card">
        <div className="mini-card-title">APPROVALS <span className="circle-icon"><Icon name="nodes" size={16} /></span></div>
        <div className="approval-row"><span className="mini-symbol"><Icon name="lock" size={14} /></span><span><b>Order exceeds discount limit</b><small>₹4,800 discount</small></span><em>Pending</em></div>
        <div className="approval-row"><span className="mini-symbol green"><Icon name="check" size={14} /></span><span><b>New customer - High value</b><small>₹18,750 order</small></span><em className="approved">Approved</em></div>
        <div className="card-link">View all approvals <Icon name="chevron" size={14} /></div>
      </div>

      <div className="payment-card floating-card mini-card">
        <div className="mini-card-title">PAYMENT <span className="circle-icon"><Icon name="wallet" size={16} /></span></div>
        <div className="razorpay">⌁Razorpay <span>Captured</span></div>
        <div className="payment-line"><span>Order ID</span><b>#AF-98215</b></div>
        <div className="payment-line"><span>Amount</span><b>₹18,750.00</b></div>
        <div className="payment-line"><span>Method</span><b>Visa •••• 4242</b></div>
        <div className="card-link">View transaction <Icon name="chevron" size={14} /></div>
      </div>

      <div className="flow-badge"><span className="flow-check"><Icon name="check" size={14} /></span>Policy checked <i>•</i><span className="flow-check"><Icon name="check" size={14} /></span>Approved <i>•</i><span className="flow-check"><Icon name="check" size={14} /></span>Payment captured <i>•</i><b>Order complete</b></div>
    </div>
  );
}

function PolicyNode({ icon, tone, title, text, badge }: { icon: IconName; tone: string; title: string; text: string; badge: string }) {
  return (
    <div className={"policy-node node-" + tone + " node-" + title.toLowerCase().replace(/ /g, "-")}>
      <span className="node-icon"><Icon name={icon} size={18} /></span>
      <strong>{title}</strong>
      <p>{text}</p>
      <small>{badge}</small>
    </div>
  );
}

function PolicyScene() {
  return (
    <div className="policy-scene">
      <div className="canvas-toolbar"><span className="toolbar-brand"><Icon name="spark" size={17} /></span><span className="toolbar-title">Policy Canvas <StatusDot /> <small>Live</small></span><span className="toolbar-actions">− &nbsp; 100% &nbsp; + &nbsp; ⛶</span><button>↶ Version history</button><button className="publish">↗ Publish policy</button></div>
      <div className="canvas-body">
        <div className="canvas-side-tools"><span className="selected">⌁</span><span>⊞</span><span>⌘</span><span>▤</span><span>♢</span><span>◷</span></div>
        <div className="canvas-grid">
          <svg className="policy-connector-map" viewBox="0 0 1000 493" preserveAspectRatio="none" aria-hidden="true">
            <path d="M320 110 H340 V195 H360" />
            <path d="M320 255 H360" />
            <path d="M320 410 H340 V270 H360" />
            <path d="M640 195 H660 V110 H680" />
            <path d="M640 230 H680" />
            <path d="M640 270 H660 V410 H680" />
            <circle cx="320" cy="110" r="5" /><circle cx="360" cy="195" r="5" />
            <circle cx="320" cy="255" r="5" /><circle cx="360" cy="230" r="5" />
            <circle cx="320" cy="410" r="5" /><circle cx="360" cy="270" r="5" />
            <circle cx="640" cy="195" r="5" /><circle cx="680" cy="110" r="5" />
            <circle cx="640" cy="230" r="5" /><circle cx="680" cy="230" r="5" />
            <circle cx="640" cy="270" r="5" /><circle cx="680" cy="410" r="5" />
          </svg>
          <div className="connector connector-a" /><div className="connector connector-b" /><div className="connector connector-c" /><div className="connector connector-d" /><div className="connector connector-e" />
          <PolicyNode icon="user" tone="green" title="Repeat Customer Rule" text="Customer orders ≥ 2 in last 30 days" badge="Allow" />
          <PolicyNode icon="box" tone="amber" title="Inventory Pressure" text="Stock remaining < 20%" badge="Signal" />
          <PolicyNode icon="chart" tone="lilac" title="Margin Floor" text="Gross margin ≥ 25%" badge="Allow" />
          <PolicyNode icon="shield" tone="blue" title="Approval Threshold" text="Discount > 15% requires approval" badge="Review" />
          <PolicyNode icon="gift" tone="green" title="Bundle Offer" text="Recommend bundle to increase AOV" badge="Allow" />
          <PolicyNode icon="lock" tone="red" title="Deny Restricted Brand" text="Brand is on restricted list" badge="Deny" />
          <PolicyNode icon="wallet" tone="blue" title="Payment Guardrail" text="Max order value by payment method" badge="Allow" />
        </div>
        <div className="settings-panel">
          <div className="settings-head"><b>Approval Threshold</b><span>×</span></div>
          <span className="settings-label">Rule type</span><div className="setting-select">Approval <span>⌄</span></div>
          <span className="settings-label">Condition</span><div className="setting-select">Discount percentage <span>⌄</span></div><div className="setting-select">is greater than <span>⌄</span></div><div className="setting-value">15 <span>%</span></div>
          <span className="settings-label">Action</span><div className="setting-select">Route to<br /><b>Human approval</b><span>⌄</span></div>
          <span className="settings-label">Settings</span><div className="toggle-row">Log decision <i className="toggle on" /></div><div className="toggle-row">Capture context <i className="toggle on" /></div><div className="toggle-row">Stop on deny <i className="toggle" /></div>
          <span className="settings-label">Notes</span><div className="notes">Add a note (optional)...</div>
        </div>
      </div>
      <div className="canvas-legend"><span><i className="legend-dot allow" />Allow</span><span><i className="legend-dot review" />Review</span><span><i className="legend-dot deny" />Deny</span><span><i className="legend-dot signal" />Signal</span><span><i className="legend-line" />Fallback</span></div>
      <div className="safe-note"><Icon name="shield" size={18} /><span><b>Safe by design.</b> Policies are versioned, tested, and rolled out with confidence.</span></div>
    </div>
  );
}

function StorefrontScene() {
  return (
    <div className="storefront-scene">
      <svg className="storefront-connector-map" viewBox="0 0 900 630" preserveAspectRatio="none" aria-hidden="true">
        <path d="M615 220 H665" />
        <path d="M319 517 V527" />
        <path d="M772 518 V527 H700" />
        <circle cx="615" cy="220" r="5" /><circle cx="665" cy="220" r="5" />
        <circle cx="319" cy="517" r="5" /><circle cx="319" cy="527" r="5" />
        <circle cx="772" cy="518" r="5" /><circle cx="700" cy="527" r="5" />
      </svg>
      <span className="storefront-flow-node" aria-hidden="true"><Icon name="spark" size={19} /></span>
      <img className="storefront-mark" src="/assets/agentflow-mark.svg" alt="" aria-hidden="true" />
      <div className="storefront-main floating-card">
        <div className="storefront-top"><span className="store-brand"><span className="hamburger-mark">≡</span>HAVEN HOME</span><span>New arrivals</span><span>Dining</span><span>Seating</span><span>Storage</span><span>Decor</span><Icon name="search" size={15} /><Icon name="bag" size={15} /></div>
        <div className="storefront-hero"><div className="storefront-copy"><b>Made for<br />living well</b><small>Furniture with a softer point of view.</small><span>Shop collection</span></div><div className="storefront-photo" /></div>
        <div className="recommend-title">Recommended for you</div>
        <div className="product-row">
          <div className="product-tile product-yellow"><div className="product-photo" /><b>Oak dining<br />table</b><strong>₹38,900</strong><small>★ 4.8 (42)</small></div>
          <div className="product-tile product-blush"><div className="product-photo" /><b>Bouclé lounge<br />chair</b><strong>₹24,500</strong><small>★ 4.7 (36)</small></div>
          <div className="product-tile product-jadau"><div className="product-photo" /><b>Hand-thrown<br />ceramic vase</b><strong>₹3,200</strong><small>★ 4.9 (18)</small></div>
        </div>
      </div>
      <div className="shop-assistant floating-card">
        <div className="assistant-head"><span><Icon name="spark" size={15} /> AI ASSISTANT</span><span>− ×</span></div>
        <div className="assistant-messages"><div className="chat chat-in"><span className="chat-avatar"><Icon name="spark" size={13} /></span><p>Hi! I&apos;m your AI shopping assistant. How can I help you today?</p></div><div className="chat chat-out"><p>I need a dining table for a small apartment under ₹40,000.</p></div><div className="chat chat-in"><span className="chat-avatar"><Icon name="spark" size={13} /></span><p>Great! Here are some pieces that keep the room feeling open.</p></div><span className="typing">•••</span></div>
        <div className="suggestions"><span>Warm oak</span><span>Under ₹40,000</span><span>Small space</span></div><div className="chat-input">Ask anything... <span className="send-circle"><Icon name="arrow" size={14} /></span></div>
      </div>
      <div className="shortlist floating-card"><div><b>Your Shortlist (3)</b><button>Compare</button></div><div className="shortlist-row"><span className="short-product product-yellow"><i className="product-photo" /><b>Oak dining<br />table</b><strong>₹38,900</strong>×</span><span className="short-product product-blush"><i className="product-photo" /><b>Bouclé lounge<br />chair</b><strong>₹24,500</strong>×</span><span className="short-product product-jadau"><i className="product-photo" /><b>Hand-thrown<br />vase</b><strong>₹3,200</strong>×</span><span className="add-more"><b>＋</b><small>Add more</small></span></div></div>
      <div className="guidance-note"><Icon name="shield" size={17} />Guides every shopper conversation. Recommends with reason.</div>
    </div>
  );
}

function SystemScene() {
  return (
    <div className="system-scene">
      <div className="system-arch" />
      <div className="system-orbit" />
      <div className="system-card system-policy"><span className="system-icon green"><Icon name="shield" size={22} /></span><b>Policy Guardrails</b><small><Icon name="check" size={14} />Discounts within limits</small><small><Icon name="check" size={14} />Brand &amp; category rules</small></div>
      <div className="system-card system-ai"><span className="system-icon amber"><Icon name="spark" size={22} /></span><b>Storefront AI</b><div className="tiny-message">Hi! I&apos;m your AI shopping assistant. How can I help?</div><div className="tiny-reply">Find a table under ₹50,000</div><div className="tiny-products"><span className="product-yellow" /><span className="product-blush" /><span className="product-jadau" /></div></div>
      <div className="system-card system-payments"><span className="system-icon green"><Icon name="wallet" size={22} /></span><b>Secure Payments</b><small><Icon name="check" size={14} />Multiple payment options</small><small><Icon name="check" size={14} />PCI-DSS compliant</small><small><Icon name="check" size={14} />Fast &amp; reliable payouts</small></div>
      <div className="system-core"><BrandMark /><span>✦</span></div>
      <div className="system-status"><Icon name="shield" size={18} />Safe. Compliant. Conversational. <i>•</i> Built for scale.</div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <JaliAccent side="left" />
      <div className="footer-inner">
        <div className="footer-brand"><BrandMark dark /><p>The agentic commerce platform for safe, conversational shopping.</p><a className="footer-mail" href="mailto:hello@agentflow.ai"><Icon name="mail" size={16} />hello@agentflow.ai</a><div className="socials"><a href="#linkedin" aria-label="LinkedIn"><Icon name="linkedin" size={18} /></a><a href="#twitter" aria-label="Twitter">𝕏</a><a href="#youtube" aria-label="YouTube"><Icon name="play" size={16} /></a><a href="#github" aria-label="GitHub"><Icon name="github" size={17} /></a></div></div>
        <div className="footer-column"><b>PRODUCT</b><a href="#policy">Policy Engine</a><a href="#storefront">Storefront AI</a><a href="#approvals">Approvals</a><a href="#payments">Payments</a><a href="#integrations">Integrations</a></div>
        <div className="footer-column"><b>COMPANY</b><a href="#about">About Us</a><a href="#customers">Customers</a><a href="#partners">Partners</a><a href="#blog">Blog</a><a href="#contact">Contact</a></div>
        <div className="footer-column"><b>RESOURCES</b><a href="/app/setup">Docs</a><a href="#guides">Guides</a><a href="#templates">Templates</a><a href="#case-studies">Case Studies</a><a href="#help">Help Center</a></div>
        <div className="footer-column"><b>LEGAL</b><a href="#privacy">Privacy Policy</a><a href="#terms">Terms of Service</a><a href="#cookies">Cookie Policy</a><a href="#dpa">Data Processing Addendum</a></div>
        <div className="footer-column footer-contact"><b>CONTACT</b><a href="#contact">Sales Inquiries</a><a href="#contact">Support</a><a href="#contact">Become a Partner</a><span><Icon name="pin" size={16} />Bengaluru, India</span></div>
      </div>
      <div className="footer-bottom">© 2026 AgentFlow. All rights reserved.</div>
    </footer>
  );
}

function MarketingApp() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const navItems = [
    { label: "Product", items: ["Policy Engine", "Storefront AI", "Payments"] },
    { label: "Solutions", items: ["For modern merchants", "For marketplaces"] },
    { label: "Resources", items: ["Docs", "Guides", "Case studies"] }
  ];

  return (
    <div className="page">
      <header className="navbar">
        <a href="#top" aria-label="AgentFlow home"><BrandMark /></a>
        <nav className={"desktop-nav " + (mobileOpen ? "is-open" : "")}>
          {navItems.map((item) => (
            <div className="nav-dropdown" key={item.label}>
              <button onClick={() => setOpenMenu(openMenu === item.label ? null : item.label)} aria-expanded={openMenu === item.label}>{item.label}<Icon name="chevron" size={15} /></button>
              {openMenu === item.label && <div className="dropdown-menu">{item.items.map((sub) => <a href={"#" + sub.toLowerCase().replace(/ /g, "-")} key={sub}>{sub}</a>)}</div>}
            </div>
          ))}
          <a href="#pricing">Pricing</a><a href="#developers">Developers</a>
          <div className="mobile-only mobile-actions"><a href="/app/overview">Sign in</a><ButtonLink href="/app/overview">Open Store</ButtonLink></div>
        </nav>
        <div className="nav-actions"><a href="/app/overview">Sign in</a><ButtonLink href="/app/overview">Open Store</ButtonLink></div>
        <button className="menu-toggle" onClick={() => setMobileOpen(!mobileOpen)} aria-label={mobileOpen ? "Close menu" : "Open menu"}><Icon name={mobileOpen ? "close" : "menu"} size={22} /></button>
      </header>

      <main>
        <section className="hero section">
          <JaliAccent />
          <div className="section-shell hero-grid">
            <div className="hero-copy">
              <Eyebrow>AGENTIC COMMERCE PLATFORM</Eyebrow>
              <h1>Turn Your Store Into an<br /><span>AI-Native Commerce</span><br />Engine</h1>
              <p className="lede">Define safe commerce policies. Power an AI storefront salesperson. Manage approvals. Execute payments. All in one intelligent flow.</p>
              <div className="cta-row"><ButtonLink href="/app/overview">Open Store</ButtonLink><ButtonLink href="#policy" variant="secondary" icon="play">Explore the platform</ButtonLink></div>
              <div className="feature-grid hero-features">
                <FeatureItem icon="shield" title="Policy-first commerce">Safe, compliant, and auditable</FeatureItem>
                <FeatureItem icon="clock" title="Human-in-the-loop" tone="amber">Approvals where it matters</FeatureItem>
                <FeatureItem icon="lock" title="Enterprise-grade payments" tone="rose">Secure. Reliable. Reconciled.</FeatureItem>
              </div>
            </div>
            <HeroScene />
          </div>
        </section>

        <section className="section policy-section" id="policy">
          <JaliAccent side="right" />
          <div className="section-shell split-grid">
            <div className="section-copy">
              <Eyebrow icon="spark">VISUAL POLICY BUILDER</Eyebrow>
              <h2>Define How<br />Your <span>AI Can Sell</span></h2>
              <p className="lede">Create merchant guardrails that your AI follows every time—approvals, discount limits, category restrictions, and more.</p>
              <div className="cta-row"><ButtonLink href="/demo">Book a demo</ButtonLink><ButtonLink href="/docs" variant="secondary" icon="link">Explore policy docs</ButtonLink></div>
              <div className="bullet-list">
                <FeatureItem icon="route" title="No-code rule building" tone="amber">Drag, drop, and connect rules in minutes.</FeatureItem>
                <FeatureItem icon="nodes" title="Deterministic policy runtime" tone="lilac">Consistent outcomes with versioned policies and safe fallbacks.</FeatureItem>
                <FeatureItem icon="explain" title="Explainable decisions" tone="green">Every decision includes a traceable reasoning path.</FeatureItem>
              </div>
            </div>
            <PolicyScene />
          </div>
        </section>

        <section className="section storefront-section" id="storefront">
          <JaliAccent side="right" />
          <div className="section-shell split-grid storefront-grid">
            <div className="section-copy">
              <Eyebrow icon="spark">AI STOREFRONT GUIDANCE</Eyebrow>
              <h2>When Shoppers<br />Don’t Want to Scroll,<br />Let Them <span>Talk</span></h2>
              <p className="lede">Shoppers don’t want to browse endless catalogs. They want help finding the right product—fast. AgentFlow’s AI storefront listens, understands, and guides them to the perfect choice in real time.</p>
              <div className="bullet-list">
                <FeatureItem icon="lock" title="No endless scrolling" tone="rose">Ask naturally. Skip the noise.</FeatureItem>
                <FeatureItem icon="spark" title="Natural product discovery" tone="amber">Get tailored picks that actually fit.</FeatureItem>
                <FeatureItem icon="chart" title="Shortlists &amp; comparisons instantly" tone="green">Compare options and decide with confidence.</FeatureItem>
              </div>
            </div>
            <StorefrontScene />
          </div>
        </section>

        <section className="section get-started-section" id="get-started">
          <JaliAccent side="right" />
          <div className="section-shell split-grid get-started-grid">
            <div className="section-copy">
              <Eyebrow icon="shield">GET STARTED</Eyebrow>
              <h2>Open Your Store<br />to <span>Agentic Commerce</span></h2>
              <p className="lede">Let AI handle shopping conversations—from discovery to checkout. With policy guardrails, storefront AI, approvals, and secure payments.</p>
              <div className="cta-row"><ButtonLink href="/app/overview">Open Store</ButtonLink><ButtonLink href="#policy" variant="secondary" icon="play">Explore the platform</ButtonLink></div>
            </div>
            <SystemScene />
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

export default MarketingApp;
