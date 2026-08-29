import { BetterWright, NetworkPolicy } from "betterwright";

const baseUrl = process.env.AGENTFLOW_BASE_URL ?? "http://127.0.0.1:5173";
const session = process.env.BETTERWRIGHT_SESSION ?? "agentflow-ui-loop";
const bw = new BetterWright({ defaultTimeout: 20000, policy: new NetworkPolicy({ allowLoopback: true }) });

const run = async () => {
  const result = await bw.run(`
    const baseUrl = ${JSON.stringify(baseUrl)};
    const checks = {};

    await page.goto(baseUrl);
    await page.waitForLoadState("networkidle");
    checks.landing = {
      title: await page.title(),
      heading: await page.locator("h1").first().textContent(),
      merchantLink: await page.getByRole("link", { name: "Open merchant workspace" }).count(),
      customerLink: await page.getByRole("link", { name: "Shop the customer demo" }).count(),
    };
    await screenshot({ kind: "proof", name: "agentflow-landing" });

    await page.getByRole("link", { name: "Open merchant workspace" }).click();
    await page.waitForLoadState("networkidle");
    checks.merchant = {
      heading: await page.locator("h1").textContent(),
      navItems: await page.locator(".workspace-nav-link").count(),
      customerSwitch: await page.locator("a.customer-switch").count(),
    };
    await screenshot({ kind: "proof", name: "agentflow-merchant" });

    await page.getByRole("link", { name: "Connectors" }).click();
    await page.waitForLoadState("networkidle");
    checks.connectors = {
      shopify: await page.getByText("Haven Home Preview").count(),
      customerDestination: await page.getByRole("link", { name: "Open storefront" }).count(),
    };

    await page.getByRole("link", { name: "Onboarding" }).click();
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Compile policy blocks" }).click();
    await page.locator(".compiled-result-inner").waitFor({ state: "visible", timeout: 20000 });
    checks.onboarding = {
      compilerVisible: await page.locator(".compiled-result-inner").count(),
      discrepancies: await page.locator(".discrepancy-card").count(),
      generatedBlocks: await page.locator(".policy-block").count(),
      fallbackVisible: await page.getByText("Deterministic fallback").count(),
    };
    await screenshot({ kind: "proof", name: "agentflow-onboarding" });
    const unresolved = page.getByRole("button", { name: "Apply recommended resolution" });
    while (await unresolved.count()) await unresolved.first().click();
    checks.onboarding.publishedReady = await page.getByText("Ready for the customer preview").count();

    await page.getByRole("link", { name: "Workflow" }).click();
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Standard customer discount").fill("6");
    await page.getByLabel("Repeat customer discount").fill("12");
    await page.getByLabel("Minimum gross margin").fill("28");
    await page.getByLabel("Approval threshold").fill("30000");
    await page.getByRole("button", { name: "Save workflow" }).click();
    checks.workflow = {
      saved: await page.getByText("Draft saved").count(),
      previewHref: await page.getByRole("link", { name: "Preview as customer" }).getAttribute("href"),
    };
    await screenshot({ kind: "proof", name: "agentflow-workflow" });

    await page.getByRole("link", { name: "Preview as customer" }).click();
    await page.waitForLoadState("networkidle");
    checks.customer = {
      heading: await page.locator("h1").textContent(),
      connectedStore: await page.getByText("Haven Home Preview").count(),
      productCards: await page.locator(".customer-product").count(),
      offerTool: await page.getByText("Test your own offer").count(),
      voiceSalesperson: await page.locator(".voice-salesperson-panel").count(),
      salespersonProfiles: await page.locator(".voice-profile").count(),
      languageSelector: await page.getByLabel("Language").count(),
      microphoneControl: await page.getByRole("button", { name: "Start microphone" }).count(),
      textTurn: await page.getByLabel("Type to your AI salesperson").count(),
    };
    await page.getByLabel("Requested discount").fill("3");
    await page.getByLabel("Quantity").fill("1");
    await page.getByRole("button", { name: "Evaluate this offer" }).click();
    checks.allowedOffer = {
      decisionVisible: await page.locator(".decision-panel").isVisible(),
      outcome: await page.locator(".decision-panel-top > b").textContent(),
    };
    await screenshot({ kind: "proof", name: "agentflow-customer-allow" });

    await page.getByLabel("Requested discount").fill("20");
    await page.getByRole("button", { name: "Evaluate this offer" }).click();
    checks.customOffer = {
      outcome: await page.locator(".decision-panel-top > b").textContent(),
      explanation: await page.locator(".decision-panel > p").textContent(),
    };
    await screenshot({ kind: "proof", name: "agentflow-customer-custom-offer" });

    await page.getByLabel("Ask Haven a question").fill("Help me compare the desks");
    await page.getByRole("button", { name: "Send question" }).click();
    checks.chatLoop = await page.locator(".conversation-message.assistant").count();
    checks.browserConsoleErrors = await page.evaluate(() => window.__consoleErrors || []);

    return checks;
  `, { session, note: "AgentFlow UI loop: landing, merchant, workflow editor, customer offer evaluation, chat" });

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
};

try {
  await run();
} finally {
  await bw.close();
}
