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
      merchantEntry: await page.getByRole("link", { name: "Open Store" }).count(),
      hostedShopperEntry: await page.getByRole("link", { name: /customer demo|shop the customer/i }).count(),
    };
    await screenshot({ kind: "proof", name: "agentflow-landing" });

    await page.getByRole("link", { name: "Open Store" }).first().click();
    await page.waitForLoadState("networkidle");
    checks.merchant = {
      heading: await page.locator("h1").textContent(),
      navItems: await page.locator(".workspace-nav-link").count(),
      primaryNav: await page.locator(".workspace-nav-link").allTextContents(),
      liveStore: await page.locator("a.customer-switch").getAttribute("href"),
    };
    await screenshot({ kind: "proof", name: "agentflow-merchant" });

    await page.getByRole("link", { name: "Storefront" }).click();
    await page.waitForLoadState("networkidle");
    checks.storefront = {
      heading: await page.locator("h1").textContent(),
      shopifyDestination: await page.getByRole("link", { name: /Open live store|Open storefront/i }).count(),
      salespersonManager: await page.locator(".salesperson-manager").count(),
    };
    await screenshot({ kind: "proof", name: "agentflow-storefront" });

    await page.getByRole("link", { name: "Setup Copilot" }).click();
    await page.waitForLoadState("networkidle");
    checks.setupCopilot = {
      heading: await page.locator("h1").textContent(),
      prompt: await page.getByLabel("Merchant policy prompt").count(),
      compileButton: await page.getByRole("button", { name: /Compile policy blocks/i }).count(),
      fallbackVisible: await page.getByText("Deterministic fallback").count(),
    };
    await screenshot({ kind: "proof", name: "agentflow-setup-copilot" });

    await page.getByRole("link", { name: "Growth" }).click();
    await page.waitForLoadState("networkidle");
    checks.growth = { heading: await page.locator("h1").textContent() };
    await page.getByRole("link", { name: "Approvals" }).click();
    await page.waitForLoadState("networkidle");
    checks.approvals = { heading: await page.locator("h1").textContent() };
    checks.browserConsoleErrors = await page.evaluate(() => window.__consoleErrors || []);

    return checks;
  `, { session, note: "AgentFlow UI loop: landing, merchant control plane, Setup Copilot, Storefront, Growth, Approvals" });

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
};

try {
  await run();
} finally {
  await bw.close();
}
