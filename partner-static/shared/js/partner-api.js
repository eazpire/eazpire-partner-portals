export function partnerApiBase() {
  return window.__PARTNER_API_BASE__ || window.location.origin;
}

export async function partnerFetch(op, { method = "GET", body, query = {} } = {}) {
  const url = new URL(partnerApiBase());
  url.searchParams.set("op", op);
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== "") url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    method,
    credentials: "include",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || `http_${res.status}`);
    err.data = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

export function badgeForStatus(status) {
  const map = {
    verified: "badge-success",
    active: "badge-success",
    shipped: "badge-success",
    approved: "badge-success",
    pending_email_verification: "badge-neutral",
    pending_review: "badge-warning",
    in_production: "badge-warning",
    received: "badge-neutral",
    draft: "badge-neutral",
    rejected: "badge-danger",
    suspended: "badge-danger",
    failed: "badge-danger",
  };
  return map[status] || "badge-neutral";
}

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
