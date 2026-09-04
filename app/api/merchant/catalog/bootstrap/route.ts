import { z } from "zod";
import { buildCatalogueImportPreview, columnMappingSchema, parseCatalogueFile } from "../../../../../lib/bootstrap/catalogue";
import { syncCatalogueRows, ShopifyAdminError } from "../../../../../lib/server/shopify/admin-catalogue";
import { createImportRun, getImportRun, listImportRuns, updateImportRun } from "../../../../../lib/server/repositories/bootstrap";
import { getCommerceRepository } from "../../../../../lib/server/repositories/commerce";
import { merchantContextOrResponse } from "../../../../../lib/server/route-guards";
import { consumeRateLimit, rateLimitResponse } from "../../../../../lib/server/rate-limit";

export const runtime = "nodejs";

const confirmSchema = z.object({ importRunId: z.string().min(1).max(255), confirm: z.literal(true) }).strict();

function errorResponse(error: unknown) {
  const status = error instanceof ShopifyAdminError ? error.status || 400 : error instanceof z.ZodError ? 400 : 422;
  return Response.json({ error: error instanceof Error ? error.message : "Catalogue bootstrap failed." }, { status });
}

export async function GET(request: Request) {
  const auth = await merchantContextOrResponse(request, "VIEWER");
  if ("response" in auth) return auth.response;
  try { return Response.json({ runs: await listImportRuns(auth.context) }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  const auth = await merchantContextOrResponse(request, "OPERATOR");
  if ("response" in auth) return auth.response;
  const context = auth.context;
  const limit = await consumeRateLimit("CATALOG_IMPORT", context);
  if (!limit.ok) return rateLimitResponse(limit.retryAfter);
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return Response.json({ error: "Attach a CSV or XLSX file in the file field." }, { status: 400 });
      if (file.size > 10 * 1024 * 1024) return Response.json({ error: "Catalogue files must be 10MB or smaller." }, { status: 413 });
      if (!/\.(csv|xlsx|xls)$/i.test(file.name)) return Response.json({ error: "Only CSV and XLSX catalogue files are supported." }, { status: 400 });
      const supplied = form.get("mappings");
      const mappings = supplied ? columnMappingSchema.parse(JSON.parse(String(supplied))) : undefined;
      const parsed = parseCatalogueFile(Buffer.from(await file.arrayBuffer()), file.name, mappings);
      const preview = buildCatalogueImportPreview(parsed, await getCommerceRepository().listProducts(context));
      const run = await createImportRun(context, { sourceFile: file.name, sourceType: preview.sourceType, mappings: preview.mappings, summary: preview.summary, errors: preview.errors, warnings: preview.warnings, rows: preview.rows });
      await getCommerceRepository().recordAudit(context, { eventType: "CATALOGUE_IMPORT_PREVIEWED", entityType: "import_run", entityId: run.id, metadata: { sourceType: preview.sourceType, rows: preview.rows.length, warnings: preview.warnings.length, errors: preview.errors.length } });
      return Response.json({ importRunId: run.id, status: run.status, ...preview }, { status: preview.errors.length ? 422 : 200 });
    }
    const input = confirmSchema.parse(await request.json());
    const run = await getImportRun(context, input.importRunId);
    if (!run) return Response.json({ error: "Import preview was not found." }, { status: 404 });
    if (run.status !== "PREVIEW") return Response.json({ error: "This import run has already been processed." }, { status: 409 });
    if (run.errors.length) return Response.json({ error: "Resolve preview errors before importing.", errors: run.errors }, { status: 422 });
    await updateImportRun(context, run.id, { status: "IMPORTING" });
    const sync = await syncCatalogueRows(context, run.rows, {});
    const status = sync.errors.length ? (sync.mappings.length ? "PARTIAL" : "FAILED") : "COMPLETED";
    const updated = await updateImportRun(context, run.id, { status, errors: sync.errors.map((entry) => `${entry.sku}: ${entry.message}`), summary: { ...run.summary, productsCreated: sync.productsCreated, productsUpdated: sync.productsUpdated, variants: sync.variants, mappings: sync.mappings.length, inventory: sync.inventory } });
    await getCommerceRepository().recordAudit(context, { eventType: "CATALOGUE_IMPORTED", entityType: "import_run", entityId: run.id, metadata: { status, productsCreated: sync.productsCreated, productsUpdated: sync.productsUpdated, mappings: sync.mappings.length, errors: sync.errors.length } });
    return Response.json({ importRunId: run.id, status: updated?.status || status, sync }, { status: sync.errors.length ? 207 : 200 });
  } catch (error) { return errorResponse(error); }
}
