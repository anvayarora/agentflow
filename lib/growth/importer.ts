import * as XLSX from "xlsx";
import type { CanonicalProduct } from "../domain/catalogue";
import type { ImportReport, PrivateEconomicsUpdate } from "./types";

function headerKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+(.)/g, (_, character: string) => character.toUpperCase());
}

function parseMoneyPaise(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isSafeInteger(value) ? Math.round(value * 100) : null;
  const normalized = String(value).replace(/[₹,\s]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isSafeInteger(amount) ? Math.round(amount * 100) : null;
}

function rowsFromInput(input: Buffer | string, filename: string): Array<Record<string, unknown>> {
  const workbook = XLSX.read(input, { type: Buffer.isBuffer(input) ? "buffer" : "string", cellDates: false, raw: true });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheet], { defval: null, raw: true });
  if (!rows.length && filename.toLowerCase().endsWith(".csv")) {
    const csvWorkbook = XLSX.read(input, { type: Buffer.isBuffer(input) ? "buffer" : "string" });
    const csvSheet = csvWorkbook.Sheets[csvWorkbook.SheetNames[0]];
    return csvSheet ? XLSX.utils.sheet_to_json<Record<string, unknown>>(csvSheet, { defval: null, raw: true }) : [];
  }
  return rows;
}

export function parseEconomicsImport(input: Buffer | string, filename: string, catalogue: CanonicalProduct[]): ImportReport {
  const warnings: string[] = [];
  const errors: string[] = [];
  let rows: Array<Record<string, unknown>>;
  try {
    rows = rowsFromInput(input, filename);
  } catch {
    return { rowsParsed: 0, rowsMatched: 0, rowsCreated: 0, rowsUpdated: 0, warnings, errors: ["The uploaded file could not be parsed as CSV or XLSX."], updates: [] };
  }

  const bySku = new Map(catalogue.map((product) => [product.sku.toLowerCase(), product]));
  const byExternalId = new Map(catalogue.filter((product) => product.externalId).map((product) => [product.externalId!.toLowerCase(), product]));
  const seen = new Set<string>();
  const updates: PrivateEconomicsUpdate[] = [];

  rows.forEach((rawRow, index) => {
    const row = Object.fromEntries(Object.entries(rawRow).map(([key, value]) => [headerKey(key), value]));
    const sku = String(row.sku ?? "").trim();
    const shopifyProductId = String(row.shopifyProductId ?? row.productId ?? "").trim();
    const shopifyVariantId = String(row.shopifyVariantId ?? row.variantId ?? "").trim();
    const identity = sku || shopifyProductId || shopifyVariantId;
    if (!identity) {
      errors.push(`Row ${index + 2}: sku, shopifyProductId, or shopifyVariantId is required.`);
      return;
    }
    const product = bySku.get(sku.toLowerCase())
      || (shopifyProductId ? byExternalId.get(shopifyProductId.toLowerCase()) : undefined)
      || (shopifyVariantId ? catalogue.find((candidate) => String(candidate.attributes.variantId ?? "").toLowerCase() === shopifyVariantId.toLowerCase()) : undefined);
    if (!product) {
      errors.push(`Row ${index + 2}: no catalogue product matched ${identity}.`);
      return;
    }
    if (seen.has(product.id)) {
      errors.push(`Row ${index + 2}: duplicate economics row for ${product.sku}.`);
      return;
    }
    seen.add(product.id);
    const currency = String(row.currency ?? "INR").trim().toUpperCase();
    if (currency !== "INR") {
      errors.push(`Row ${index + 2}: only INR economics are supported by the current policy runtime.`);
      return;
    }
    const rawCost = row.cost ?? row.costInr ?? row.privateCost;
    const costPaise = parseMoneyPaise(rawCost);
    if (rawCost !== null && rawCost !== undefined && rawCost !== "" && costPaise === null) {
      errors.push(`Row ${index + 2}: cost must be a non-negative INR amount.`);
      return;
    }
    if (costPaise !== null && costPaise < 0) {
      errors.push(`Row ${index + 2}: cost cannot be negative.`);
      return;
    }
    const privateTags = String(row.privateTags ?? row.tags ?? "").split(/[;,]/).map((tag) => tag.trim()).filter(Boolean);
    const supplier = row.supplier === null || row.supplier === undefined || row.supplier === "" ? null : String(row.supplier).trim();
    updates.push({ productId: product.id, costPaise, brand: row.brand ? String(row.brand).trim() : undefined, category: row.category ? String(row.category).trim() : undefined, supplier, privateTags, externalId: shopifyProductId || undefined });
  });

  if (rows.length === 0) warnings.push("No data rows were found in the uploaded file.");
  return { rowsParsed: rows.length, rowsMatched: updates.length, rowsCreated: 0, rowsUpdated: updates.length, warnings, errors, updates };
}
