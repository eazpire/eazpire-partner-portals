/**
 * Normalize Printify catalog blueprint → Universal Blueprint v1
 */

import { SCHEMA, SCHEMA_VERSION, slugBlueprintKey, inferArtifactSlot } from "../../blueprints/blueprintSchema.js";

function inferCategoryFromTitle(title) {
  const t = String(title || "").toLowerCase();
  if (t.includes("hoodie") || t.includes("sweatshirt")) return "apparel.hoodie";
  if (t.includes("mug")) return "home.mug";
  if (t.includes("tote") || t.includes("bag")) return "accessory.bag";
  if (t.includes("tank")) return "apparel.tshirt";
  if (t.includes("tee") || t.includes("shirt")) return "apparel.tshirt";
  if (t.includes("poster")) return "wall_art.poster";
  return "apparel.tshirt";
}

function normalizePrintAreasFromBlueprint(blueprint) {
  const areas = blueprint?.print_areas || blueprint?.printAreas || [];
  if (!Array.isArray(areas) || !areas.length) {
    return [
      {
        area_key: "front",
        label: "Front",
        type: "dtg",
        canvas: { width_px: 4500, height_px: 5400, dpi: 300, unit: "px" },
        safe_zone: { x: 0, y: 0, width: 4500, height: 5400 },
        enabled: true,
      },
    ];
  }
  return areas.map((a, i) => ({
    area_key: a.name || a.key || `area_${i + 1}`,
    label: a.name || a.key || `Area ${i + 1}`,
    type: "dtg",
    canvas: {
      width_px: Number(a.width || a.placeholders?.[0]?.width || 4500),
      height_px: Number(a.height || a.placeholders?.[0]?.height || 5400),
      dpi: 300,
      unit: "px",
    },
    safe_zone: {
      x: 0,
      y: 0,
      width: Number(a.width || 4500),
      height: Number(a.height || 5400),
    },
    enabled: true,
  }));
}

function normalizeVariantsFromPrintify(variantsPayload) {
  const variants = variantsPayload?.variants || variantsPayload || [];
  if (!Array.isArray(variants)) return [];
  return variants.map((v, i) => ({
    variant_key: String(v.id || v.sku || `variant_${i + 1}`),
    external_variant_id: v.id != null ? String(v.id) : null,
    sku: v.sku || null,
    color: v.options?.color ? { name: v.options.color, normalized: String(v.options.color).toLowerCase() } : null,
    size: v.options?.size ? { label: v.options.size, normalized: v.options.size } : null,
    base_cost: Number(v.cost ?? v.price ?? 0) / 100,
    currency: "USD",
    available: v.is_enabled !== false,
  }));
}

export function normalizePrintifyCatalogBlueprint(raw, { manufacturerId, printProviderId, variantsPayload } = {}) {
  const blueprintId = raw?.id ?? raw?.blueprint_id;
  const title = raw?.title || `Printify Blueprint ${blueprintId}`;
  const normalizedCategory = inferCategoryFromTitle(title);
  const printAreas = normalizePrintAreasFromBlueprint(raw);
  const variants = normalizeVariantsFromPrintify(variantsPayload);

  return {
    schema: SCHEMA,
    schema_version: SCHEMA_VERSION,
    identity: {
      blueprint_key: slugBlueprintKey(`printify_${blueprintId}_${title}`),
      title,
      subtitle: raw?.brand || raw?.model || null,
      description: raw?.description || null,
      status: "live",
      language: "en",
    },
    provider: {
      partner_id: manufacturerId,
      partner_type: "aggregator_api",
      integration_type: "printify_catalog",
      external_product_id: blueprintId != null ? String(blueprintId) : null,
      external_blueprint_id: blueprintId != null ? String(blueprintId) : null,
      print_provider_id: printProviderId != null ? String(printProviderId) : null,
      raw_source_type: "printify_catalog_sync",
    },
    category: {
      normalized: normalizedCategory,
      product_type: normalizedCategory.split(".").pop() || "tshirt",
      family: normalizedCategory.split(".")[0] || "apparel",
      artifact_slot_type: inferArtifactSlot(normalizedCategory),
      tags: raw?.tags || [],
    },
    variants,
    print_areas: printAreas,
    placeholders: printAreas.map((a) => ({
      placeholder_key: a.area_key,
      area_key: a.area_key,
      label: a.label,
      position: { x: 0, y: 0, width: a.canvas.width_px, height: a.canvas.height_px },
      scale: 1,
    })),
    mockup_views: [],
    pricing: { currency: "USD", base_cost_from: variants[0]?.base_cost ?? 0 },
    shipping: [],
    production: { production_days_min: 2, production_days_max: 7 },
    file_requirements: {
      preferred_format: "png",
      accepted_formats: ["png"],
      recommended_dpi: 300,
      max_file_size_mb: 100,
    },
    design_studio: { enabled: true, manual_editing: true, show_safe_zone: true },
    auto_publish_profiles: [],
    artifact: { artifact_supported: false, slot_type: inferArtifactSlot(normalizedCategory) },
    capabilities: { printify_blueprint_id: blueprintId },
    order_mapping: { printify_blueprint_id: blueprintId, printify_print_provider_id: printProviderId },
    versioning: { version: "1.0.0" },
    _printify_raw: raw,
  };
}
