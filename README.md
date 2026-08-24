# AgentFlow

AgentFlow is a TypeScript/React commerce control plane. Merchants describe how they do business; a typed policy proposal is validated, versioned, and published; deterministic server code then authorizes each commercial action.

The trust boundary is:

```text
Merchant intent → Policy IR → Validator → Published version
               → server runtime → ALLOW / COUNTER / ESCALATE / DENY
```

The browser never supplies policy authority, product cost, canonical stock, or customer segment. The customer surface sends only a session, product, quantity, and offer proposal.

## Local development

```bash
npm install
npm run dev
npm run build
npm run test:backend
```

PostgreSQL is the persistent store when `DATABASE_URL` is configured:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

When no database is configured, local Preview uses the same domain IR and evaluator against a deterministic seeded in-memory repository. This is a development fallback only; deployed persistent state requires PostgreSQL.

## Backend boundaries

- `db/schema.ts` and `drizzle/` define PostgreSQL state and migrations.
- `lib/policy/` contains the typed IR, validator, compiler, precedence, evaluator, explanations, and graph projection.
- `lib/server/repositories/commerce.ts` applies organization ownership constraints to every read and write.
- NIM can propose a draft IR. It cannot publish or authorize a commerce action.
- Customer segment is derived from persisted order history (`orderCount > 0` means repeat).
- Money is stored and evaluated as integer paise; percentages use basis points.

Keep real values in ignored `.env.local` or the deployment secret store. `.env.example` contains names and safe defaults only.
