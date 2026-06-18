/**
 * Copy RESEND_API_KEY + JWT_APP_SECRET from creator-engine env to eazpire-partner-portals
 * via Cloudflare Workers Secrets API (values are not readable from wrangler CLI).
 *
 * POST /apps/creator-dispatch?op=internal-sync-partner-worker-secrets
 * Header: X-EAZ-ADMIN-KEY = INTERNAL_SHARED_SECRET
 * Body: { account_id, cloudflare_api_token, script_name? }
 */

const SECRET_NAMES = ["RESEND_API_KEY", "JWT_APP_SECRET"];
const DEFAULT_SCRIPT = "eazpire-partner-portals";

export async function handleSyncPartnerWorkerSecrets(request, env) {
  const { json, getCorsHeaders } = await import("../../utils/response.js");
  const cors = getCorsHeaders(request);

  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405, cors);
  }

  const adminKey = request.headers.get("X-EAZ-ADMIN-KEY");
  if (!adminKey || adminKey !== String(env.INTERNAL_SHARED_SECRET || "").trim()) {
    return json({ ok: false, error: "Unauthorized" }, 401, cors);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400, cors);
  }

  const accountId = String(body.account_id || env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const cfToken = String(body.cloudflare_api_token || "").trim();
  const scriptName = String(body.script_name || DEFAULT_SCRIPT).trim();

  if (!accountId || !cfToken) {
    return json({ ok: false, error: "missing_account_id_or_token" }, 400, cors);
  }

  const synced = [];
  const skipped = [];
  const errors = [];

  for (const name of SECRET_NAMES) {
    const value = String(env[name] || "").trim();
    if (!value) {
      skipped.push(name);
      continue;
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(scriptName)}/secrets`;
    const resp = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${cfToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, text: value, type: "secret_text" }),
    });

    let data = {};
    try {
      data = await resp.json();
    } catch {
      /* ignore */
    }

    if (!resp.ok || data.success === false) {
      errors.push({ name, status: resp.status, errors: data.errors || data });
      continue;
    }
    synced.push(name);
  }

  const ok = errors.length === 0 && synced.length > 0;
  return json({ ok, synced, skipped, errors }, ok ? 200 : 500, cors);
}
