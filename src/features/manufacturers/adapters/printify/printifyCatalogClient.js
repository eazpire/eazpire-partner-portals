/**
 * Printify catalog API client (partner adapter)
 */

import { getPrintifyApiKey } from "../../../../utils/printifyEnv.js";

const PRINTIFY_API = "https://api.printify.com/v1";

async function printifyGet(apiKey, endpoint, retries = 2) {
  const url = `${PRINTIFY_API}${endpoint}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.status === 429 && attempt < retries) {
      await new Promise((r) => setTimeout(r, (attempt + 1) * 3000));
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Printify ${res.status} for ${endpoint}: ${body.slice(0, 200)}`);
    }
    return res.json();
  }
}

export async function fetchAllPrintProviders(env) {
  const key = getPrintifyApiKey(env);
  if (!key) return { ok: false, error: "printify_api_key_not_configured" };
  const data = await printifyGet(key, "/catalog/print_providers.json");
  return { ok: true, providers: Array.isArray(data) ? data : [] };
}

export async function fetchPrintProviderDetail(env, providerId) {
  const key = getPrintifyApiKey(env);
  if (!key) return { ok: false, error: "printify_api_key_not_configured" };
  const data = await printifyGet(key, `/catalog/print_providers/${providerId}.json`);
  return { ok: true, provider: data };
}

export async function fetchBlueprint(env, blueprintId) {
  const key = getPrintifyApiKey(env);
  if (!key) return { ok: false, error: "printify_api_key_not_configured" };
  const data = await printifyGet(key, `/catalog/blueprints/${blueprintId}.json`);
  return { ok: true, blueprint: data };
}

export async function fetchBlueprintProviderVariants(env, blueprintId, printProviderId) {
  const key = getPrintifyApiKey(env);
  if (!key) return { ok: false, error: "printify_api_key_not_configured" };
  const data = await printifyGet(
    key,
    `/catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/variants.json`
  );
  return { ok: true, variants: data };
}
