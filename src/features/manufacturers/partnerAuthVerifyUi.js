/**
 * Magic-link verify UX: confirmation page + browser-friendly errors.
 * GET shows a confirm button so email link scanners cannot consume tokens.
 */

function escapeHtmlAttr(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

export function wantsJsonVerifyResponse(request, url) {
  const accept = request.headers.get("accept") || "";
  return accept.includes("application/json") || url.searchParams.get("format") === "json";
}

export function partnerVerifyFailureResponse(env, request, url, cors, errorCode) {
  if (wantsJsonVerifyResponse(request, url)) {
    return {
      kind: "json",
      status: errorCode === "token_required" ? 400 : 401,
      body: { ok: false, error: errorCode },
      headers: cors,
    };
  }
  const base = String(env.PARTNER_PORTAL_URL || "https://partner.eazpire.com").replace(/\/$/, "");
  return {
    kind: "redirect",
    status: 302,
    location: `${base}/?auth_error=${encodeURIComponent(errorCode)}`,
    headers: cors,
  };
}

export function renderMagicLinkConfirmPage({ actionPath, token, title, lead, buttonLabel }) {
  const safeToken = escapeHtmlAttr(token);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtmlAttr(title)}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; background: #0f1115; color: #f4f6fb; }
    .card { width: min(420px, calc(100vw - 32px)); background: #171a21; border: 1px solid #2a3140; border-radius: 16px; padding: 28px; box-shadow: 0 20px 60px rgba(0,0,0,.35); }
    h1 { margin: 0 0 12px; font-size: 1.35rem; }
    p { margin: 0; line-height: 1.5; color: #b8c0d0; font-size: 0.95rem; }
    form { margin-top: 22px; }
    button { width: 100%; border: 0; border-radius: 10px; padding: 12px 16px; font-size: 1rem; font-weight: 600; cursor: pointer; background: #5b8cff; color: #fff; }
    button:hover { background: #4a7af0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtmlAttr(title)}</h1>
    <p>${escapeHtmlAttr(lead)}</p>
    <form method="POST" action="${escapeHtmlAttr(actionPath)}">
      <input type="hidden" name="token" value="${safeToken}" />
      <button type="submit">${escapeHtmlAttr(buttonLabel)}</button>
    </form>
  </div>
</body>
</html>`;
}

export function authTokenStatus(row) {
  if (!row) return "invalid_or_expired_token";
  if (row.used_at) return "token_already_used";
  if (Number(row.expires_at) <= Date.now()) return "invalid_or_expired_token";
  return "valid";
}

export async function readVerifyToken(request, url) {
  if (request.method === "POST") {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await request.json().catch(() => ({}));
      return String(body.token || "").trim();
    }
    const form = await request.formData().catch(() => null);
    if (form) return String(form.get("token") || "").trim();
  }
  return String(url.searchParams.get("token") || "").trim();
}

export function redirectWithHeaders(location, status, headers = {}) {
  return new Response(null, {
    status,
    headers: {
      Location: location,
      ...headers,
    },
  });
}
