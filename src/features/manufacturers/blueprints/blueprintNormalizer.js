/**
 * Normalize wizard input, JSON upload, or CSV into Eazpire Universal Blueprint v1
 */

import {
  SCHEMA,
  SCHEMA_VERSION,
  slugBlueprintKey,
  inferArtifactSlot,
} from "./blueprintSchema.js";

export function normalizeWizardInput(input, { manufacturerId, blueprintKey, title }) {
  const key = blueprintKey || slugBlueprintKey(title || input.title);
  const normalizedCategory = input.normalized_category || input.category || "apparel.tshirt";
  const productType = input.product_type || normalizedCategory.split(".").pop() || "tshirt";

  const variants = normalizeVariants(input.variants || []);
  const printAreas = normalizePrintAreas(input.print_areas || []);
  const placeholders = normalizePlaceholders(input.placeholders || [], printAreas);
  const mockupViews = normalizeMockups(input.mockup_views || []);
  const shipping = normalizeShipping(input.shipping || input.shipping_regions || []);

  return {
    schema: SCHEMA,
    schema_version: SCHEMA_VERSION,
    identity: {
      blueprint_key: key,
      title: title || input.title || "Untitled Blueprint",
      subtitle: input.subtitle || null,
      description: input.description || null,
      status: "draft",
      language: "en",
    },
    provider: {
      partner_id: manufacturerId,
      partner_type: input.partner_type || "direct_manufacturer",
      integration_type: input.integration_type || "portal_manual",
      external_product_id: input.external_product_id || null,
      external_blueprint_id: input.external_blueprint_id || null,
      raw_source_type: input.source_type || "manual_wizard",
    },
    category: {
      normalized: normalizedCategory,
      product_type: productType,
      family: normalizedCategory.split(".")[0] || "apparel",
      artifact_slot_type: input.artifact_slot_type || inferArtifactSlot(normalizedCategory),
      tags: input.tags || [],
    },
    variants,
    print_areas: printAreas,
    placeholders,
    mockup_views: mockupViews,
    pricing: normalizePricing(input.pricing || {}, variants),
    shipping,
    production: input.production || { production_days_min: 2, production_days_max: 5 },
    file_requirements: input.file_requirements || {
      preferred_format: "png",
      accepted_formats: ["png", "svg"],
      recommended_dpi: 300,
      max_file_size_mb: 100,
    },
    design_studio: input.design_studio || {
      enabled: true,
      manual_editing: true,
      show_safe_zone: true,
      allow_scale: true,
      allow_rotation: true,
    },
    auto_publish_profiles: normalizeProfiles(input.auto_publish_profiles || [], printAreas),
    artifact: input.artifact || {
      artifact_supported: !!input.artifact_supported,
      slot_type: input.artifact_slot_type || inferArtifactSlot(normalizedCategory),
    },
    capabilities: input.capabilities || {},
    order_mapping: input.order_mapping || {},
    versioning: { version: input.blueprint_version || "1.0.0" },
  };
}

export function normalizeFromProviderJson(raw, { manufacturerId, sourceType = "json_upload" }) {
  if (raw?.schema === SCHEMA) {
    return { ...raw, provider: { ...raw.provider, partner_id: manufacturerId, raw_source_type: sourceType } };
  }
  return normalizeWizardInput(raw, {
    manufacturerId,
    blueprintKey: raw.blueprint_key || raw.identity?.blueprint_key || slugBlueprintKey(raw.title),
    title: raw.title || raw.identity?.title,
  });
}

export { normalizePrintifyCatalogBlueprint } from "../adapters/printify/printifyBlueprintNormalizer.js";

export function parseCsvVariants(csvText) {
  const lines = String(csvText || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const variants = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? "";
    });
    variants.push({
      variant_key: (row.variant_key || `${row.color || "default"}_${row.size || "os"}`).toLowerCase().replace(/\s+/g, "_"),
      sku: row.sku || null,
      color: row.color ? { name: row.color, normalized: row.color.toLowerCase() } : null,
      size: row.size ? { label: row.size, normalized: row.size } : null,
      base_cost: Number(row.base_cost || row.cost || 0),
      currency: row.currency || "EUR",
      available: row.available !== "0" && row.available !== "false",
    });
  }
  return variants;
}

function normalizeVariants(variants) {
  return variants.map((v, i) => ({
    variant_key: v.variant_key || v.sku || `variant_${i + 1}`,
    external_variant_id: v.external_variant_id || null,
    sku: v.sku || null,
    color: typeof v.color === "string" ? { name: v.color, normalized: v.color.toLowerCase() } : v.color || null,
    size: typeof v.size === "string" ? { label: v.size, normalized: v.size } : v.size || null,
    base_cost: Number(v.base_cost ?? (v.base_cost_cents != null ? v.base_cost_cents / 100 : 0)),
    currency: v.currency || "EUR",
    available: v.available !== false,
    weight_grams: v.weight_grams || null,
    attributes: v.attributes || {},
  }));
}

