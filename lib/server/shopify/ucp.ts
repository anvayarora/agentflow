import { createHash } from "node:crypto";

export const SHOPIFY_UCP_VERSION = "2026-04-08";
export const DEFAULT_SHOPIFY_DOMAIN = "haven-home-k1gerlw9.myshopify.com";

type JsonRecord = Record<string, unknown>;

export type UcpCapability = {
  version: string;
  spec?: string;
  schema?: string;
  transport?: string;
  extends?: string[];
  requires?: JsonRecord;
};

export type ShopifyUcpBusiness = {
  shopDomain: string;
  version: string;
  supportedVersions: Record<string, string>;
  endpoint: string;
  services: Record<string, UcpCapability[]>;
  capabilities: Record<string, UcpCapability[]>;
};

export type ShopifyUcpTool = {
  name: string;
  description?: string;
  inputSchema?: JsonRecord;
};

export type ShopifyUcpProduct = {
  id: string;
  title: string;
  handle?: string;
  description: string;
  currency: string;
  priceMinorUnits: number;
  variants: Array<{
    id: string;
    sku?: string;
    title?: string;
    priceMinorUnits: number;
    currency: string;
    available?: boolean;
    imageUrl?: string;
    checkoutUrl?: string;
  }>;
  media: string[];
  tags: string[];
  collections: Array<{ id: string; handle?: string; title?: string }>;
  raw: JsonRecord;
};

export type PublicShopifyUcpProduct = Omit<ShopifyUcpProduct, "raw">;

export function toPublicShopifyProduct(product: ShopifyUcpProduct): PublicShopifyUcpProduct {
  return Object.fromEntries(Object.entries(product).filter(([key]) => key !== "raw")) as PublicShopifyUcpProduct;
}

export type ShopifyUcpCartLine = {
  id?: string;
  quantity: number;
  item: {
    id: string;
    title?: string;
    priceMinorUnits?: number;
    imageUrl?: string;
  };
  totals?: Array<{ type: string; amount: number; displayText?: string }>;
};

export type ShopifyUcpCart = {
  id: string;
  currency?: string;
  lineItems: ShopifyUcpCartLine[];
  totals: Array<{ type: string; amount: number; displayText?: string }>;
  continueUrl?: string;
  context?: JsonRecord;
  attribution?: JsonRecord;
  buyer?: JsonRecord;
  signals?: JsonRecord;
  messages: Array<JsonRecord>;
  raw: JsonRecord;
};

export type ShopifyCapabilitySnapshot = {
  shopDomain: string;
  version: string;
  endpoint: string;
  services: Record<string, UcpCapability[]>;
  capabilities: Record<string, UcpCapability[]>;
  tools: string[];
  verifiedAt: string;
};

export class ShopifyUcpError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(message: string, code = "SHOPIFY_UCP_ERROR", status?: number) {
    super(message);
    this.name = "ShopifyUcpError";
    this.code = code;
    this.status = status;
  }
}

const env = () => (typeof process === "undefined" ? undefined : process.env);

export function normalizeShopDomain(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized)) {
    throw new ShopifyUcpError("Shopify shop domain is not a valid myshopify.com domain.", "INVALID_SHOP_DOMAIN");
  }
  return normalized;
}

export function configuredShopDomain(): string {
  return normalizeShopDomain(env()?.SHOPIFY_STORE_DOMAIN || DEFAULT_SHOPIFY_DOMAIN);
}

function configuredUcpContext(): JsonRecord | undefined {
  const country = env()?.SHOPIFY_UCP_DEFAULT_COUNTRY?.trim().toUpperCase();
  const currency = env()?.SHOPIFY_UCP_DEFAULT_CURRENCY?.trim().toUpperCase();
  if (!country && !currency) return undefined;
  return {
    ...(country ? { address_country: country } : {}),
    ...(currency ? { currency } : {}),
  };
}

export function agentProfileUrl(): string {
  const explicit = env()?.SHOPIFY_UCP_PROFILE_URL;
  const publicUrl = env()?.AGENTFLOW_PUBLIC_URL || (env()?.VERCEL_URL ? `https://${env()?.VERCEL_URL}` : undefined);
  const value = explicit || (publicUrl ? `${publicUrl.replace(/\/$/, "")}/profiles/agentflow-ucp.json` : undefined);
  if (!value) throw new ShopifyUcpError("AgentFlow public URL is required for UCP profile negotiation.", "UCP_PROFILE_NOT_CONFIGURED");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ShopifyUcpError("AgentFlow UCP profile URL is invalid.", "INVALID_UCP_PROFILE_URL");
  }
  if (parsed.protocol !== "https:") throw new ShopifyUcpError("AgentFlow UCP profile URL must use HTTPS.", "INSECURE_UCP_PROFILE_URL");
  return parsed.toString();
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function capabilityList(value: unknown): UcpCapability[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const version = asString(record.version);
    if (!version) return [];
    return [{
      version,
      spec: asString(record.spec),
      schema: asString(record.schema),
      transport: asString(record.transport),
      extends: Array.isArray(record.extends) ? record.extends.filter((entry): entry is string => typeof entry === "string") : undefined,
      requires: asRecord(record.requires),
    }];
  });
}

