/**
 * Serve partner / admin-partner / admin-creations / admin-brands SPAs from inline bundle (fast) or PARTNER_ASSETS.
 */

import { getPartnerStaticFallback } from "./partnerStaticFallback.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function isPartnerHost(hostname) {
  return hostname === "partner.eazpire.com" || hostname === "partner.local.eazpire.com";
}

function isAdminCreationsHost(hostname, pathname) {
  return (
    (hostname === "admin.eazpire.com" || hostname === "admin.local.eazpire.com") &&
    (pathname === "/creations" || pathname.startsWith("/creations/"))
  );
}

function isAdminBrandsHost(hostname, pathname) {
  return (
    (hostname === "admin.eazpire.com" || hostname === "admin.local.eazpire.com") &&
    (pathname === "/brands" || pathname.startsWith("/brands/"))
  );
}

function isAdminPartnerHost(hostname, pathname) {
  return (
    (hostname === "admin.eazpire.com" || hostname === "admin.local.eazpire.com") &&
    (pathname === "/partner" || pathname.startsWith("/partner/"))
  );
}

function isAdminRootHost(hostname, pathname) {
  return (
    (hostname === "admin.eazpire.com" || hostname === "admin.local.eazpire.com") &&
    (pathname === "/" || pathname === "")
  );
}

function resolveAssetKey(hostname, pathname) {
  if (isPartnerHost(hostname)) {
    if (pathname === "/auth/verify" || pathname === "/auth/verify-application") return null;
    if (pathname.startsWith("/shared/")) return `shared${pathname.slice("/shared".length)}`;
    if (pathname.startsWith("/js/")) return `partner${pathname}`;
    if (pathname === "/" || !pathname.includes(".")) return "partner/index.html";
    return `partner${pathname}`;
  }
  if (isAdminPartnerHost(hostname, pathname)) {
    const sub = pathname.replace(/^\/partner\/?/, "/") || "/";
    if (sub.startsWith("/shared/")) return `shared${sub.slice("/shared".length)}`;
    if (sub.startsWith("/js/")) return `admin-partner${sub}`;
    if (sub === "/" || !sub.includes(".")) return "admin-partner/index.html";
    return `admin-partner${sub}`;
  }
  if (isAdminCreationsHost(hostname, pathname)) {
    const sub = pathname.replace(/^\/creations\/?/, "/") || "/";
    if (sub.startsWith("/shared/")) return `shared${sub.slice("/shared".length)}`;
    if (sub.startsWith("/js/")) return `admin-creations${sub}`;
    if (sub === "/" || !sub.includes(".")) return "admin-creations/index.html";
    return `admin-creations${sub}`;
  }
  if (isAdminBrandsHost(hostname, pathname)) {
    const sub = pathname.replace(/^\/brands\/?/, "/") || "/";
    if (sub.startsWith("/shared/")) return `shared${sub.slice("/shared".length)}`;
    if (sub.startsWith("/js/")) return `admin-brands${sub}`;
    if (sub === "/" || !sub.includes(".")) return "admin-brands/index.html";
    return `admin-brands${sub}`;
  }
  return null;
}

async function fetchAsset(env, key) {
  if (!env.PARTNER_ASSETS?.fetch) return null;
  const url = `https://partner-assets.local/${key}`;
  try {
    const res = await Promise.race([
      env.PARTNER_ASSETS.fetch(url),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("PARTNER_ASSETS fetch timeout")), 4000);
      }),
    ]);
    if (res.ok) return res;
  } catch (err) {
    console.warn("[partner-portal] PARTNER_ASSETS fetch failed, using bundle fallback", key, err?.message);
  }
  return null;
}

export function isPartnerPortalHost(hostname, pathname) {
  return (
    isPartnerHost(hostname) ||
    isAdminPartnerHost(hostname, pathname) ||
    isAdminCreationsHost(hostname, pathname) ||
    isAdminBrandsHost(hostname, pathname) ||
    isAdminRootHost(hostname, pathname)
  );
}

export async function handlePartnerPortalRequest(request, env) {
  const url = new URL(request.url);
  if (url.searchParams.get("op")) return null;
  if (!isPartnerPortalHost(url.hostname, url.pathname)) return null;

  if (isPartnerHost(url.hostname) && url.pathname === "/auth/verify") {
    const { handlePartnerAuthVerify } = await import("./partnerAuth.js");
    return handlePartnerAuthVerify(request, env);
  }

  if (isPartnerHost(url.hostname) && url.pathname === "/auth/verify-application") {
    const { handlePartnerApplicationVerify } = await import("./partnerAuth.js");
    return handlePartnerApplicationVerify(request, env);
  }

  if (isAdminPartnerHost(url.hostname, url.pathname) && url.pathname === "/partner/auth/verify") {
    const { handleAdminAuthVerify } = await import("./adminPartnerAuth.js");
    return handleAdminAuthVerify(request, env);
  }

  if (isAdminCreationsHost(url.hostname, url.pathname) && url.pathname === "/creations/auth/verify") {
    const { handleAdminAuthVerify } = await import("./adminPartnerAuth.js");
    return handleAdminAuthVerify(request, env);
  }

  if (isAdminBrandsHost(url.hostname, url.pathname) && url.pathname === "/brands/auth/verify") {
    const { handleAdminAuthVerify } = await import("./adminPartnerAuth.js");
    return handleAdminAuthVerify(request, env);
  }

  if (isAdminRootHost(url.hostname, url.pathname)) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Eazpire Admin</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; background: #0f1115; color: #f4f6fb; }
    .card { width: min(420px, calc(100vw - 32px)); background: #171a21; border: 1px solid #2a3140; border-radius: 16px; padding: 28px; }
    h1 { margin: 0 0 12px; font-size: 1.35rem; }
    p { margin: 0 0 18px; line-height: 1.5; color: #b8c0d0; }
    a { color: #5b8cff; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Eazpire Admin</h1>
    <p>Worker-hosted admin console. More sections will appear here over time.</p>
    <p><a href="/partner">Partner Ops →</a></p>
    <p><a href="/creations">Creations Admin →</a></p>
    <p><a href="/brands">Brands Admin →</a></p>
  </div>
</body>
</html>`;
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const key = resolveAssetKey(url.hostname, url.pathname);
  if (!key) return new Response("Not found", { status: 404 });

  // Inline bundle first — avoids PARTNER_ASSETS hangs that caused Cloudflare 522s.
  const fallback = getPartnerStaticFallback(key);
  if (fallback) {
    return new Response(fallback.body, {
      status: 200,
      headers: {
        "content-type": fallback.contentType,
        "cache-control": key.endsWith(".html") || key.endsWith(".js") || key.endsWith(".css")
          ? "no-store"
          : "public, max-age=300",
      },
    });
  }

  const assetRes = await fetchAsset(env, key);
  if (assetRes) {
    const ext = key.slice(key.lastIndexOf("."));
    const headers = new Headers(assetRes.headers);
    if (MIME[ext]) headers.set("content-type", MIME[ext]);
    headers.set(
      "cache-control",
      key.endsWith(".html") || key.endsWith(".js") || key.endsWith(".css")
        ? "no-store"
        : "public, max-age=300"
    );
    return new Response(assetRes.body, { status: assetRes.status, headers });
  }

  if (key.endsWith(".ico")) {
    return new Response(null, { status: 204, headers: { "cache-control": "public, max-age=86400" } });
  }

  return new Response("Partner portal asset missing", { status: 404 });
}
