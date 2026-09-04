import { importPrivateEconomics } from "../../../../../lib/growth/import-service";
import { merchantContextOrResponse } from "../../../../../lib/server/route-guards";
import { consumeRateLimit, rateLimitResponse } from "../../../../../lib/server/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await merchantContextOrResponse(request, "OPERATOR");
  if ("response" in auth) return auth.response;
  const limit = await consumeRateLimit("CATALOG_IMPORT", auth.context);
  if (!limit.ok) return rateLimitResponse(limit.retryAfter);
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Attach a CSV or XLSX file in the file field." }, { status: 400 });
    const filename = file.name || "economics.csv";
    if (!/\.(csv|xlsx|xls)$/i.test(filename)) return Response.json({ error: "Only CSV and XLSX economics files are supported." }, { status: 400 });
    const report = await importPrivateEconomics(auth.context, { bytes: Buffer.from(await file.arrayBuffer()), filename });
    return Response.json(report, { status: report.errors.length ? 422 : 200 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to import private economics." }, { status: 400 });
  }
}
