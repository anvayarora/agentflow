import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";

import { parseEconomicsImport } from "../lib/growth/importer.ts";
import { scanGrowth, getEligibleGrowthActions } from "../lib/growth/engine.ts";
import { activateGrowthPlay, createGrowthPlay, negotiationAllowed, simulateGrowthPlay } from "../lib/growth/plays.ts";
import { comparePolicySimulation } from "../lib/simulation/engine.ts";
import { diffPolicyVersions } from "../lib/policy/diff.ts";
import { policyToGraph, graphToPolicy } from "../lib/policy/graph-projection.ts";
import { validatePolicy } from "../lib/policy/validator.ts";
import { getCommerceRepository, resetCommerceRepositoryForTests } from "../lib/server/repositories/commerce.ts";
import { getGrowthRepository, resetGrowthRepositoryForTests } from "../lib/server/repositories/growth.ts";
import { resetRuntimeStoreForTests } from "../lib/server/runtime/store.ts";

delete process.env.DATABASE_URL;
const context = { organizationId: "org_haven_home_demo", actorType: "merchant", actorId: "growth-test", correlationId: "growth-test-correlation" };

test("private economics importer parses CSV, validates rows, and updates canonical products", async () => {
  resetCommerceRepositoryForTests();
  const repository = getCommerceRepository();
  const catalogue = await repository.listProducts(context);
  const report = parseEconomicsImport("sku,cost,brand,privateTags\nLAMP-022,1850,Haven Home,clearance;bundle\nUNKNOWN,10,Haven Home,\n", "economics.csv", catalogue);
  assert.equal(report.rowsParsed, 2);
  assert.equal(report.rowsMatched, 1);
  assert.equal(report.errors.length, 1);
  assert.equal(report.updates[0].costPaise, 185_000);
  await repository.updateProductEconomics(context, report.updates[0].productId, report.updates[0]);
  assert.equal((await repository.getProduct(context, "lamp-022")).costPaise, 185_000);
});

test("private economics importer parses a real XLSX workbook", async () => {
  resetCommerceRepositoryForTests();
  const sheet = XLSX.utils.json_to_sheet([{ sku: "ACC-014", cost: 600, currency: "INR", supplier: "Haven Supply" }]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Economics");
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const report = parseEconomicsImport(bytes, "economics.xlsx", await getCommerceRepository().listProducts(context));
  assert.equal(report.errors.length, 0);
  assert.equal(report.rowsMatched, 1);
  assert.equal(report.updates[0].costPaise, 60_000);
});

test("policy graph is a projection and graph edits map back to the draft IR", async () => {
  resetCommerceRepositoryForTests();
  const policy = await getCommerceRepository().getCurrentPolicy(context);
  const graph = policyToGraph(policy);
  assert.ok(graph.nodes.some((node) => node.family === "ECONOMICS"));
  assert.ok(graph.nodes.some((node) => node.family === "GOVERNANCE"));
  const repeatNode = graph.nodes.find((node) => node.ruleId === "repeat-customer-ceiling");
  assert.ok(repeatNode);
  const edited = graphToPolicy(policy, { ...graph, nodes: graph.nodes.map((node) => node.ruleId === "repeat-customer-ceiling" ? { ...node, config: { ...node.config, effect: { type: "SET_MAX_DISCOUNT_BPS", valueBps: 1200 } } } : node) });
  assert.equal(edited.rules.find((rule) => rule.id === "repeat-customer-ceiling").effect.valueBps, 1200);
  assert.equal(validatePolicy(edited).errors.length, 0);
});

test("policy diff and comparison simulation remain explicitly simulated", async () => {
  resetCommerceRepositoryForTests();
  const repository = getCommerceRepository();
  const published = await repository.getCurrentPolicy(context);
  const draft = await repository.createDraft(context);
  const changed = { ...draft, rules: draft.rules.map((rule) => rule.id === "global-max-discount" ? { ...rule, effect: { ...rule.effect, valueBps: 800 } } : rule) };
  await repository.updateDraft(context, draft.id, changed);
  const diff = diffPolicyVersions(published, changed);
  assert.equal(diff.summary.modified, 1);
  const simulation = await comparePolicySimulation(context, draft.id, [{ id: "case-1", productId: "desk-032", quantity: 1, requestedDiscountBps: 500 }]);
  assert.equal(simulation.kind, "SIMULATED");
  assert.deepEqual(simulation.labels.observed, ["catalogue", "private economics"]);
});

test("growth scan persists observed inventory signals and a real evidence-backed opportunity", async () => {
  resetCommerceRepositoryForTests();
  resetGrowthRepositoryForTests();
  resetRuntimeStoreForTests();
  const result = await scanGrowth(context);
  assert.equal(result.salesHistory, "INSUFFICIENT_HISTORY");
  assert.ok(result.signals.some((signal) => signal.type === "HIGH_STOCK" && signal.evidence.dataQuality === "OBSERVED"));
  assert.ok(result.opportunities.some((opportunity) => ["BUNDLE", "INVENTORY_RECOVERY"].includes(opportunity.type)));
  assert.ok((await getGrowthRepository().listInventorySnapshots(context)).length >= 6);
});

test("growth play lifecycle always re-evaluates the published policy", async () => {
  resetCommerceRepositoryForTests();
  resetGrowthRepositoryForTests();
  resetRuntimeStoreForTests();
  const result = await scanGrowth(context);
  const opportunity = result.opportunities.find((item) => item.policyCompatibility === "COMPATIBLE");
  assert.ok(opportunity);
  const play = await createGrowthPlay(context, opportunity.id);
  const simulated = await simulateGrowthPlay(context, play.id);
  assert.equal(simulated.result.kind, "SIMULATED");
  const active = await activateGrowthPlay(context, play.id);
  assert.equal(active.status, "ACTIVE");
  assert.equal(active.commercialStrategy.requiresPolicyRuntime, true);
});

test("unsafe 90% growth incentives are blocked by the policy runtime", async () => {
  resetCommerceRepositoryForTests();
  resetGrowthRepositoryForTests();
  const result = await scanGrowth(context);
  const opportunity = result.opportunities.find((item) => item.policyCompatibility === "COMPATIBLE");
  assert.ok(opportunity);
  const play = await createGrowthPlay(context, opportunity.id, { maxIncentiveBps: 9000 });
  await assert.rejects(() => activateGrowthPlay(context, play.id), /policy did not authorize/i);
});

test("eligible growth actions are cart/session scoped and never expose private cost", async () => {
  resetCommerceRepositoryForTests();
  resetGrowthRepositoryForTests();
  resetRuntimeStoreForTests();
  const repository = getCommerceRepository();
  const session = await repository.createSession(context, "customer-haven-repeat");
  const result = await scanGrowth(context);
  const opportunity = result.opportunities.find((item) => item.policyCompatibility === "COMPATIBLE");
  const play = await createGrowthPlay(context, opportunity.id);
  await activateGrowthPlay(context, play.id);
  const eligible = await getEligibleGrowthActions({ context, sessionId: session.id });
  assert.ok(!JSON.stringify(eligible).includes("costPaise"));
  assert.ok(eligible.actions.every((action) => action.requiresPolicyRuntime));
  assert.equal(await getGrowthRepository().getOpportunity({ ...context, organizationId: "other-org" }, opportunity.id), null);
});

test("negotiation frequency is deterministic", () => {
  assert.equal(negotiationAllowed(0, 2), true);
  assert.equal(negotiationAllowed(1, 2), true);
  assert.equal(negotiationAllowed(2, 2), false);
  assert.equal(negotiationAllowed(3, 2), false);
});
