import * as XLSX from "xlsx";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { CanonicalProduct } from "../domain/catalogue";

/** The deliberately small, reviewable import contract used by Store Bootstrap. */
export const catalogueImportRowSchema = z.object({
  sku: z.string().trim().min(1).max(160),
  productName: z.string().trim().min(1).max(240),
  description: z.string().trim().max(10_000).default(""),
  category: z.string().trim().max(120).default("Uncategorised"),
  brand: z.string().trim().max(120).nullable().default(null),
  pricePaise: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  costPaise: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().default(null),
  inventory: z.number().int().nonnegative().max(2_147_483_647).default(0),
  colour: z.string().trim().max(120).nullable().default(null),
  material: z.string().trim().max(120).nullable().default(null),
  dimensions: z.string().trim().max(240).nullable().default(null),
  variant: z.string().trim().max(240).nullable().default(null),
  imageUrl: z.string().url().max(2_048).nullable().default(null),
  collection: z.string().trim().max(160).nullable().default(null),
  internalTags: z.array(z.string().trim().max(80)).max(30).default([]),
  supplier: z.string().trim().max(160).nullable().default(null),
  externalId: z.string().trim().max(255).nullable().default(null),
}).strict();

export type CatalogueImportRow = z.infer<typeof catalogueImportRowSchema>;
export const catalogueImportFields = ["sku", "productName", "description", "category", "brand", "pricePaise", "costPaise", "inventory", "colour", "material", "dimensions", "variant", "imageUrl", "collection", "internalTags", "supplier", "externalId"] as const;
export type CatalogueImportField = (typeof catalogueImportFields)[number];

export const columnMappingSchema = z.record(z.string().min(1).max(160), z.enum(catalogueImportFields));
export type ColumnMapping = z.infer<typeof columnMappingSchema>;

export type ColumnMappingProposal = { mappings: ColumnMapping; unmappedColumns: string[]; requiresReview: boolean; source: "deterministic" | "nim" };

export type CatalogueImportPreview = {
  rows: CatalogueImportRow[];
  mappings: ColumnMapping;
  mappingProposal: Pick<ColumnMappingProposal, "unmappedColumns" | "requiresReview" | "source">;
  sourceType: "CSV" | "XLSX";
  summary: {
    productsFound: number;
    variantsFound: number;
    newProducts: number;
    existingProducts: number;
    updatedProducts: number;
    unchangedProducts: number;
    missingImage: number;
    missingCost: number;
    duplicateSku: number;
    invalidInventory: number;
    unknownCategory: number;
    conflictingVariants: number;
  };
  warnings: string[];
  errors: string[];
};

function normaliseHeader(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseMoneyPaise(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
  const clean = String(value).replace(/[₹,\s]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(clean)) return null;
  const amount = Number(clean);
  return Number.isSafeInteger(Math.round(amount * 100)) ? Math.round(amount * 100) : null;
}

function parseInventory(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return 0;
  const number = typeof value === "number" ? value : Number(String(value).replace(/[,\s]/g, ""));
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  return String(value).trim();
}

const aliases: Record<CatalogueImportField, string[]> = {
  sku: ["sku", "variant sku", "stock keeping unit", "item code", "product code"],
  productName: ["product name", "product", "title", "name", "item name"],
  description: ["description", "product description", "details"],
  category: ["category", "product type", "type", "department"],
  brand: ["brand", "vendor", "maker"],
  pricePaise: ["price", "selling price", "sale price", "mrp", "retail price", "selling price inr"],
  costPaise: ["cost", "purchase cost", "purchase price", "private cost", "cost price", "landed cost"],
  inventory: ["inventory", "quantity", "qty", "stock", "available", "inventory quantity"],
  colour: ["colour", "color", "colour name", "color name"],
  material: ["material", "wood type", "finish", "fabric"],
  dimensions: ["dimensions", "dimension", "size", "measurements"],
  variant: ["variant", "variant name", "option", "option value"],
  imageUrl: ["image url", "image", "photo url", "product image", "media url"],
  collection: ["collection", "collections", "category collection"],
  internalTags: ["internal tags", "private tags", "tags", "merchant tags"],
  supplier: ["supplier", "supplier name", "vendor name"],
  externalId: ["external id", "shopify product id", "product id", "shopify gid"],
};

export function detectColumnMappings(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const header of headers) {
    const key = normaliseHeader(header);
    const match = (catalogueImportFields as readonly string[]).find((field) => aliases[field as CatalogueImportField].some((alias) => normaliseHeader(alias) === key));
    if (match) mapping[header] = match as CatalogueImportField;
  }
  return columnMappingSchema.parse(mapping);
}

