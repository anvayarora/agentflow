import test from "node:test";
import assert from "node:assert/strict";
import { parseCatalogueFile, buildCatalogueImportPreview } from "../lib/bootstrap/catalogue.ts";
import { storefrontUiSurfaceSchema, uiActionFromClient, projectStorefrontUi } from "../lib/ai/storefront/ui.ts";
import { resetBootstrapRepositoryForTests, createImportRun, getImportRun } from "../lib/server/repositories/bootstrap.ts";
import { shopifyPublicError } from "../lib/server/shopify/public-error.ts";

const context = { organizationId: "prompt4-test-org", actorType: "merchant", actorId: "test", correlationId: "prompt4-correlation" };

test("catalogue bootstrap parses CSV and preserves private cost as merchant data", () => {
  const parsed = parseCatalogueFile("SKU,Product Name,MRP,Purchase Cost,Qty,Material,Photo URL\nDESK-1,Walnut Desk,13499,9280,12,Walnut,https://example.com/desk.jpg\n", "catalogue.csv");
  assert.equal(parsed.sourceType, "CSV");
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rows[0].pricePaise, 1_349_900);
  assert.equal(parsed.rows[0].costPaise, 928_000);
  assert.equal(parsed.rows[0].inventory, 12);
  assert.equal(parsed.mappings["Purchase Cost"], "costPaise");
});

test("catalogue preview distinguishes new, unchanged, duplicate and missing economics rows", () => {
  const parsed = parseCatalogueFile("sku,title,price,inventory\nDESK-1,Walnut Desk,13499,12\nDESK-1,Walnut Desk,13499,12\nNEW-1,New Desk,12000,4\n", "catalogue.csv");
  const preview = buildCatalogueImportPreview(parsed, [{ id: "p1", organizationId: context.organizationId, externalId: null, sku: "DESK-1", name: "Walnut Desk", description: "", category: "Uncategorised", brand: null, currency: "INR", listPricePaise: 1_349_900, costPaise: null, stock: 12, attributes: {}, tags: [], imageUrl: null, source: "demo", sourceUpdatedAt: null }]);
  assert.equal(preview.summary.newProducts, 1);
  assert.equal(preview.summary.existingProducts, 2);
  assert.equal(preview.summary.duplicateSku, 1);
  assert.equal(preview.summary.missingCost, 3);
});

test("import previews are tenant-scoped and UI surfaces reject arbitrary payloads", async () => {
  resetBootstrapRepositoryForTests();
  const run = await createImportRun(context, { sourceFile: "test.csv", sourceType: "CSV", mappings: {}, summary: { productsFound: 0, variantsFound: 0, newProducts: 0, existingProducts: 0, updatedProducts: 0, unchangedProducts: 0, missingImage: 0, missingCost: 0, duplicateSku: 0, invalidInventory: 0, unknownCategory: 0, conflictingVariants: 0 }, errors: [], warnings: [], rows: [] });
  assert.ok(await getImportRun(context, run.id));
  assert.equal(await getImportRun({ ...context, organizationId: "other-org" }, run.id), null);
  assert.throws(() => uiActionFromClient({ type: "SHOW_HTML", html: "<script>" }));
  const surface = projectStorefrontUi({ message: "Here are your options", products: [{ id: "p1", name: "Desk" }, { id: "p2", name: "Lamp" }] });
  assert.equal(surface.type, "PRODUCT_GRID");
  assert.equal(storefrontUiSurfaceSchema.parse(surface).type, "PRODUCT_GRID");
});

test("shopper-facing Shopify errors never expose adapter or database details", () => {
  const response = shopifyPublicError(new Error('select organization_id from integrations where appProxyPath = "/apps/agentflow"'), "The shopping assistant is temporarily unavailable.");
  assert.equal(response.error, "The shopping assistant is temporarily unavailable.");
  assert.equal(response.code, "SHOPIFY_REQUEST_FAILED");
});
