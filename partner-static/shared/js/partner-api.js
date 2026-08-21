export function partnerApiBase() {
  return window.__PARTNER_API_BASE__ || window.location.origin;
}

export function formatPartnerApiError(res, data = {}) {
  const apiMsg = String(data.message || data.detail || "").trim();
  if (apiMsg) return apiMsg;
  const code = String(data.error || "").trim();
  if (code && !/^http_\d+$/i.test(code)) return code;
  const status = Number(res?.status) || 0;
  if (status === 429) return "Workers AI rate limit reached. Try again in 2 minutes.";
  if (status === 503) return "Workers AI is temporarily overloaded. Try again in 2 minutes.";
  if (status === 504 || status === 524) return "The request timed out. Try again in 2 minutes.";
  return status ? `Request failed (HTTP ${status}).` : "Request failed.";
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
    const err = new Error(formatPartnerApiError(res, data));
    err.data = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Multipart file upload (no JSON content-type). */
export async function partnerUpload(op, file, { query = {}, formFields = {} } = {}) {
  const url = new URL(partnerApiBase());
  url.searchParams.set("op", op);
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== "") url.searchParams.set(k, v);
  }
  const form = new FormData();
  form.append("file", file);
  for (const [k, v] of Object.entries(formFields)) {
    if (v != null) form.append(k, String(v));
  }
  const res = await fetch(url.toString(), {
    method: "POST",
    credentials: "include",
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const err = new Error(formatPartnerApiError(res, data));
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
    changes_requested: "badge-warning",
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