/**
 * Normalises a proposed mapping before the merchant sees it. A future NIM
 * proposal can be passed as `candidate`; it is always schema-checked and never
 * applied implicitly. Unknown columns remain visible for merchant review.
 */
export function proposeColumnMappings(headers: string[], candidate?: unknown): ColumnMappingProposal {
  const detected = detectColumnMappings(headers);
  const parsed = candidate === undefined ? null : columnMappingSchema.safeParse(candidate);
  const mappings = parsed?.success ? parsed.data : detected;
  const unmappedColumns = headers.filter((header) => !mappings[header]);
  const required: CatalogueImportField[] = ["sku", "productName", "pricePaise"];
  const hasRequired = required.every((field) => Object.values(mappings).includes(field));
  return { mappings, unmappedColumns, requiresReview: Boolean(unmappedColumns.length || !hasRequired || (candidate !== undefined && !parsed?.success)), source: candidate === undefined ? "deterministic" : "nim" };
}

function rowsFromFile(input: Buffer | string, filename: string): { rows: Array<Record<string, unknown>>; sourceType: "CSV" | "XLSX" } {
  const sourceType = filename.toLowerCase().endsWith(".csv") ? "CSV" : "XLSX";
  const workbook = XLSX.read(input, { type: Buffer.isBuffer(input) ? "buffer" : "string", raw: true, cellDates: false });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return { rows: [], sourceType };
  return { rows: XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheet], { defval: null, raw: true }), sourceType };
}

export function parseCatalogueFile(input: Buffer | string, filename: string, suppliedMappings?: ColumnMapping): { rows: CatalogueImportRow[]; mappings: ColumnMapping; mappingProposal: Pick<ColumnMappingProposal, "unmappedColumns" | "requiresReview" | "source">; sourceType: "CSV" | "XLSX"; errors: string[]; warnings: string[] } {
  let parsed: { rows: Array<Record<string, unknown>>; sourceType: "CSV" | "XLSX" };
  try { parsed = rowsFromFile(input, filename); } catch { return { rows: [], mappings: {}, mappingProposal: { unmappedColumns: [], requiresReview: true, source: "deterministic" }, sourceType: filename.toLowerCase().endsWith(".csv") ? "CSV" : "XLSX", errors: ["The uploaded file could not be parsed as CSV or XLSX."], warnings: [] }; }
  const headers = parsed.rows[0] ? Object.keys(parsed.rows[0]) : [];
  const proposal = proposeColumnMappings(headers, suppliedMappings);
  const mappings = proposal.mappings;
  const reverse = new Map(Object.entries(mappings).map(([source, destination]) => [destination, source]));
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!reverse.has("sku")) errors.push("A SKU column is required.");
  if (!reverse.has("productName")) errors.push("A product name/title column is required.");
  if (!reverse.has("pricePaise")) errors.push("A public price column is required.");
  const rows: CatalogueImportRow[] = [];
  parsed.rows.forEach((raw, index) => {
    const value = (field: CatalogueImportField) => reverse.has(field) ? raw[reverse.get(field)!] : undefined;
    const price = parseMoneyPaise(value("pricePaise"));
    const inventory = parseInventory(value("inventory"));
    const rawSku = text(value("sku"));
    const rawName = text(value("productName"));
    if (!rawSku || !rawName || price === null) { errors.push(`Row ${index + 2}: SKU, product name, and a valid public price are required.`); return; }
    if (inventory === null) { errors.push(`Row ${index + 2}: inventory must be a non-negative whole number.`); return; }
    const rawTags = text(value("internalTags"));
    const parsedRow = catalogueImportRowSchema.safeParse({
      sku: rawSku,
      productName: rawName,
      description: text(value("description")) || "",
      category: text(value("category")) || "Uncategorised",
      brand: text(value("brand")),
      pricePaise: price,
      costPaise: parseMoneyPaise(value("costPaise")),
      inventory,
      colour: text(value("colour")),
      material: text(value("material")),
      dimensions: text(value("dimensions")),
      variant: text(value("variant")),
      imageUrl: text(value("imageUrl")),
      collection: text(value("collection")),
      internalTags: rawTags ? rawTags.split(/[;,]/).map((tag) => tag.trim()).filter(Boolean) : [],
      supplier: text(value("supplier")),
      externalId: text(value("externalId")),
    });
    if (!parsedRow.success) { errors.push(`Row ${index + 2}: one or more catalogue fields are invalid.`); return; }
    rows.push(parsedRow.data);
  });
  if (!rows.length && !errors.length) warnings.push("No data rows were found in the uploaded file.");
  return { rows, mappings, mappingProposal: { unmappedColumns: proposal.unmappedColumns, requiresReview: proposal.requiresReview, source: proposal.source }, sourceType: parsed.sourceType, errors, warnings };
}

