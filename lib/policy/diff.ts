import type { PolicyRule, PolicyVersionIR } from "./schema";

export type PolicyDiff = {
  fromPolicyVersionId: string;
  toPolicyVersionId: string;
  added: PolicyRule[];
  removed: PolicyRule[];
  modified: Array<{ before: PolicyRule; after: PolicyRule }>;
  summary: { added: number; removed: number; modified: number };
};

export function diffPolicyVersions(before: PolicyVersionIR, after: PolicyVersionIR): PolicyDiff {
  const beforeById = new Map(before.rules.map((rule) => [rule.id, rule]));
  const afterById = new Map(after.rules.map((rule) => [rule.id, rule]));
  const added = after.rules.filter((rule) => !beforeById.has(rule.id));
  const removed = before.rules.filter((rule) => !afterById.has(rule.id));
  const modified = after.rules.flatMap((rule) => {
    const previous = beforeById.get(rule.id);
    return previous && JSON.stringify(previous) !== JSON.stringify(rule) ? [{ before: previous, after: rule }] : [];
  });
  return { fromPolicyVersionId: before.id, toPolicyVersionId: after.id, added, removed, modified, summary: { added: added.length, removed: removed.length, modified: modified.length } };
}

export type PolicyOutcomeDiff = { baseline: Record<string, number>; draft: Record<string, number>; cases: number; kind: "SIMULATED" };
