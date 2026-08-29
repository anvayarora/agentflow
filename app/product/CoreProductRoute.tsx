import CoreProductApp from "./CoreProductApp";
import { loadCoreProductData } from "./core-product-data";

export const dynamic = "force-dynamic";

export default async function CoreProductRoute({ initialPath = "/app/overview" }: { initialPath?: string }) {
  const data = await loadCoreProductData();
  return <CoreProductApp initialPath={initialPath} data={data} />;
}