function rowHash(row: CatalogueImportRow) { return createHash("sha256").update(JSON.stringify(row)).digest("hex"); }

export function buildCatalogueImportPreview(input: ReturnType<typeof parseCatalogueFile>, existing: CanonicalProduct[]): CatalogueImportPreview {
  const bySku = new Map(existing.map((product) => [product.sku.toLowerCase(), product]));
  const seen = new Set<string>();
  let newProducts = 0; let existingProducts = 0; let updatedProducts = 0; let unchangedProducts = 0; let missingImage = 0; let missingCost = 0; let duplicateSku = 0; let unknownCategory = 0; let conflictingVariants = 0;
  const categories = new Set(existing.map((product) => product.category.toLowerCase()));
  for (const row of input.rows) {
    const normalizedSku = row.sku.toLowerCase();
    if (seen.has(normalizedSku)) duplicateSku += 1;
    seen.add(normalizedSku);
    const current = bySku.get(normalizedSku);
    if (!current) newProducts += 1;
    else {
      existingProducts += 1;
      const currentHash = rowHash({ sku: current.sku, productName: current.name, description: current.description, category: current.category, brand: current.brand, pricePaise: current.listPricePaise, costPaise: current.costPaise, inventory: current.stock, colour: text(current.attributes.colour), material: text(current.attributes.material), dimensions: text(current.attributes.dimensions), variant: text(current.attributes.variant), imageUrl: current.imageUrl, collection: text(current.attributes.collection), internalTags: current.tags, supplier: text(current.attributes.supplier), externalId: current.externalId });
      if (currentHash === rowHash(row)) unchangedProducts += 1; else updatedProducts += 1;
    }
    if (!row.imageUrl) missingImage += 1;
    if (row.costPaise === null) missingCost += 1;
    if (row.category !== "Uncategorised" && !categories.has(row.category.toLowerCase())) unknownCategory += 1;
  }
  const byProduct = new Map<string, Set<string>>();
  for (const row of input.rows) { const key = row.productName.toLowerCase(); const variants = byProduct.get(key) || new Set<string>(); if (row.variant) variants.add(row.variant.toLowerCase()); byProduct.set(key, variants); }
  conflictingVariants = [...byProduct.values()].filter((variants) => variants.size > 1).length;
  const warnings = [...input.warnings];
  if (duplicateSku) warnings.push(`${duplicateSku} duplicate SKU row${duplicateSku === 1 ? "" : "s"} detected.`);
  if (missingCost) warnings.push(`${missingCost} row${missingCost === 1 ? " is" : "s are"} missing private cost; margin-constrained actions will fail safe.`);
  if (missingImage) warnings.push(`${missingImage} row${missingImage === 1 ? " is" : "s are"} missing an image URL.`);
  if (unknownCategory) warnings.push(`${unknownCategory} row${unknownCategory === 1 ? " uses" : " use"} a category not present in the current catalogue.`);
  return { rows: input.rows, mappings: input.mappings, mappingProposal: input.mappingProposal, sourceType: input.sourceType, summary: { productsFound: input.rows.length, variantsFound: new Set(input.rows.map((row) => `${row.sku}:${row.variant || "default"}`)).size, newProducts, existingProducts, updatedProducts, unchangedProducts, missingImage, missingCost, duplicateSku, invalidInventory: 0, unknownCategory, conflictingVariants }, warnings, errors: input.errors };
}