function normalizePrintAreas(areas) {
  return areas.map((a) => {
    const width = Number(a.canvas?.width_px ?? a.width_px ?? 4500);
    const height = Number(a.canvas?.height_px ?? a.height_px ?? 5400);
    const safe = a.safe_zone || { x: 0, y: 0, width, height };
    return {
      area_key: a.area_key || a.placement_key || "front",
      label: a.label || a.area_key || "Front Print",
      type: a.type || "dtg",
      canvas: { width_px: width, height_px: height, dpi: Number(a.dpi ?? a.canvas?.dpi ?? 300), unit: "px" },
      safe_zone: safe,
      bleed: a.bleed || { top: 0, right: 0, bottom: 0, left: 0 },
      default_fit: a.default_fit || "contain",
      anchor: a.anchor || "center",
      supports_transparency: a.supports_transparency !== false,
      file_types: a.file_types || a.supported_file_types || ["png"],
      enabled: a.enabled !== false,
    };
  });
}

function normalizePlaceholders(placeholders, printAreas) {
  if (placeholders.length) return placeholders;
  const front = printAreas.find((a) => a.area_key === "front") || printAreas[0];
  if (!front) return [];
  return [
    {
      placeholder_key: "main_design_front",
      type: "design",
      print_area_key: front.area_key,
      required: true,
      default_transform: { x: 0.5, y: 0.5, scale: 0.82, rotation: 0, fit: "contain", anchor: "center" },
    },
  ];
}

function normalizeMockups(views) {
  return views.map((v) => ({
    view_key: v.view_key || "front_default",
    label: v.label || v.view_key || "Front view",
    variant_keys: v.variant_keys || [],
    image: v.image || { r2_key: v.image_r2_key || null, width_px: v.width_px, height_px: v.height_px },
    overlays: v.overlays || [],
    background: v.background || { color: "#ffffff" },
  }));
}

function normalizeShipping(regions) {
  if (!regions.length) {
    return [
      {
        ship_from_country: "DE",
        ship_to_countries: ["DE", "AT", "CH"],
        base_shipping: 4.9,
        additional_item_shipping: 2.1,
        currency: "EUR",
        estimated_days_min: 3,
        estimated_days_max: 7,
      },
    ];
  }
  return regions.map((s) => ({
    ship_from_country: s.ship_from_country || s.country || "DE",
    ship_to_countries: s.ship_to_countries || (s.country_code ? [s.country_code] : ["DE"]),
    base_shipping: Number(s.base_shipping ?? (s.base_shipping_cents != null ? s.base_shipping_cents / 100 : 0)),
    additional_item_shipping: Number(s.additional_item_shipping ?? 0),
    currency: s.currency || "EUR",
    estimated_days_min: s.estimated_days_min ?? 3,
    estimated_days_max: s.estimated_days_max ?? 7,
    tracking_supported: s.tracking_supported !== false,
  }));
}

function normalizePricing(pricing, variants) {
  const base = Number(pricing.base_cost ?? (pricing.base_cost_cents != null ? pricing.base_cost_cents / 100 : 0));
  const costByVariant = {};
  for (const v of variants) {
    if (v.variant_key && v.base_cost) costByVariant[v.variant_key] = v.base_cost;
  }
  return {
    base_cost: base || (variants[0]?.base_cost ?? 0),
    currency: pricing.currency || variants[0]?.currency || "EUR",
    cost_by_variant: pricing.cost_by_variant || costByVariant,
    suggested_retail_price: pricing.suggested_retail_price || null,
    suggested_min_price: pricing.suggested_min_price || null,
  };
}

function normalizeProfiles(profiles, printAreas) {
  if (profiles.length) return profiles;
  const front = printAreas.find((a) => a.area_key === "front");
  if (!front) return [];
  return [
    {
      profile_key: "front_center_default",
      label: "Front Center Default",
      mode: "single_design",
      is_default: true,
      enabled: true,
      target_channels: ["eazpire_marketplace"],
      placeholder_mapping: { design_input: "main_design_front" },
      default_transforms: {
        main_design_front: { x: 0.5, y: 0.5, scale: 0.82, rotation: 0, fit: "contain" },
      },
      variant_strategy: { mode: "enable_all_available" },
      pricing_strategy: { mode: "suggested_retail_price" },
    },
  ];
}
