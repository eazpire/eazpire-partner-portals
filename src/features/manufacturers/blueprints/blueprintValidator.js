/**
 * Universal Blueprint validation engine (V1)
 */

import { validatePrintArea } from "../printAreaValidation.js";
import { SCHEMA, SCHEMA_VERSION } from "./blueprintSchema.js";

function pushIssue(list, severity, code, path, message) {
  list.push({ severity, code, path, message });
}

export function validateUniversalBlueprint(bp) {
  const errors = [];
  const warnings = [];
  const suggestions = [];

  if (!bp || typeof bp !== "object") {
    pushIssue(errors, "error", "invalid_blueprint", "", "Blueprint must be an object.");
    return buildResult(errors, warnings, suggestions);
  }

  if (bp.schema && bp.schema !== SCHEMA) {
    pushIssue(warnings, "warning", "schema_mismatch", "schema", `Expected ${SCHEMA}.`);
  }

  const identity = bp.identity || {};
  if (!identity.title && !bp.title) {
    pushIssue(errors, "error", "title_required", "identity.title", "Product title is required.");
  }
  if (!identity.blueprint_key && !bp.blueprint_key) {
    pushIssue(warnings, "warning", "blueprint_key_missing", "identity.blueprint_key", "Blueprint key will be auto-generated.");
  }

  const category = bp.category || {};
  if (!category.normalized && !category.product_type && !bp.product_type) {
    pushIssue(errors, "error", "category_required", "category.normalized", "Normalized category or product type is required.");
  }

  const variants = bp.variants || [];
  if (!Array.isArray(variants) || variants.length === 0) {
    pushIssue(errors, "error", "no_variants", "variants", "At least one variant is required.");
  } else {
    const keys = new Set();
    for (const [i, v] of variants.entries()) {
      const vk = v.variant_key || v.sku || `variant_${i}`;
      if (keys.has(vk)) {
        pushIssue(errors, "error", "duplicate_variant_key", `variants[${i}]`, `Duplicate variant key: ${vk}`);
      }
      keys.add(vk);
      const cost = Number(v.base_cost ?? (v.base_cost_cents != null ? v.base_cost_cents / 100 : 0));
      if (!cost || cost <= 0) {
        pushIssue(errors, "error", "no_base_cost", `variants[${i}]`, "Base cost must be greater than zero.");
      }
    }
  }

  const printAreas = bp.print_areas || [];
  if (!Array.isArray(printAreas) || printAreas.length === 0) {
    pushIssue(errors, "error", "missing_print_area", "print_areas", "At least one active print area is required.");
  } else {
    let activeCount = 0;
    for (const [i, area] of printAreas.entries()) {
      const canvas = area.canvas || {};
      const width = Number(canvas.width_px ?? area.width_px);
      const height = Number(canvas.height_px ?? area.height_px);
      const safe = area.safe_zone || {};
      const fileTypes = area.file_types || area.supported_file_types || ["png"];
      const v = validatePrintArea({
        width_px: width,
        height_px: height,
        dpi: canvas.dpi ?? area.dpi ?? 300,
        safe_zone: safe,
        supported_file_types: fileTypes,
      });
      if (!v.ok) {
        for (const code of v.errors) {
          pushIssue(errors, "error", code, `print_areas[${i}]`, `Print area validation failed: ${code}`);
        }
      }
      if (area.enabled !== false) activeCount++;
    }
    if (activeCount === 0) {
      pushIssue(errors, "error", "no_active_print_area", "print_areas", "At least one enabled print area is required.");
    }
  }

  const mockups = bp.mockup_views || [];
  if (mockups.length === 0) {
    pushIssue(warnings, "warning", "missing_mockup", "mockup_views", "No mockup views defined. Preview may be limited.");
  }

  const shipping = bp.shipping || [];
  if (!Array.isArray(shipping) || shipping.length === 0) {
    pushIssue(errors, "error", "no_shipping_region", "shipping", "At least one shipping region is required.");
  } else {
    for (const [i, s] of shipping.entries()) {
      if (!s.ship_from_country) {
        pushIssue(errors, "error", "ship_from_required", `shipping[${i}]`, "Ship-from country is required.");
      }
      const to = s.ship_to_countries || [];
      if (!Array.isArray(to) || to.length === 0) {
        pushIssue(errors, "error", "ship_to_required", `shipping[${i}]`, "Ship-to countries are required.");
      }
    }
  }

  const profiles = bp.auto_publish_profiles || [];
  if (profiles.length === 0) {
    pushIssue(warnings, "warning", "no_auto_publish_profile", "auto_publish_profiles", "No auto-publish profile defined.");
  }

  const artifact = bp.artifact || {};
  if (artifact.artifact_supported && !artifact.slot_type) {
    pushIssue(warnings, "warning", "artifact_slot_missing", "artifact.slot_type", "Artifact supported but slot type not set.");
  }

  if (!artifact.artifact_supported) {
    pushIssue(suggestions, "suggestion", "add_artifact_qr", "artifact", "Add QR placeholder to become Artifact Ready.");
  }

  return buildResult(errors, warnings, suggestions);
}

function buildResult(errors, warnings, suggestions) {
  const hardErrors = errors.length;
  const score = Math.max(0, 100 - hardErrors * 15 - warnings.length * 5);
  const studioScore = hardErrors === 0 && !errors.some((e) => e.code?.startsWith("print")) ? Math.min(100, score + 10) : score;
  const autoPublishScore = profilesScore(warnings, errors);
  const artifactScore = warnings.some((w) => w.code === "artifact_slot_missing") ? 40 : warnings.some((w) => w.code === "add_artifact_qr") ? 20 : 80;

  return {
    ok: hardErrors === 0,
    status: hardErrors === 0 ? (warnings.length ? "preview_ready" : "normalized") : "validation_failed",
    score,
    studio_score: studioScore,
    auto_publish_score: autoPublishScore,
    artifact_score: artifactScore,
    errors,
    warnings,
    suggestions,
  };
}

function profilesScore(warnings, errors) {
  if (errors.length) return Math.max(0, 50 - errors.length * 10);
  if (warnings.some((w) => w.code === "no_auto_publish_profile")) return 60;
  return 85;
}

export function emptyBlueprintShell({ title, blueprintKey, manufacturerId }) {
  return {
    schema: SCHEMA,
    schema_version: SCHEMA_VERSION,
    identity: {
      blueprint_key: blueprintKey,
      title,
      status: "draft",
      language: "en",
    },
    provider: {
      partner_id: manufacturerId,
      partner_type: "direct_manufacturer",
      integration_type: "portal_manual",
      raw_source_type: "manual_wizard",
    },
    category: {},
    variants: [],
    print_areas: [],
    placeholders: [],
    mockup_views: [],
    pricing: {},
    shipping: [],
    production: {},
    file_requirements: {
      preferred_format: "png",
      accepted_formats: ["png"],
      recommended_dpi: 300,
    },
    design_studio: { enabled: true, manual_editing: true, show_safe_zone: true },
    auto_publish_profiles: [],
    artifact: { artifact_supported: false },
    capabilities: {},
    order_mapping: {},
    versioning: { version: "1.0.0" },
  };
}
