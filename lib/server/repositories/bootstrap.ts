import { and, desc, eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "../../../db";
import { importRuns, productMappings } from "../../../db/schema";
import type { TrustedRequestContext } from "../context";
import type { CatalogueImportPreview } from "../../bootstrap/catalogue";

export type ImportRunStatus = "PREVIEW" | "IMPORTING" | "COMPLETED" | "PARTIAL" | "FAILED";
export type ImportRun = { id: string; organizationId: string; sourceFile: string; sourceType: "CSV" | "XLSX"; status: ImportRunStatus; mappings: Record<string, string>; summary: CatalogueImportPreview["summary"] & Record<string, unknown>; errors: string[]; warnings: string[]; rows: CatalogueImportPreview["rows"]; createdAt: string; updatedAt: string };
export type ProductMapping = { id: string; organizationId: string; productId: string; shopDomain: string; shopifyProductGid: string; shopifyVariantGid?: string | null; sku: string; source: string; lastSyncedAt: string };

const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const memoryRuns = new Map<string, ImportRun>();
const memoryMappings = new Map<string, ProductMapping>();

function mapRun(row: typeof importRuns.$inferSelect): ImportRun {
  return { id: row.id, organizationId: row.organizationId, sourceFile: row.sourceFile, sourceType: row.sourceType as "CSV" | "XLSX", status: row.status as ImportRunStatus, mappings: row.mappings, summary: row.summary as ImportRun["summary"], errors: row.errors, warnings: row.warnings, rows: row.rows as ImportRun["rows"], createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export async function createImportRun(context: TrustedRequestContext, input: Pick<ImportRun, "sourceFile" | "sourceType" | "mappings" | "summary" | "errors" | "warnings" | "rows">): Promise<ImportRun> {
  const run: ImportRun = { id: id("import"), organizationId: context.organizationId, status: "PREVIEW", ...input, createdAt: now(), updatedAt: now() };
  if (!isDatabaseConfigured()) { memoryRuns.set(run.id, run); return run; }
  await getDb().insert(importRuns).values({ id: run.id, organizationId: run.organizationId, sourceFile: run.sourceFile, sourceType: run.sourceType, status: run.status, mappings: run.mappings, summary: run.summary, errors: run.errors, warnings: run.warnings, rows: run.rows });
  return run;
}

export async function getImportRun(context: TrustedRequestContext, runId: string): Promise<ImportRun | null> {
  if (!isDatabaseConfigured()) { const run = memoryRuns.get(runId); if (!run || run.organizationId !== context.organizationId) return null; return run; }
  const rows = await getDb().select().from(importRuns).where(and(eq(importRuns.organizationId, context.organizationId), eq(importRuns.id, runId))).limit(1);
  return rows[0] ? mapRun(rows[0]) : null;
}

export async function updateImportRun(context: TrustedRequestContext, runId: string, update: Partial<Pick<ImportRun, "status" | "summary" | "errors" | "warnings">>): Promise<ImportRun | null> {
  const current = await getImportRun(context, runId); if (!current) return null;
  const next = { ...current, ...update, updatedAt: now() };
  if (!isDatabaseConfigured()) { memoryRuns.set(runId, next); return next; }
  await getDb().update(importRuns).set({ ...(update.status ? { status: update.status } : {}), ...(update.summary ? { summary: update.summary } : {}), ...(update.errors ? { errors: update.errors } : {}), ...(update.warnings ? { warnings: update.warnings } : {}), updatedAt: new Date(next.updatedAt) }).where(and(eq(importRuns.organizationId, context.organizationId), eq(importRuns.id, runId)));
  return next;
}

export async function listImportRuns(context: TrustedRequestContext, limit = 20): Promise<ImportRun[]> {
  if (!isDatabaseConfigured()) return [...memoryRuns.values()].filter((run) => run.organizationId === context.organizationId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  const rows = await getDb().select().from(importRuns).where(eq(importRuns.organizationId, context.organizationId)).orderBy(desc(importRuns.updatedAt)).limit(Math.min(limit, 50));
  return rows.map(mapRun);
}

export async function upsertProductMapping(context: TrustedRequestContext, input: Omit<ProductMapping, "id" | "organizationId" | "lastSyncedAt"> & { id?: string; lastSyncedAt?: string }): Promise<ProductMapping> {
  const mapping: ProductMapping = { id: input.id || id("mapping"), organizationId: context.organizationId, productId: input.productId, shopDomain: input.shopDomain, shopifyProductGid: input.shopifyProductGid, shopifyVariantGid: input.shopifyVariantGid ?? null, sku: input.sku, source: input.source, lastSyncedAt: input.lastSyncedAt || now() };
  if (!isDatabaseConfigured()) { memoryMappings.set(`${context.organizationId}:${mapping.shopDomain}:${mapping.sku}`, mapping); return mapping; }
  await getDb().insert(productMappings).values({ id: mapping.id, organizationId: mapping.organizationId, productId: mapping.productId, shopDomain: mapping.shopDomain, shopifyProductGid: mapping.shopifyProductGid, shopifyVariantGid: mapping.shopifyVariantGid, sku: mapping.sku, source: mapping.source, lastSyncedAt: new Date(mapping.lastSyncedAt) }).onConflictDoUpdate({ target: [productMappings.organizationId, productMappings.shopDomain, productMappings.sku], set: { productId: mapping.productId, shopifyProductGid: mapping.shopifyProductGid, shopifyVariantGid: mapping.shopifyVariantGid, source: mapping.source, lastSyncedAt: new Date(mapping.lastSyncedAt), updatedAt: new Date() } });
  return mapping;
}

export async function listProductMappings(context: TrustedRequestContext, shopDomain?: string): Promise<ProductMapping[]> {
  if (!isDatabaseConfigured()) return [...memoryMappings.values()].filter((mapping) => mapping.organizationId === context.organizationId && (!shopDomain || mapping.shopDomain === shopDomain));
  const query = shopDomain ? and(eq(productMappings.organizationId, context.organizationId), eq(productMappings.shopDomain, shopDomain)) : eq(productMappings.organizationId, context.organizationId);
  const rows = await getDb().select().from(productMappings).where(query).orderBy(desc(productMappings.updatedAt));
  return rows.map((row) => ({ id: row.id, organizationId: row.organizationId, productId: row.productId, shopDomain: row.shopDomain, shopifyProductGid: row.shopifyProductGid, shopifyVariantGid: row.shopifyVariantGid, sku: row.sku, source: row.source, lastSyncedAt: row.lastSyncedAt.toISOString() }));
}

export function resetBootstrapRepositoryForTests() { memoryRuns.clear(); memoryMappings.clear(); }
