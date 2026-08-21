import Link from "next/link";
import { shopifyPreviewStore } from "../lib/connectors";

const steps = [
  { number: "01", title: "Connect your commerce rails", text: "Bring in the catalogue, storefront, and payment systems you already run." },
  { number: "02", title: "Shape the operating rules", text: "Write the boundaries in plain language. Keep the final authority explicit." },
  { number: "03", title: "Let customers move faster", text: "Give buyers a clear conversational path while your team stays in control." },
];

export default function Home() {
  return (
    <main className="landing-page">
      <nav className="site-nav" aria-label="Primary navigation">
        <Link className="brand" href="/" aria-label="AgentFlow home"><span className="brand-symbol">✦</span><span>AgentFlow</span></Link>
        <div className="nav-links"><a href="#product">Product</a><a href="#operating-model">Operating model</a><a href="/merchant">Merchant demo</a></div>
        <a className="nav-cta" href="/customer">Customer demo <span>↗</span></a>
      </nav>

      <section className="hero-shell">
        <div className="hero-copy">
          <p className="kicker"><span className="kicker-dot" />Commerce infrastructure for the agent era</p>
          <h1>Make every AI-led sale feel <em>intentional.</em></h1>
          <p className="hero-lede">AgentFlow gives merchants a clear operating layer for connected commerce: one place for catalogue, policy, approvals, and the customer experience.</p>
          <div className="hero-actions"><a className="button button-dark" href="/merchant">Open merchant workspace <span>↗</span></a><a className="button button-light" href="/customer">Shop the customer demo <span>↗</span></a></div>
          <div className="hero-notes"><span>Connected preview store</span><i /> <span>Editable policy</span><i /> <span>No live charge</span></div>
        </div>
        <div className="hero-stage" aria-label="AgentFlow product preview">
          <div className="stage-glow" />
          <div className="stage-card stage-intent"><span className="stage-label">Merchant intent</span><strong>“Repeat customers can go to 15%, but never below margin.”</strong><small>Drafted in plain language</small></div>
          <div className="stage-card stage-policy"><div className="stage-card-heading"><span className="stage-label">Policy runtime</span><span className="live-pill">LIVE</span></div><div className="policy-line"><span>Buyer context</span><b>✓</b></div><div className="policy-line"><span>Margin floor</span><b>✓</b></div><div className="policy-line"><span>Approval boundary</span><b>✓</b></div></div>
          <div className="stage-card stage-customer"><span className="avatar-dot">H</span><div><small>Customer request</small><strong>“Can you make it work for my room?”</strong></div><span className="stage-arrow">→</span></div>
          <div className="stage-orbit orbit-a" /><div className="stage-orbit orbit-b" />
        </div>
      </section>

      <section className="intro-band" id="product"><div><span className="section-label">One operating layer</span><h2>Separate the work. Connect the outcome.</h2></div><p>Merchant controls and customer moments should feel like two products that know about each other—not one crowded demo.</p></section>

      <section className="surface-grid" id="operating-model">
        <a className="surface-card surface-card-blue" href="/merchant"><div className="surface-top"><span className="surface-icon">M</span><span>For merchants ↗</span></div><div><h3>Run the business with confidence.</h3><p>Build a workflow, see what is connected, review exceptions, and understand every decision.</p></div><span className="surface-link">Open workspace</span></a>
        <a className="surface-card surface-card-peach" href="/customer"><div className="surface-top"><span className="surface-icon">C</span><span>For customers ↗</span></div><div><h3>Shop in a way that feels human.</h3><p>Explore the connected catalogue, ask for help, and test a negotiated offer without touching merchant controls.</p></div><span className="surface-link">Open storefront</span></a>
      </section>

      <section className="steps-section"><div className="section-heading"><span className="section-label">Designed for production habits</span><h2>Simple on the surface.<br />Precise underneath.</h2></div><div className="steps-grid">{steps.map((step) => <article className="step-card" key={step.number}><span className="step-number">{step.number}</span><h3>{step.title}</h3><p>{step.text}</p></article>)}</div></section>

      <section className="connection-section"><div className="connection-copy"><span className="section-label">The connected preview</span><h2>A real storefront rail for a real customer loop.</h2><p>The customer demo is connected to the Haven Home development store so the front-of-house experience has a tangible destination beyond the control plane.</p><a className="inline-link" href={shopifyPreviewStore.url} target="_blank" rel="noreferrer">Open Haven Home Preview <span>↗</span></a></div><div className="connection-card"><div className="connection-card-top"><span className="connection-logo">S</span><span className="connected-pill"><i />Connected</span></div><strong>{shopifyPreviewStore.name}</strong><span>Development storefront</span><div className="connection-divider" /><div className="connection-meta"><span>Catalogue</span><b>Seeded + ready</b></div><div className="connection-meta"><span>Customer rail</span><b>AgentFlow demo</b></div></div></section>

      <section className="closing-section"><span className="section-label">AgentFlow</span><h2>Commerce that keeps its shape as it scales.</h2><div className="closing-actions"><a className="button button-dark" href="/merchant">Build a workflow <span>↗</span></a><a className="inline-link" href="/customer">Try the customer journey <span>↗</span></a></div></section>

      <footer className="site-footer"><Link className="brand" href="/"><span className="brand-symbol">✦</span><span>AgentFlow</span></Link><span>Connected commerce, made legible.</span><span>© 2026</span></footer>
    </main>
  );
}
