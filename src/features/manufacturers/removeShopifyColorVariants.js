/**
 * Printify publish.json does not delete disabled colors from Shopify.
 * After a remove-color, drop matching Shopify variants so the listing matches.
 */

import { shopifyAPI } from "../../utils/shopify.js";
import { normalizeColorLabel } from "./adminCreationsRemoveColorVariant.js";

const COLOR_OPTION_NAMES = new Set(["color", "colors", "colour", "colours", "farbe", "farben"]);
const COLOR_ALIASES = {
  black: ["schwarz"],
  schwarz: ["black"],
};

function normalizeShopifyId(raw) {
  return String(raw || "")
    .replace("gid://shopify/Product/", "")
    .replace("gid://shopify/ProductVariant/", "")
    .replace(/\.0$/, "")
    .trim();
}

function shopDomainFromEnv(env) {
  return String(env?.SHOPIFY_SHOP || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .trim();
}

export function colorsMatchLabel(a, b) {
  const left = normalizeColorLabel(a);
  const right = normalizeColorLabel(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return (COLOR_ALIASES[left] || []).includes(right);
}

export function shopifyColorOptionIndex(product) {
  const opts = Array.isArray(product?.options) ? product.options : [];
  for (let i = 0; i < opts.length; i += 1) {
    const n = String(opts[i]?.name || "").toLowerCase();
    if (COLOR_OPTION_NAMES.has(n)) return i;
  }
  return 0;
}

export function shopifyVariantColorLabel(variant, colorIdx = 0) {
  const keys = ["option1", "option2", "option3"];
  if (colorIdx >= 0 && colorIdx < keys.length && variant?.[keys[colorIdx]]) {
    return String(variant[keys[colorIdx]]).trim();
  }
  if (Array.isArray(variant?.selectedOptions)) {
    const found = variant.selectedOptions.find((o) =>
      COLOR_OPTION_NAMES.has(String(o?.name || "").toLowerCase())
    );
    if (found?.value) return String(found.value).trim();
    if (variant.selectedOptions[0]?.value) return String(variant.selectedOptions[0].value).trim();
  }
  return String(variant?.title || "").split(" / ")[0].trim();
}

export function selectShopifyVariantsByColor(product, colorLabel) {
  const idx = shopifyColorOptionIndex(product);
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  return variants.filter((v) => colorsMatchLabel(shopifyVariantColorLabel(v, idx), colorLabel));
}

function variantGid(id) {
  const raw = String(id || "").trim();
  if (raw.startsWith("gid://")) return raw;
  return `gid://shopify/ProductVariant/${normalizeShopifyId(raw)}`;
}

/**
 * @param {any} env
 * @param {string} shopifyProductId
 * @param {string} colorLabel
 * @returns {Promise<{ deleted: number, remaining: number, total: number }>}
 */
export async function deleteShopifyVariantsByColor(env, shopifyProductId, colorLabel) {
  const sid = normalizeShopifyId(shopifyProductId);
  const shop = shopDomainFromEnv(env);
  const color = String(colorLabel || "").trim();
  if (!sid || !shop || !color || !env?.SHOPIFY_ACCESS_TOKEN) {
    return { deleted: 0, remaining: 0, total: 0, detail: "skipped_missing" };
  }

  const data = await shopifyAPI(env, shop, `products/${sid}.json`);
  const product = data?.product;
  if (!product) throw new Error("Shopify product not found");

  const matches = selectShopifyVariantsByColor(product, color);
  const total = Array.isArray(product.variants) ? product.variants.length : 0;
  if (!matches.length) {
    return { deleted: 0, remaining: 0, total };
  }
  if (total - matches.length < 1) {
    throw new Error("Cannot remove the last Shopify variant");
  }

  const variantIds = matches.map((v) => variantGid(v.id));
  let bulkOk = false;
  try {
    const gql = await shopifyAPI(env, shop, "graphql.json", {
      method: "POST",
      body: JSON.stringify({
        query: `mutation productVariantsBulkDelete($productId: ID!, $variantsIds: [ID!]!) {
          productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
            userErrors { field message }
          }
        }`,
        variables: {
          productId: `gid://shopify/Product/${sid}`,
          variantsIds: variantIds,
        },
      }),
    });
    const userErrors = gql?.data?.productVariantsBulkDelete?.userErrors || [];
    if (userErrors.length) {
      throw new Error(userErrors.map((e) => e.message).filter(Boolean).join("; ") || "Shopify variant delete failed");
    }
    if (gql?.errors?.length) {
      throw new Error(gql.errors.map((e) => e.message).filter(Boolean).join("; ") || "Shopify variant delete failed");
    }
    if (gql?.data?.productVariantsBulkDelete) bulkOk = true;
  } catch (err) {
    console.warn("[removeShopifyColorVariants] bulk delete failed, falling back to REST", err?.message || err);
  }

  if (!bulkOk) {
    for (const v of matches) {
      const vid = normalizeShopifyId(v.id);
      if (!vid) continue;
      await shopifyAPI(env, shop, `products/${sid}/variants/${vid}.json`, { method: "DELETE" });
    }
  }

  const after = await shopifyAPI(env, shop, `products/${sid}.json`);
  const leftover = selectShopifyVariantsByColor(after?.product || {}, color);
  return {
    deleted: matches.length - leftover.length,
    remaining: leftover.length,
    total: Array.isArray(after?.product?.variants) ? after.product.variants.length : total - matches.length,
  };
}
