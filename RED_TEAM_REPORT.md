# AgentFlow Red-Team / Adversarial QA Report

**Date:** 2026-08-21
**Source under test:** `c9e11f3` (`test: harden policy boundaries with red team coverage`)
**Preview:** [agentflow-las9eov7s-anvayarora010-4680s-projects.vercel.app](https://agentflow-las9eov7s-anvayarora010-4680s-projects.vercel.app)
**Scope:** deterministic policy evaluator, current client application, safe deployment smoke checks, and the attack areas in the AgentFlow red-team mandate. No live payment, merchant, customer, or third-party credentials were used.

## Final verdict

**FAIL — do not promote to Production.**

The deterministic policy evaluator is materially safer after this pass: the targeted suite passes 7/7 tests, including 5,000 randomized requests, and the prior negative-discount, negative-quantity, and client-supplied-order-value bypasses are closed. The landing page also builds and serves on Vercel Preview with its referenced static assets.

That is not evidence of production commerce safety. The current repository is a client-rendered demo with one `/` route, local React state, and no server-side policy authority, authentication, payment adapter, webhook verification, database, tenant isolation, or real approval service. A user with browser/developer-tools control can therefore alter the presentation state without crossing a trusted commerce boundary. The prototype is suitable for a buildathon demonstration of the policy concept, but not for real transactions or a production trust claim.

## Executive summary

- Source secret scan: **PASS**. No sensitive artifact filenames or known credential markers were found; `.env.example` is the only environment file and contains names/placeholders only.
- Local quality: **PASS** — `npm test` 2/2, full `node --test tests/*.mjs` 9/9, lint, TypeScript typecheck, database generation, and the Vercel/Nitro build all pass.
- Policy red team: **PASS for implemented evaluator scope** — 7/7 tests, including 5,000 randomized requests.
- Preview HTTP smoke: **PASS for `/` and assets** — root and key CSS/JS/font/favicon assets return 200.
- Route smoke: **FAIL/PARTIAL** — `/login`, `/app`, and `/store` return 404 because these are not route files; their demo surfaces are in the single client page.
- Browser-console and Vercel runtime-log verification: **BLOCKED** by the current Browser/Vercel account scope. No server API routes exist to exercise.
- Dependency audit: **0 known production-tree advisories**; the full install tree has 20 development-tool advisories (1 low, 4 moderate, 15 high). No blind dependency upgrade was applied during this audit.
- Production promotion: **not performed**.

## Confirmed findings

### RT-FND-001 — P0 — No trusted server-side authority or payment boundary

**Attack:** Modify client state or invoke the exported evaluator from the browser, then drive the local “approval,” “checkout,” or transaction presentation.

**Expected:** Every offer, approval, inventory check, amount, and payment call is re-evaluated by a trusted server component before any provider request.

**Observed:** `app/page.tsx` owns the interactive flow in local React state. `lib/policy.ts` is a useful deterministic evaluator, but it is not exposed through a server-authoritative API and no payment SDK or server-side checkout route is present. No real Razorpay request was made during verification.

**Impact:** The UI cannot provide authorization, integrity, replay protection, or payment safety against a hostile browser. This blocks any production claim.

**Required fix:** Move policy evaluation, inventory/version checks, approval grants, canonical amount calculation, idempotency, and payment creation behind authenticated server endpoints. Make the payment adapter accept only a server-issued decision/override token bound to the cart and policy version.

**Regression test required:** Server-side authorization tests that attempt client amount/order-value overrides, stale policy versions, replayed approvals, concurrent inventory updates, and direct payment calls without a valid decision.

### RT-FND-002 — P1 — Demo UI presents provider state as if it were verified

**Attack:** Treat the integrations and transaction views as operational evidence.

**Expected:** Provider status, webhook verification, captured payments, and key metadata reflect actual server/provider state.

**Observed:** The UI contains static/demo claims such as “Key ending ··· 8F2 · webhook verified,” “Captured · Test Mode,” and “Payment Captured · webhook verified,” while the source has no Razorpay SDK, webhook route, or credential configuration.

**Impact:** A reviewer or operator could mistake presentation fixtures for verified payment state.

**Required fix:** Label all fixtures as simulated, or wire them to a real server-backed Test Mode adapter and render only persisted provider responses.

**Regression test required:** UI/API contract tests proving a payment status cannot become `captured` without a verified provider event.

### RT-FND-003 — P1 — Authentication, tenancy, RLS, and object authorization are absent

**Attack:** Access another merchant’s policy, catalogue, approvals, audit events, or transactions by changing an ID or calling a route without a session.

**Expected:** Authenticated identity, tenant scope, object-level authorization, and database row-level security are enforced server-side.

**Observed:** No auth/session implementation, database schema, Supabase integration, server routes, or RLS policies are present. `app/chatgpt-auth.ts` only contains hosting header helpers.

**Impact:** There is no boundary to test or rely on for multi-merchant data protection.

**Required fix:** Implement authenticated server requests, tenant-scoped data access, RLS/object checks, and negative IDOR tests before any shared deployment.

**Regression test required:** Cross-tenant reads/writes, missing-session requests, role changes, and guessed object IDs must all fail closed.

### RT-FND-004 — P1 — HITL, replay, concurrency, inventory, and webhook semantics are presentation-only

**Attack:** Reuse an approval, approve a changed cart, race two checkouts against the same inventory, replay a payment event, or change the amount between approval and capture.

**Expected:** One-time scoped approval, cart hash, policy version, TTL, idempotency key, atomic inventory reservation, and signed webhook state transitions are enforced by a trusted store.

**Observed:** The UI displays these concepts, but no server implementation, persistence, signature verification, or transactional state machine exists.

**Impact:** Double-spend, stale approval, wrong-cart approval, inventory oversell, and payment-state forgery cannot currently be ruled out.

**Required fix:** Implement a server-side commerce state machine with atomic compare-and-set/version checks and provider signature validation.

**Regression test required:** Replay, altered-cart, altered-policy, duplicate-webhook, concurrent-order, expired-approval, and stale-inventory test cases.

### RT-FND-005 — P1 — Built-in “Red Team My Store” is decorative, not an adversarial execution

**Attack:** Run the in-product red-team button and treat `12 / 12 attacks blocked safely` as test evidence.

**Expected:** Each attack is generated, executed through the real policy/tool/payment boundary, persisted with inputs and outputs, and independently verifiable.

**Observed:** The button changes local UI state to a hard-coded successful-looking result. The real evidence is the new Node test suite, not the in-product panel.

**Impact:** The UI can overstate security coverage and does not detect regressions in real integrations.

**Required fix:** Replace the fixture with a server-run, versioned suite whose cases and outcomes are persisted and linked to a deployment/build.

**Regression test required:** Assert the UI result is derived from executed case records and cannot show a pass without all required cases completing.

### RT-FND-006 — P1 — Deployed navigation surface does not match the requested route smoke contract

**Attack:** Request `/login`, `/app`, or `/store` directly, including from a fresh browser session.

**Expected:** The advertised auth, merchant, and storefront surfaces load at stable URLs.

**Observed:** Preview returns 404 for all three paths. The current application renders the demo surfaces within `/` after client interaction.

**Impact:** Deep links, route-level access control, and the requested smoke/E2E flow cannot be verified.

**Required fix:** Add real route boundaries only when product scope calls for them, then add route-level smoke/E2E coverage. Until then, document the demo as a single-page prototype and remove route claims.

**Regression test required:** Preview HTTP tests for `/`, `/login`, `/app`, and `/store`, including direct navigation and refresh.

### RT-FND-007 — P2 — Development dependency advisories remain open

**Attack:** Exploit a vulnerable build/development dependency in a CI or developer environment.

**Expected:** The dependency tree is current or the risk is explicitly accepted and bounded.

**Observed:** `npm audit --omit=dev` reports 0 production-tree advisories. Full `npm audit` reports 20 development-tree advisories: 1 low, 4 moderate, and 15 high, with fixes available for parts of the toolchain.

**Impact:** This is primarily a build/CI risk for the current static demo, but it should be remediated before untrusted build inputs or production tooling are introduced.

**Required fix:** Review and upgrade the affected build toolchain in a separate dependency change, then rerun all builds and audits.

**Regression test required:** CI policy for production and development audit thresholds.

### RT-FND-008 — P2 — GitHub-to-Vercel automatic Preview behavior is not independently verified

**Attack:** Push a branch and assume the linked project will automatically create a Preview.

**Expected:** The private GitHub repository webhook and Vercel project linkage are observable and tested.

**Observed:** A direct Preview deployment succeeded. The authenticated Vercel team scope rejected automatic production creation with a 403 and did not expose the project through the available team APIs, so automatic push-to-Preview behavior is not verified.

**Impact:** Future pushes may not produce the expected deployment until the Vercel role/project scope is corrected.

**Required fix:** Correct Vercel team permissions, confirm the GitHub repository is attached to the intended project, push a harmless branch commit, and verify the resulting Preview URL and commit SHA.

**Regression test required:** CI/deployment check that maps Git commit SHA to a Ready Preview.

### RT-FND-009 — P2 — Browser console and provider runtime logs remain unverified

**Attack:** Rely on HTTP 200 while client-side hydration or runtime errors are hidden.

**Expected:** A real browser session confirms no console errors, failed asset/API requests, or runtime exceptions.

**Observed:** HTTP and asset checks passed. The in-app Browser tool could not open the generated Vercel hostname under its URL policy, and Vercel log APIs could not read the direct personal-scope Preview through the authenticated team scope. No application API routes exist to produce provider runtime logs.

**Impact:** Browser hydration and platform-log evidence is incomplete.

**Required fix:** Re-run browser verification from an allowed browser session and grant the Vercel identity read access to the project/deployment.

**Regression test required:** Automated browser smoke with console/network capture plus a deployment log query.

## Fixes landed in this pass

- `lib/policy.ts` now rejects malformed/non-finite inputs, non-positive prices, negative stock/cost, invalid discounts, and non-positive/non-integer quantities with `DENY`.
- Canonical order value is recomputed from product price, quantity, and discount; the optional client `orderValue` is display context only.
- `tests/policy-red-team.mjs` adds hard-precedence, outcome, money, margin, malformed-input, catalogue-injection, and 5,000-case fuzz coverage.
- The stale starter tests were replaced with current AgentFlow render/source tests.
- Lint/a11y and Cloudflare typecheck issues were fixed without disabling the checks.
- Vercel/Nitro build output is generated successfully; no provider credentials were added.

## Evidence and results

| Check | Result | Evidence |
|---|---|---|
| Secret/artifact scan | PASS | No sensitive filenames or known credential markers; `.env.example` only |
| Policy red-team | PASS | 7/7 tests; 5,000 randomized cases |
| Project tests | PASS | `npm test`; 2/2 rendered tests |
| Full test glob | PASS | 9/9 tests |
| Lint | PASS | `npm run lint` |
| TypeScript | PASS | `tsc --noEmit` |
| DB generation | PASS | No schema changes |
| Local build | PASS | `npm test` build phase |
| Vercel build | PASS | `VERCEL=1 NITRO_PRESET=vercel npm run build` |
| Runtime dependency audit | PASS | `npm audit --omit=dev`: 0 advisories |
| Full dependency audit | REVIEW | 20 dev-tool advisories: 1 low, 4 moderate, 15 high |
| Preview `/` | PASS | HTTP 200, AgentFlow/Haven Home HTML |
| Preview static assets | PASS | CSS, JS, favicon, and font assets HTTP 200 |
| Preview `/login`, `/app`, `/store` | FAIL | HTTP 404; routes do not exist |
| Browser console | BLOCKED | Browser tool URL policy prevented opening generated Preview hostname |
| Vercel runtime logs | BLOCKED | Direct Preview is not readable through current team API scope |

## Coverage matrix

Status meanings: **PASS** means tested within the implemented local scope; **PARTIAL** means only a limited/static slice exists; **NOT IMPLEMENTED** means no trusted surface exists to test; **BLOCKED** means the check requires unavailable deployment/browser access.

| # | Mandate area | Status | Notes |
|---:|---|---|---|
| 1 | Trusted authority boundary | NOT IMPLEMENTED | No server policy/payment boundary |
| 2 | Hard restriction precedence | PASS | Deterministic evaluator test |
| 3 | Decision outcome determinism | PASS | ALLOW/COUNTER/ESCALATE/DENY |
| 4 | Numeric/input domain validation | PASS | Fail-closed boundary tests |
| 5 | Canonical money calculation | PASS | Client order value ignored |
| 6 | Margin floor exact boundary | PASS | Exact floor and below-floor cases |
| 7 | Missing cost handling | PASS | Escalates for human review |
| 8 | Low-stock safety | PASS | Denies discounting below threshold |
| 9 | Direct prompt-injection proposal | PASS | Untrusted proposal is denied |
| 10 | Indirect catalogue-text injection | PASS | Text cannot change evaluator outcome |
| 11 | Product identity/SKU anti-hallucination | NOT IMPLEMENTED | No server catalogue authority |
| 12 | Inventory reservation/race safety | NOT IMPLEMENTED | No transactional inventory store |
| 13 | Stale price/policy version | NOT IMPLEMENTED | No persisted version check |
| 14 | Cart hash binding | NOT IMPLEMENTED | No cart token/state |
| 15 | Replay/idempotency | NOT IMPLEMENTED | No idempotency store |
| 16 | Concurrent approval/checkout | NOT IMPLEMENTED | No server state machine |
| 17 | Scoped human override | NOT IMPLEMENTED | UI text only |
| 18 | Override expiry/single use | NOT IMPLEMENTED | No signed/consumed token |
| 19 | Approval audit integrity | NOT IMPLEMENTED | No append-only backend |
| 20 | Authoritative payment amount | NOT IMPLEMENTED | No payment route/adapter |
| 21 | Razorpay signature/webhook verification | NOT IMPLEMENTED | No Razorpay integration |
| 22 | Razorpay Test/Live separation | PARTIAL | Presentation labels only |
| 23 | MCP tool allowlist/approval | NOT IMPLEMENTED | No MCP tools |
| 24 | Shopify/UCP connector safety | NOT IMPLEMENTED | Not connected |
| 25 | WooCommerce connector safety | NOT IMPLEMENTED | Not connected |
| 26 | External connector auth/SSRF | NOT IMPLEMENTED | No external fetch surface |
| 27 | Setup Copilot clarification safety | PARTIAL | Static seeded conversation/UI |
| 28 | Policy compiler/parser/type checker | PARTIAL | Static policy object; no compiler service |
| 29 | Policy immutability/version diff | NOT IMPLEMENTED | No persisted policy versions |
| 30 | Authentication/session security | NOT IMPLEMENTED | No application auth |
| 31 | Tenant isolation/RLS | NOT IMPLEMENTED | No database/RLS |
| 32 | IDOR/object authorization | NOT IMPLEMENTED | No object API |
| 33 | XSS/rendering sinks | PASS | No dangerous HTML sink found; React escapes text |
| 34 | Secret handling | PASS | Scan and ignore rules clean |
| 35 | Audit integrity | PARTIAL | Local presentation timeline only |
| 36 | Explanation fidelity | PARTIAL | Evaluator explanations tested; no persisted trace |
| 37 | Storefront deep-link navigation | NOT IMPLEMENTED | `/store` returns 404 |
| 38 | Real red-team/simulation execution | NOT IMPLEMENTED | In-product panel is decorative |
| 39 | DoS/rate/resource limits | NOT IMPLEMENTED | No API/service boundary |
| 40 | E2E/browser/observability | BLOCKED | HTTP pass; browser/log access unavailable |

## Recommended release gates

Before `red-team → E2E → Production promotion`, complete the following in a server-backed branch:

1. Implement authenticated, tenant-scoped server APIs and persist policies, catalogues, approvals, carts, inventory, payments, and audit events.
2. Make the server the sole authority for canonical price/amount, margin, stock, policy version, cart hash, approval scope, idempotency, and webhook state transitions.
3. Add Razorpay Test Mode only after signature verification and amount-binding tests pass; keep live mode unavailable by configuration and code path.
4. Replace static integration/payment/red-team claims with provider-backed or clearly labelled simulated states.
5. Add route-level E2E for `/login`, `/app`, `/store`, browser console/network capture, and runtime log verification.
6. Add auth/RLS/IDOR, prompt/indirect injection, connector/SSRF, replay/concurrency, fuzz, and DoS coverage at the service boundary.
7. Resolve or explicitly accept the 20 development-tool advisories and repeat the full audit.
8. Fix Vercel team permissions and verify Git commit → Preview automation.

## Trust assessment

Would a Razorpay engineer trust this prototype for a **buildathon demo of the deterministic policy idea**? **Yes, with the demo-only label and the evaluator evidence above.**

Would they trust it to authorize or capture real commerce? **No.** The missing server authority, auth, payment/webhook implementation, persistence, and concurrency controls are release-blocking. Production promotion remains intentionally withheld.
