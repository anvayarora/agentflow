import { getCommerceRepository } from "../server/repositories/commerce";
import type { TrustedRequestContext } from "../server/context";
import { getGrowthRepository } from "../server/repositories/growth";
import { parseEconomicsImport } from "./importer";
import type { ImportReport } from "./types";

export async function importPrivateEconomics(context: TrustedRequestContext, input: { bytes: Buffer; filename: string }): Promise<Omit<ImportReport, "updates">> {
  const commerce = getCommerceRepository();
  const parsed = parseEconomicsImport(input.bytes, input.filename, await commerce.listProducts(context));
  let rowsUpdated = 0;
  if (parsed.errors.length === 0) {
    for (const update of parsed.updates) {
      const result = await getGrowthRepository().updateProductEconomics(context, update.productId, update);
      if (result) rowsUpdated += 1;
    }
  }
  await commerce.recordAudit(context, { eventType: "PRIVATE_ECONOMICS_IMPORTED", entityType: "product_economics", entityId: context.organizationId, metadata: { rowsParsed: parsed.rowsParsed, rowsMatched: parsed.rowsMatched, rowsUpdated, errors: parsed.errors.length, warnings: parsed.warnings.length } });
  return { rowsParsed: parsed.rowsParsed, rowsMatched: parsed.rowsMatched, rowsCreated: 0, rowsUpdated, warnings: parsed.warnings, errors: parsed.errors };
}
