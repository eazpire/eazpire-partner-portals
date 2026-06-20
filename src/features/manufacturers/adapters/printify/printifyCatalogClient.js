/**
 * Printify catalog API client (partner adapter)
 */

import {
  getPrintifyApiKey,
  httpStatusForPrintifyUpstreamError,
} from "../../../../utils/printifyEnv.js";

const PRINTIFY_API = "https://api.printify.com/v1";

/**
 * @returns {Promise<{ ok: true, data: unknown } | { ok: false, error: string, status?: number, detail?: string }>}
 */
async function printifyGet(apiKey, endpoint, retries = 2) {
  const url = `${PRINTIFY_API}${endpoint}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    } catch (err) {
      return {
        ok: false,
        error: "printify_network_error",
        detail: String(err?.message || err),
      };
    }

    if (res.status === 429 && attempt < retries) {
      await new Promise((r) => setTimeout(r, (attempt + 1) * 3000));
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const status = res.status;
      if (status === 401 || status === 403) {
        return {
          ok: false,
          error: "printify_unauthorized",
          status,
          detail: body.slice(0, 400),
        };
      }
      return {
        ok: false,
        error: "printify_catalog_error",
        status,
        detail: body.slice(0, 400),
      };
    }

    try {
      const data = await res.json();
      return { ok: true, data };
    } catch (err) {
      return {
        ok: false,
        error: "printify_invalid_json",
        detail: String(err?.message || err),
      };
    }
  }

  return { ok: false, error: "printify_rate_limited", status: 429 };
}

export async function fetchAllPrintProviders(env) {
  const key = getPrintifyApiKey(env);
  if (!key) return { ok: false, error: "printify_api_key_not_configured" };
  const result = await printifyGet(key, "/catalog/print_providers.json");
  if (!result.ok) return result;
  return { ok: true, providers: Array.isArray(result.data) ? result.data : [] };
}

export async function fetchPrintProviderDetail(env, providerId) {
  const key = getPrintifyApiKey(env);
  if (!key) return { ok: false, error: "printify_api_key_not_configured" };
  const result = await printifyGet(key, `/catalog/print_providers/${providerId}.json`);
  if (!result.ok) return result;
  return { ok: true, provider: result.data };
}

export async function fetchBlueprint(env, blueprintId) {
  const key = getPrintifyApiKey(env);
  if (!key) return { ok: false, error: "printify_api_key_not_configured" };
  const result = await printifyGet(key, `/catalog/blueprints/${blueprintId}.json`);
  if (!result.ok) return result;
  return { ok: true, blueprint: result.data };
}

export async function fetchPrintifyChoiceShipping(env, blueprintId) {
  const key = getPrintifyApiKey(env);
  if (!key) return { ok: false, error: "printify_api_key_not_configured" };
  const result = await printifyGet(
    key,
    `/catalog/blueprints/${blueprintId}/print_providers/99/shipping.json`
  );
  if (!result.ok) return result;
  return { ok: true, shipping: result.data };
}

export async function fetchBlueprintProviderVariants(env, blueprintId, printProviderId) {
  const key = getPrintifyApiKey(env);
  if (!key) return { ok: false, error: "printify_api_key_not_configured" };
  const result = await printifyGet(
    key,
    `/catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/variants.json`
  );
  if (!result.ok) return result;
  return { ok: true, variants: result.data };
}

export { httpStatusForPrintifyUpstreamError };
