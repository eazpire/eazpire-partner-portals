// src/utils/response.js

import { buildCorsHeaders } from "./corsPolicy.js";

// Statischer Fallback ohne Request: feste Origin, kein * + credentials.
const CORS_HEADERS = {
  "access-control-allow-origin": "https://www.eazpire.com",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers":
    "content-type, authorization, x-eaz-debug-activate, x-eaz-logged-in-customer-id, x-requested-with",
  "access-control-allow-credentials": "true",
  "access-control-expose-headers": "x-eaz-crop-run-id",
  "access-control-max-age": "86400",
  vary: "Origin",
};

/** CORS + explicit no-store so dynamic hero APIs are not cached by browser or Cloudflare edge. */
export function noStoreCorsHeaders(request) {
  return {
    ...getCorsHeaders(request),
    "cache-control": "private, no-store, max-age=0, must-revalidate",
    pragma: "no-cache",
    "cdn-cache-control": "no-store",
  };
}

export function getCorsHeaders(request) {
  return buildCorsHeaders(request);
}

// kleines JSON-Hilfsding, wie früher
export function json(obj, status = 200, headers = {}, request = null) {
    // Prüfe ob CORS-Headers bereits vorhanden sind (case-insensitive)
    const hasCorsHeaders = Object.keys(headers).some(key =>
      key.toLowerCase().includes('access-control-allow-origin') ||
      key.toLowerCase().includes('access-control-allow-methods') ||
      key.toLowerCase().includes('access-control-allow-headers')
    );

    // Erstelle finalHeaders ohne CORS-Header zunächst
    const finalHeaders = {
      "content-type": "application/json"
    };

    // Wenn CORS-Headers übergeben wurden, verwende diese (nicht die statischen)
    if (hasCorsHeaders) {
      Object.assign(finalHeaders, headers);
    } else if (request) {
      // Wenn Request verfügbar, verwende dynamische CORS-Headers
      const dynamicCorsHeaders = getCorsHeaders(request);
      Object.assign(finalHeaders, dynamicCorsHeaders);
    } else {
      Object.assign(finalHeaders, CORS_HEADERS);
    }

    // Zusätzliche Header (z. B. x-eaz-crop-run-id), wenn CORS aus Request kommt und `headers` nur Erweiterungen enthält
    if (!hasCorsHeaders && headers && typeof headers === "object") {
      for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase();
        if (
          lower === "content-type" ||
          lower.startsWith("access-control-allow-") ||
          lower === "access-control-max-age" ||
          lower === "access-control-expose-headers"
        ) {
          continue;
        }
        finalHeaders[key] = headers[key];
      }
    }

    return new Response(JSON.stringify(obj), {
      status,
      headers: finalHeaders
    });
  }

export { CORS_HEADERS };
