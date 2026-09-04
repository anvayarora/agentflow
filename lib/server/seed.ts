import { getDb, isDatabaseConfigured } from "../../db";
import { eq } from "drizzle-orm";
import { customerSegments, customers, organizationMembers, organizations, policies, policyRules, policyVersions, products, salespersonProfiles } from "../../db/schema";
import { compileDemoPolicyProposal } from "../policy/compiler";
import { demoOrganizationId } from "./context";
import { resetCommerceRepositoryForTests } from "./repositories/commerce";
import { products as displayProducts } from "../catalogue";
import { DEFAULT_SALESPERSON_PROFILES } from "./repositories/salesperson";

/** Destructive only in the sense that it intentionally refreshes demo fixtures. */
export async function seedDemoDatabase() {
  if (!isDatabaseConfigured()) throw new Error("DATABASE_URL is required to seed AgentFlow PostgreSQL state.");
  if (process.env.NODE_ENV === "production") throw new Error("Demo seed is disabled in production; use db:bootstrap:production.");
  const organizationId = demoOrganizationId();
  const policyId = "policy-haven-home-commerce";
  const proposal = compileDemoPolicyProposal("Standard customers can receive up to 10%. Repeat customers can receive up to 15%. Never go below 25% gross margin. Do not discount products below 10 units in stock. Orders above ₹50,000 require merchant approval.", { organizationId, policyId, version: 1 });
  const policy = { ...proposal.policy, status: "PUBLISHED" as const };
  const db = getDb();

  await db.transaction(async (tx) => {
    await tx.insert(organizations).values({ id: organizationId, name: "Haven Home" }).onConflictDoUpdate({ target: organizations.id, set: { name: "Haven Home", updatedAt: new Date() } });
    await tx.insert(organizationMembers).values({ id: "member-haven-demo", organizationId, actorId: "demo-merchant", role: "owner" }).onConflictDoNothing();
    await tx.insert(policies).values({ id: policyId, organizationId, name: "Haven Home · Everyday commerce", currentPublishedVersionId: policy.id }).onConflictDoUpdate({ target: policies.id, set: { currentPublishedVersionId: policy.id, updatedAt: new Date() } });
    await tx.insert(policyVersions).values({ id: policy.id, organizationId, policyId, version: 1, status: "PUBLISHED", currency: "INR", sourcePrompt: policy.sourcePrompt, source: "system", createdBy: "seed", publishedAt: new Date() }).onConflictDoUpdate({ target: policyVersions.id, set: { status: "PUBLISHED", publishedAt: new Date(), updatedAt: new Date() } });
    for (const product of displayProducts) {
      await tx.insert(products).values({ id: product.id, organizationId, externalId: `demo-${product.id}`, sku: product.sku, name: product.name, description: product.description, category: product.category, brand: product.id === "desk-041" ? "Aster" : "Haven Home", currency: "INR", listPricePaise: Math.round(product.price * 100), costPaise: product.id === "desk-017" ? null : product.cost === null ? null : Math.round(product.cost * 100), stock: product.stock, attributes: { finish: product.finish, material: product.material, width: product.width, art: product.art }, tags: [product.tag || "catalogue"], imageUrl: null, source: "demo", sourceUpdatedAt: null }).onConflictDoUpdate({ target: products.id, set: { name: product.name, brand: product.id === "desk-041" ? "Aster" : "Haven Home", listPricePaise: Math.round(product.price * 100), costPaise: product.id === "desk-017" ? null : product.cost === null ? null : Math.round(product.cost * 100), stock: product.stock, updatedAt: new Date() } });
    }
    const seededCustomers = [
      { id: "customer-haven-repeat", externalCustomerId: "haven-repeat", emailHash: "demo-repeat", orderCount: 4, lifetimeValuePaise: 2_850_000, lastOrderAt: new Date("2026-07-15"), attributes: { name: "Returning customer" } },
      { id: "customer-haven-new", externalCustomerId: "haven-new", emailHash: "demo-new", orderCount: 0, lifetimeValuePaise: 0, lastOrderAt: null, attributes: { name: "New customer" } },
    ];
    for (const customer of seededCustomers) {
      await tx.insert(customers).values({ ...customer, organizationId }).onConflictDoUpdate({ target: customers.id, set: { orderCount: customer.orderCount, lifetimeValuePaise: customer.lifetimeValuePaise, lastOrderAt: customer.lastOrderAt, attributes: customer.attributes, updatedAt: new Date() } });
      await tx.insert(customerSegments).values({ id: `segment-${customer.id}`, organizationId, customerId: customer.id, segment: customer.orderCount > 0 ? "repeat" : "new", source: "derived-order-count" }).onConflictDoUpdate({ target: customerSegments.id, set: { segment: customer.orderCount > 0 ? "repeat" : "new", computedAt: new Date() } });
    }
    for (const rule of policy.rules) {
      await tx.insert(policyRules).values({ id: `${policy.id}::${rule.id}`, organizationId, policyVersionId: policy.id, name: rule.name, description: rule.description, priority: rule.priority, hardConstraint: rule.hardConstraint, scope: rule.scope, conditions: rule.conditions, effect: rule.effect }).onConflictDoUpdate({ target: policyRules.id, set: { name: rule.name, description: rule.description, priority: rule.priority, hardConstraint: rule.hardConstraint, scope: rule.scope, conditions: rule.conditions, effect: rule.effect } });
    }
    for (const baseProfile of DEFAULT_SALESPERSON_PROFILES) {
      const profileId = `${baseProfile.id}-${organizationId}`;
      await tx.insert(salespersonProfiles).values({ id: profileId, organizationId, displayName: baseProfile.displayName, description: baseProfile.description, speakerId: baseProfile.speakerId, languageSupport: [...baseProfile.languageSupport], tonePreset: baseProfile.tonePreset, pacePreset: baseProfile.pacePreset, isActive: baseProfile.isActive ?? true, isMerchantDefault: baseProfile.isMerchantDefault ?? false, avatarKey: baseProfile.avatarKey ?? null }).onConflictDoUpdate({ target: salespersonProfiles.id, set: { displayName: baseProfile.displayName, description: baseProfile.description, speakerId: baseProfile.speakerId, languageSupport: [...baseProfile.languageSupport], tonePreset: baseProfile.tonePreset, pacePreset: baseProfile.pacePreset, isActive: baseProfile.isActive ?? true, isMerchantDefault: baseProfile.isMerchantDefault ?? false, updatedAt: new Date() } });
    }
  });
  resetCommerceRepositoryForTests();
  return { organizationId, policyVersionId: policy.id, productCount: displayProducts.length, customerCount: 2 };
}

/**
 * Production bootstrap is deliberately idempotent and non-destructive. It
 * creates the tenant shell when a database is empty, but never changes policy
 * pointers, merchant economics, profiles, aggregates, growth, or transactions
 * once application state exists.
 */
export async function bootstrapProductionDatabase() {
  if (!isDatabaseConfigured()) throw new Error("DATABASE_URL is required to bootstrap AgentFlow PostgreSQL state.");
  const organizationId = process.env.AGENTFLOW_MERCHANT_ORGANIZATION_ID || demoOrganizationId();
  if (!organizationId) throw new Error("AGENTFLOW_DEMO_ORGANIZATION_ID or a trusted merchant organization is required for production bootstrap.");
  const db = getDb();
  const existing = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (existing.length > 0) return { organizationId, created: false };
  await db.insert(organizations).values({ id: organizationId, name: "Haven Home" }).onConflictDoNothing();
  await db.insert(organizationMembers).values({ id: "member-haven-demo", organizationId, actorId: "demo-merchant", role: "owner" }).onConflictDoNothing();
  return { organizationId, created: true };
}

/** Backwards-compatible demo entrypoint for existing local workflows. */
export const seedDatabase = seedDemoDatabase;
