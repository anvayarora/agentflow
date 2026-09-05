import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "../../../db";
import { runtimeRecords } from "../../../db/schema";
import type { TrustedRequestContext } from "../context";

export const runtimeKinds = {
  shopperPreferences: "SHOPPER_PREFERENCES",
  offer: "OFFER",
  approval: "APPROVAL",
  override: "SCOPED_OVERRIDE",
  transaction: "TRANSACTION",
  payment: "PAYMENT",
  webhook: "PAYMENT_WEBHOOK",
  agentTurn: "AGENT_TURN",
  simulation: "SIMULATION",
  shortlist: "SHOPPER_SHORTLIST",
  pageContext: "SHOPPER_PAGE_CONTEXT",
  conversation: "SHOPPER_CONVERSATION",
  resultSet: "SHOPPER_RESULT_SET",
  reconciliation: "PAYMENT_RECONCILIATION",
} as const;

export type RuntimeKind = (typeof runtimeKinds)[keyof typeof runtimeKinds];

export type RuntimeRecord<T extends Record<string, unknown> = Record<string, unknown>> = {
  id: string;
  organizationId: string;
  kind: RuntimeKind;
  status: string;
  payload: T;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

type MemoryState = Map<string, RuntimeRecord>;
const memory = new Map<string, MemoryState>();

function state(organizationId: string) {
  const current = memory.get(organizationId);
  if (current) return current;
  const created: MemoryState = new Map();
  memory.set(organizationId, created);
  return created;
}

const now = () => new Date().toISOString();

function assertContext(record: { organizationId: string }, context: TrustedRequestContext) {
  if (record.organizationId !== context.organizationId) throw new Error("Runtime record is not owned by this organization.");
}

function mapRow(row: typeof runtimeRecords.$inferSelect): RuntimeRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    kind: row.kind as RuntimeKind,
    status: row.status,
    payload: row.payload || {},
    expiresAt: row.expiresAt?.toISOString() || null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class RuntimeStore {
  async get<T extends Record<string, unknown>>(context: TrustedRequestContext, kind: RuntimeKind, id: string): Promise<RuntimeRecord<T> | null> {
    if (!isDatabaseConfigured()) {
      const record = state(context.organizationId).get(`${kind}:${id}`);
      if (!record || record.kind !== kind) return null;
      assertContext(record, context);
      if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) return null;
      return record as RuntimeRecord<T>;
    }
    const rows = await getDb().select().from(runtimeRecords).where(and(eq(runtimeRecords.organizationId, context.organizationId), eq(runtimeRecords.kind, kind), eq(runtimeRecords.id, id))).limit(1);
    if (!rows[0]) return null;
    const record = mapRow(rows[0]);
    if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) return null;
    return record as RuntimeRecord<T>;
  }

  async list<T extends Record<string, unknown>>(context: TrustedRequestContext, kind: RuntimeKind, limit = 100): Promise<Array<RuntimeRecord<T>>> {
    if (!isDatabaseConfigured()) {
      return [...state(context.organizationId).values()]
        .filter((record) => record.kind === kind && (!record.expiresAt || Date.parse(record.expiresAt) > Date.now()))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, Math.min(limit, 200)) as Array<RuntimeRecord<T>>;
    }
    const rows = await getDb().select().from(runtimeRecords).where(and(eq(runtimeRecords.organizationId, context.organizationId), eq(runtimeRecords.kind, kind))).orderBy(desc(runtimeRecords.updatedAt)).limit(Math.min(limit, 200));
    return rows.map(mapRow).filter((record) => !record.expiresAt || Date.parse(record.expiresAt) > Date.now()) as Array<RuntimeRecord<T>>;
  }

  /** Administrative listing that keeps expired records visible for operations/audit views. */
  async listAll<T extends Record<string, unknown>>(context: TrustedRequestContext, kind: RuntimeKind, limit = 100): Promise<Array<RuntimeRecord<T>>> {
    if (!isDatabaseConfigured()) {
      return [...state(context.organizationId).values()].filter((record) => record.kind === kind).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, Math.min(limit, 200)) as Array<RuntimeRecord<T>>;
    }
    const rows = await getDb().select().from(runtimeRecords).where(and(eq(runtimeRecords.organizationId, context.organizationId), eq(runtimeRecords.kind, kind))).orderBy(desc(runtimeRecords.updatedAt)).limit(Math.min(limit, 200));
    return rows.map(mapRow) as Array<RuntimeRecord<T>>;
  }

  async put<T extends Record<string, unknown>>(context: TrustedRequestContext, record: Omit<RuntimeRecord<T>, "organizationId" | "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }): Promise<RuntimeRecord<T>> {
    const createdAt = record.createdAt || now();
    const updatedAt = record.updatedAt || now();
    const next: RuntimeRecord<T> = { ...record, organizationId: context.organizationId, createdAt, updatedAt };
    if (!isDatabaseConfigured()) {
      const previous = state(context.organizationId).get(`${record.kind}:${record.id}`);
      if (previous) assertContext(previous, context);
      state(context.organizationId).set(`${record.kind}:${record.id}`, next);
      return next;
    }
    await getDb().insert(runtimeRecords).values({ id: next.id, organizationId: next.organizationId, kind: next.kind, status: next.status, payload: next.payload, expiresAt: next.expiresAt ? new Date(next.expiresAt) : null, createdAt: new Date(createdAt), updatedAt: new Date(updatedAt) }).onConflictDoUpdate({ target: runtimeRecords.id, set: { status: next.status, payload: next.payload, expiresAt: next.expiresAt ? new Date(next.expiresAt) : null, updatedAt: new Date(updatedAt) } });
    return next;
  }

  async update<T extends Record<string, unknown>>(context: TrustedRequestContext, kind: RuntimeKind, id: string, update: { status?: string; payload?: T; expiresAt?: string | null }): Promise<RuntimeRecord<T> | null> {
    const existing = await this.get<T>(context, kind, id);
    if (!existing) return null;
    return this.put(context, { ...existing, status: update.status || existing.status, payload: update.payload || existing.payload, expiresAt: update.expiresAt === undefined ? existing.expiresAt : update.expiresAt, updatedAt: now() });
  }

  /** Atomically transition a record. Used for approval decisions and replay-safe actions. */
  async transition<T extends Record<string, unknown>>(context: TrustedRequestContext, kind: RuntimeKind, id: string, fromStatus: string, toStatus: string, payload: T): Promise<RuntimeRecord<T> | null> {
    if (!isDatabaseConfigured()) {
      const existing = state(context.organizationId).get(`${kind}:${id}`) as RuntimeRecord<T> | undefined;
      if (existing) assertContext(existing, context);
      if (!existing || existing.status !== fromStatus) return null;
      const next = { ...existing, status: toStatus, payload, updatedAt: now() } as RuntimeRecord<T>;
      state(context.organizationId).set(`${kind}:${id}`, next);
      return next;
    }
    const updated = await getDb().update(runtimeRecords).set({ status: toStatus, payload, updatedAt: new Date() }).where(and(eq(runtimeRecords.organizationId, context.organizationId), eq(runtimeRecords.kind, kind), eq(runtimeRecords.id, id), eq(runtimeRecords.status, fromStatus))).returning();
    return updated[0] ? mapRow(updated[0]) as RuntimeRecord<T> : null;
  }

  async consume<T extends Record<string, unknown>>(context: TrustedRequestContext, kind: RuntimeKind, id: string): Promise<RuntimeRecord<T> | null> {
    const existing = await this.get<T>(context, kind, id);
    if (!existing || existing.status !== "AVAILABLE") return null;
    if (!isDatabaseConfigured()) {
      const consumed = { ...existing, status: "CONSUMED", payload: { ...existing.payload, status: "CONSUMED", consumedAt: now() }, updatedAt: now() } as RuntimeRecord<T>;
      state(context.organizationId).set(`${kind}:${id}`, consumed);
      return consumed;
    }
    const updated = await getDb().update(runtimeRecords).set({ status: "CONSUMED", payload: sql`jsonb_set(jsonb_set(${runtimeRecords.payload}, '{status}', to_jsonb('CONSUMED'::text), true), '{consumedAt}', to_jsonb(${now()}::text), true)`, updatedAt: new Date() }).where(and(eq(runtimeRecords.organizationId, context.organizationId), eq(runtimeRecords.kind, kind), eq(runtimeRecords.id, id), eq(runtimeRecords.status, "AVAILABLE"))).returning();
    return updated[0] ? mapRow(updated[0]) as RuntimeRecord<T> : null;
  }
}

let store: RuntimeStore | null = null;
export function getRuntimeStore() {
  if (!store) store = new RuntimeStore();
  return store;
}

export function resetRuntimeStoreForTests() {
  memory.clear();
  store = null;
}
