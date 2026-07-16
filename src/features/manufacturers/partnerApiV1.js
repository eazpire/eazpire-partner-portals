/**
 * Map /api/v1/* paths to partner ?op= aliases (versioned Partner / Manufacturer API).
 */

const API_V1_MAP = {
  "/api/v1/overview": "partner-api-overview",
  "/api/v1/company": null, // method-aware below
  "/api/v1/products": null, // method-aware below
  "/api/v1/orders": "partner-api-orders",
  "/api/v1/webhooks": null, // method-aware below
  "/api/v1/keys": "partner-api-keys",
};

const PRODUCT_ACTION_SEGMENTS = new Set(["submit-review"]);

const ORDER_ACTION_OPS = {
  accept: "partner-api-order-accept",
  reject: "partner-api-order-reject",
  status: "partner-api-order-status",
  tracking: "partner-api-order-tracking",
  "print-file": "partner-api-order-print-file",
};

/**
 * If request is /api/v1/..., return a cloned Request with ?op= set (unless already present).
 * @returns {Request|null} rewritten request, or null if not an API v1 path
 */
export function rewritePartnerApiV1Request(request) {
  const url = new URL(request.url);
  if (url.searchParams.get("op")) return null;

  let pathname = url.pathname.replace(/\/$/, "") || "/";
  if (!pathname.startsWith("/api/v1")) return null;

  // GET/POST /api/v1/company
  if (pathname === "/api/v1/company") {
    const method = (request.method || "GET").toUpperCase();
    const op =
      method === "GET" || method === "HEAD" ? "partner-api-company" : "partner-api-company-update";
    url.searchParams.set("op", op);
    return new Request(url.toString(), request);
  }

  // GET/POST /api/v1/products
  if (pathname === "/api/v1/products") {
    const method = (request.method || "GET").toUpperCase();
    const op =
      method === "GET" || method === "HEAD" ? "partner-api-products" : "partner-api-product-create";
    url.searchParams.set("op", op);
    return new Request(url.toString(), request);
  }

  // POST /api/v1/products/:id/submit-review
  const submitMatch = pathname.match(/^\/api\/v1\/products\/([^/]+)\/submit-review$/);
  if (submitMatch) {
    const segment = decodeURIComponent(submitMatch[1]);
    url.searchParams.set("op", "partner-api-product-submit");
    url.searchParams.set("product_id", segment);
    return new Request(url.toString(), request);
  }

  // GET/POST /api/v1/products/:id
  const productMatch = pathname.match(/^\/api\/v1\/products\/([^/]+)$/);
  if (productMatch) {
    const segment = decodeURIComponent(productMatch[1]);
    if (!PRODUCT_ACTION_SEGMENTS.has(segment)) {
      const method = (request.method || "GET").toUpperCase();
      const op =
        method === "GET" || method === "HEAD"
          ? "partner-api-product-get"
          : "partner-api-product-update";
      url.searchParams.set("op", op);
      url.searchParams.set("product_id", segment);
      return new Request(url.toString(), request);
    }
  }

  // /api/v1/orders/:id/:action
  const orderActionMatch = pathname.match(/^\/api\/v1\/orders\/([^/]+)\/([^/]+)$/);
  if (orderActionMatch) {
    const orderId = decodeURIComponent(orderActionMatch[1]);
    const action = decodeURIComponent(orderActionMatch[2]);
    const op = ORDER_ACTION_OPS[action];
    if (op) {
      url.searchParams.set("op", op);
      url.searchParams.set("order_id", orderId);
      return new Request(url.toString(), request);
    }
  }

  // GET /api/v1/orders/:id
  const orderMatch = pathname.match(/^\/api\/v1\/orders\/([^/]+)$/);
  if (orderMatch) {
    const orderId = decodeURIComponent(orderMatch[1]);
    if (!ORDER_ACTION_OPS[orderId]) {
      url.searchParams.set("op", "partner-api-order-get");
      url.searchParams.set("order_id", orderId);
      return new Request(url.toString(), request);
    }
  }

  // GET/POST /api/v1/webhooks
  if (pathname === "/api/v1/webhooks") {
    const method = (request.method || "GET").toUpperCase();
    const op =
      method === "GET" || method === "HEAD"
        ? "partner-api-webhooks"
        : "partner-api-webhooks-create";
    url.searchParams.set("op", op);
    return new Request(url.toString(), request);
  }

  // POST /api/v1/webhooks/:id[/test|/revoke]
  const webhookMatch = pathname.match(/^\/api\/v1\/webhooks\/([^/]+)(?:\/(test|revoke))?$/);
  if (webhookMatch) {
    const webhookId = decodeURIComponent(webhookMatch[1]);
    const action = webhookMatch[2] || "";
    const method = (request.method || "GET").toUpperCase();
    url.searchParams.set("webhook_id", webhookId);
    let op = "partner-api-webhooks-update";
    if (action === "test") op = "partner-api-webhooks-test";
    else if (action === "revoke" || method === "DELETE") op = "partner-api-webhooks-revoke";
    url.searchParams.set("op", op);
    return new Request(url.toString(), request);
  }

  const mapped = API_V1_MAP[pathname];
  if (!mapped) return null;

  url.searchParams.set("op", mapped);
  return new Request(url.toString(), request);
}

export { API_V1_MAP };