function capabilityMap(value: unknown): Record<string, UcpCapability[]> {
  const record = asRecord(value);
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, capabilityList(item)]).filter(([, list]) => list.length > 0));
}

function sanitizeContent(value: unknown): JsonRecord {
  const record = asRecord(value);
  return {
    ucp: asRecord(record.ucp),
    messages: Array.isArray(record.messages) ? record.messages.slice(0, 20).map(asRecord) : [],
  };
}

function parseStructuredContent(payload: JsonRecord): JsonRecord {
  const result = asRecord(payload.result);
  const structured = asRecord(result.structuredContent);
  if (Object.keys(structured).length > 0) return structured;
  const content = Array.isArray(result.content) ? result.content : [];
  for (const item of content) {
    const record = asRecord(item);
    if (record.type !== "text" || typeof record.text !== "string") continue;
    try {
      const parsed = JSON.parse(record.text) as unknown;
      if (Object.keys(asRecord(parsed)).length > 0) return asRecord(parsed);
    } catch {
      // A text representation is optional. The structured response remains authoritative.
    }
  }
  return {};
}

function extractCart(payload: JsonRecord): JsonRecord {
  const structured = parseStructuredContent(payload);
  const nested = asRecord(structured.cart);
  return Object.keys(nested).length > 0 ? nested : structured;
}

function mapDescription(value: unknown): string {
  const description = asRecord(value);
  const html = asString(description.html);
  if (html) return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return asString(value) || "";
}

function mapProduct(value: unknown): ShopifyUcpProduct | null {
  const product = asRecord(value);
  const id = asString(product.id);
  const title = asString(product.title);
  if (!id || !title) return null;
  const priceRange = asRecord(product.price_range);
  const min = asRecord(priceRange.min);
  const currency = asString(min.currency) || "USD";
  const variants = Array.isArray(product.variants) ? product.variants.flatMap((entry) => {
    const variant = asRecord(entry);
    const variantId = asString(variant.id);
    const variantPrice = asRecord(variant.price);
    const price = asNumber(variantPrice.amount) ?? asNumber(variant.price);
    if (!variantId || price === undefined) return [];
    const item = asRecord(variant.item);
    const availability = asRecord(variant.availability);
    const media = Array.isArray(variant.media) ? asRecord(variant.media[0]) : {};
    return [{
      id: variantId,
      sku: asString(variant.sku),
      title: asString(variant.title),
      priceMinorUnits: price,
      currency: asString(variantPrice.currency) || currency,
      available: typeof availability.available === "boolean" ? availability.available : undefined,
      imageUrl: asString(media.url) || asString(item.image_url),
      checkoutUrl: asString(variant.checkout_url),
    }];
  }) : [];
  return {
    id,
    title,
    handle: asString(product.handle),
    description: mapDescription(product.description),
    currency,
    priceMinorUnits: asNumber(min.amount) || variants[0]?.priceMinorUnits || 0,
    variants,
    media: Array.isArray(product.media) ? product.media.flatMap((entry) => asString(asRecord(entry).url) ? [asString(asRecord(entry).url)!] : []) : [],
    tags: Array.isArray(product.tags) ? product.tags.filter((entry): entry is string => typeof entry === "string") : [],
    collections: Array.isArray(product.collections) ? product.collections.flatMap((entry) => {
      const collection = asRecord(entry);
      const collectionId = asString(collection.id);
      return collectionId ? [{ id: collectionId, handle: asString(collection.handle), title: asString(collection.title) }] : [];
    }) : [],
    raw: product,
  };
}

function mapCart(value: JsonRecord): ShopifyUcpCart {
  const lines = Array.isArray(value.line_items) ? value.line_items.flatMap((entry) => {
    const line = asRecord(entry);
    const item = asRecord(line.item);
    const itemId = asString(item.id);
    const quantity = asNumber(line.quantity);
    if (!itemId || quantity === undefined) return [];
    const totals = Array.isArray(line.totals) ? line.totals.flatMap((total) => {
      const record = asRecord(total);
      const amount = asNumber(record.amount);
      const type = asString(record.type);
      return amount !== undefined && type ? [{ type, amount, displayText: asString(record.display_text) }] : [];
    }) : [];
    return [{ id: asString(line.id), quantity, item: { id: itemId, title: asString(item.title), priceMinorUnits: asNumber(item.price), imageUrl: asString(item.image_url) }, totals }];
  }) : [];
  const totals = Array.isArray(value.totals) ? value.totals.flatMap((total) => {
    const record = asRecord(total);
    const amount = asNumber(record.amount);
    const type = asString(record.type);
    return amount !== undefined && type ? [{ type, amount, displayText: asString(record.display_text) }] : [];
  }) : [];
  return {
    id: asString(value.id) || "",
    currency: asString(value.currency),
    lineItems: lines,
    totals,
    continueUrl: asString(value.continue_url),
    context: asRecord(value.context),
    attribution: asRecord(value.attribution),
    buyer: asRecord(value.buyer),
    signals: asRecord(value.signals),
    messages: Array.isArray(value.messages) ? value.messages.map(asRecord).slice(0, 20) : [],
    raw: value,
  };
}

