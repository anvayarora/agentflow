import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the AgentFlow landing surface", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>AgentFlow — Commerce that explains itself<\/title>/i);
  assert.match(html, /Make your store ready for AI buyers/i);
  assert.match(html, /Haven Home/i);
  assert.match(html, /Razorpay Test Mode/i);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton|codex-preview/i);
});

test("the source is the AgentFlow product rather than the starter placeholder", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Launch interactive demo/);
  assert.match(page, /Test policy safety/);
  assert.match(page, /evaluateCommerceAction/);
  assert.match(layout, /AgentFlow — Commerce that explains itself/);
  assert.match(packageJson, /"vinext": "1\.0\.0-beta\.2"/);
  assert.match(packageJson, /"nitro":/);
  assert.deepEqual(await readdir(new URL("app/_sites-preview", templateRoot)), []);
});
