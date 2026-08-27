import { getTrustedRequestContext } from "../../../../../lib/server/context";
import { importPrivateEconomics } from "../../../../../lib/growth/import-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Attach a CSV or XLSX file in the file field." }, { status: 400 });
    const filename = file.name || "economics.csv";
    if (!/\.(csv|xlsx|xls)$/i.test(filename)) return Response.json({ error: "Only CSV and XLSX economics files are supported." }, { status: 400 });
    const report = await importPrivateEconomics(getTrustedRequestContext(request), { bytes: Buffer.from(await file.arrayBuffer()), filename });
    return Response.json(report, { status: report.errors.length ? 422 : 200 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to import private economics." }, { status: 400 });
  }
}