export function cartHash(cart: ShopifyUcpCart): string {
  const canonical = JSON.stringify({ currency: cart.currency, lineItems: cart.lineItems.map((line) => ({ id: line.id, itemId: line.item.id, quantity: line.quantity })) });
  return createHash("sha256").update(canonical).digest("hex");
}

export class ShopifyUcpClient {
  private readonly shopDomain: string;
  private readonly profileUrl: string;
  private business: ShopifyUcpBusiness | null = null;
  private requestNumber = 0;

  constructor(options: { shopDomain?: string; profileUrl?: string } = {}) {
    this.shopDomain = normalizeShopDomain(options.shopDomain || configuredShopDomain());
    this.profileUrl = options.profileUrl || agentProfileUrl();
  }

  async discoverBusiness(): Promise<ShopifyUcpBusiness> {
    const payload = await this.fetchJson(`https://${this.shopDomain}/.well-known/ucp`);
    const root = asRecord(payload.ucp);
    const services = capabilityMap(root.services);
    const serviceEntries = Array.isArray(asRecord(root.services)["dev.ucp.shopping"]) ? asRecord(root.services)["dev.ucp.shopping"] as unknown[] : [];
    const mcpService = serviceEntries.map(asRecord).find((entry) => entry.transport === "mcp" && typeof entry.endpoint === "string");
    if (!mcpService || typeof mcpService.endpoint !== "string") throw new ShopifyUcpError("Shopify UCP did not advertise an MCP endpoint.", "MCP_ENDPOINT_NOT_ADVERTISED");
    const endpoint = new URL(mcpService.endpoint);
    if (endpoint.hostname !== this.shopDomain) throw new ShopifyUcpError("Shopify UCP endpoint does not match the verified shop domain.", "MCP_ENDPOINT_DOMAIN_MISMATCH");
    const business: ShopifyUcpBusiness = {
      shopDomain: this.shopDomain,
      version: asString(root.version) || "",
      supportedVersions: Object.fromEntries(Object.entries(asRecord(root.supported_versions)).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : [])),
      endpoint: endpoint.toString(),
      services,
      capabilities: capabilityMap(root.capabilities),
    };
    if (!business.version || business.version !== SHOPIFY_UCP_VERSION) throw new ShopifyUcpError(`Shopify UCP version ${business.version || "unknown"} is not the supported ${SHOPIFY_UCP_VERSION} contract.`, "UNSUPPORTED_UCP_VERSION");
    this.business = business;
    return business;
  }

  async listTools(): Promise<ShopifyUcpTool[]> {
    const payload = await this.call("tools/list", undefined, true);
    const tools: unknown[] = Array.isArray(asRecord(payload.result).tools) ? asRecord(payload.result).tools as unknown[] : [];
    return tools.flatMap((tool) => {
      const record = asRecord(tool);
      const name = asString(record.name);
      return name ? [{ name, description: asString(record.description), inputSchema: asRecord(record.inputSchema) }] : [];
    });
  }

  async searchCatalog(query: string, options: { limit?: number; cursor?: string } = {}) {
    const payload = await this.call("tools/call", { name: "search_catalog", arguments: { catalog: { query, pagination: { limit: Math.min(Math.max(options.limit || 10, 1), 50), ...(options.cursor ? { cursor: options.cursor } : {}) } } } });
    const structured = parseStructuredContent(payload);
    const products = Array.isArray(structured.products) ? structured.products.flatMap(mapProduct) : [];
    const pagination = asRecord(structured.pagination);
    return { products, pagination: { hasNextPage: pagination.has_next_page === true, cursor: asString(pagination.cursor) }, ucp: sanitizeContent(structured).ucp };
  }

  async lookupCatalog(ids: string[]) {
    const payload = await this.call("tools/call", { name: "lookup_catalog", arguments: { catalog: { ids } } });
    const structured = parseStructuredContent(payload);
    return { products: Array.isArray(structured.products) ? structured.products.flatMap(mapProduct) : [], ucp: sanitizeContent(structured).ucp };
  }

  async getProduct(id: string) {
    const payload = await this.call("tools/call", { name: "get_product", arguments: { catalog: { id } } });
    const structured = parseStructuredContent(payload);
    return { product: mapProduct(structured.product || structured), ucp: sanitizeContent(structured).ucp };
  }

  async createCart(lineItems: Array<{ variantId: string; quantity: number }>, context: JsonRecord = configuredUcpContext() || {}) {
    const payload = await this.call("tools/call", { name: "create_cart", arguments: { cart: { line_items: lineItems.map((line) => ({ quantity: line.quantity, item: { id: line.variantId } })), ...(context ? { context } : {}) } } });
    return mapCart(extractCart(payload));
  }

  async getCart(id: string) {
    const payload = await this.call("tools/call", { name: "get_cart", arguments: { id } });
    return mapCart(extractCart(payload));
  }

  async updateCart(id: string, desired: { lineItems: Array<{ variantId: string; quantity: number; lineItemId?: string }>; context?: JsonRecord; attribution?: JsonRecord; buyer?: JsonRecord; signals?: JsonRecord }) {
    const current = await this.getCart(id);
    const cart = {
      line_items: desired.lineItems.map((line) => ({ ...(line.lineItemId ? { id: line.lineItemId } : {}), quantity: line.quantity, item: { id: line.variantId } })),
      ...(desired.context || current.context && Object.keys(current.context).length ? { context: desired.context || current.context } : configuredUcpContext() ? { context: configuredUcpContext() } : {}),
      ...(desired.attribution || current.attribution && Object.keys(current.attribution).length ? { attribution: desired.attribution || current.attribution } : {}),
      ...(desired.buyer || current.buyer && Object.keys(current.buyer).length ? { buyer: desired.buyer || current.buyer } : {}),
      ...(desired.signals || current.signals && Object.keys(current.signals).length ? { signals: desired.signals || current.signals } : {}),
    };
    const payload = await this.call("tools/call", { name: "update_cart", arguments: { id, cart } });
    return mapCart(extractCart(payload));
  }

  async cancelCart(id: string) {
    await this.call("tools/call", { name: "cancel_cart", arguments: { id, meta: { "idempotency-key": crypto.randomUUID() } } });
    return { id, cancelled: true };
  }

  snapshot(tools: ShopifyUcpTool[]): ShopifyCapabilitySnapshot {
    if (!this.business) throw new ShopifyUcpError("Discover Shopify UCP before creating a capability snapshot.", "UCP_DISCOVERY_REQUIRED");
    return { shopDomain: this.business.shopDomain, version: this.business.version, endpoint: this.business.endpoint, services: this.business.services, capabilities: this.business.capabilities, tools: tools.map((tool) => tool.name), verifiedAt: new Date().toISOString() };
  }

  private async call(method: "tools/list" | "tools/call", params?: JsonRecord, listOnly = false): Promise<JsonRecord> {
    if (!this.business) await this.discoverBusiness();
    const callParams = listOnly
      ? { arguments: { meta: { "ucp-agent": { profile: this.profileUrl } } } }
      : { ...(params || {}), ...(method === "tools/call" ? { arguments: { ...asRecord((params || {}).arguments), meta: { "ucp-agent": { profile: this.profileUrl }, ...asRecord(asRecord((params || {}).arguments).meta) } } } : {}) };
    const payload = await this.fetchJson(this.business!.endpoint, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", method, id: ++this.requestNumber, params: callParams }) });
    const error = asRecord(payload.error);
    if (Object.keys(error).length) throw new ShopifyUcpError("Shopify UCP rejected the request.", asString(error.code) || "UCP_REQUEST_REJECTED");
    const result = asRecord(payload.result);
    if (result.isError === true) throw new ShopifyUcpError("Shopify UCP returned an unsuccessful tool result.", "UCP_TOOL_ERROR");
    return payload;
  }

  private async fetchJson(url: string, init: RequestInit = {}): Promise<JsonRecord> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(url, { ...init, headers: { accept: "application/json", "content-type": "application/json", ...(init.headers || {}) }, signal: controller.signal });
      if (!response.ok) throw new ShopifyUcpError(`Shopify UCP returned HTTP ${response.status}.`, "UCP_HTTP_ERROR", response.status);
      const payload = await response.json() as unknown;
      return asRecord(payload);
    } catch (error) {
      if (error instanceof ShopifyUcpError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new ShopifyUcpError("Shopify UCP request timed out.", "UCP_TIMEOUT");
      throw new ShopifyUcpError("Shopify UCP request failed.", "UCP_NETWORK_ERROR");
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function getShopifyUcpClient(options: { shopDomain?: string; profileUrl?: string } = {}) {
  return new ShopifyUcpClient(options);
}
