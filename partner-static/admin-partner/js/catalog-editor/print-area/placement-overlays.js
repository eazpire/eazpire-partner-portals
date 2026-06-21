import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { getPlaceholderSlotsForView } from "../version-config-panel.js";
import { rectFromConfigArea, defaultCenteredRect, aspectRatioFromDefault, getMockupDefaultForView } from "./helpers.js";

const PH_ORDER = ["creator_design", "additional_design", "qr", "logo"];

function normalizeAreaType(area) {
  const t = String(area?.type || area?.placeholder_type || "").toLowerCase();
  if (t === "design") return "creator_design";
  if (t === "additional") return "additional_design";
  return t;
}

function savedAreasForView(slice, viewKey) {
  const vk = String(viewKey || "front").toLowerCase();
  const block = slice?.edit_mode?.[vk];
  return Array.isArray(block?.areas) ? block.areas : [];
}

function brandImageUrl(brandAssets, type) {
  const url = brandAssets?.[type]?.black?.image_url || brandAssets?.[type]?.black?.imageUrl;
  return url ? String(url) : "";
}

function defaultStackRect(redRect, index, total, aspect) {
  const pad = 0.04;
  const innerH = Math.max(0.05, redRect.h - pad * 2);
  const slotH = innerH / Math.max(1, total);
  const slotW = Math.min(redRect.w - pad * 2, slotH * (aspect > 0 ? aspect : 1));
  const slotH2 = aspect > 0 ? slotW / aspect : slotH;
  const y = redRect.y + pad + index * slotH + (slotH - slotH2) / 2;
  const x = redRect.x + (redRect.w - slotW) / 2;
  return { x, y, w: slotW, h: slotH2, angle: 0 };
}

/**
 * Resolve N placement overlay rects for the active view from version placeholder config.
 * @returns {Array<{ type: string, index: number, rect: object, imageUrl?: string }>}
 */
export function resolvePlacementOverlays(ctx, st, data, slice, brandAssets) {
  const version =
    (data?.versions || []).find((v) => String(v.id) === String(ctx?.selectedVersionId)) || data?.version || null;
  const catalogDetail = {
    variants: data?.variants_json || data?.variants || [],
  };
  const slots = getPlaceholderSlotsForView(version, catalogDetail, st.activeView);
  const md = getMockupDefaultForView(data?.mockup_defaults, st.activeView);
  const aspect = aspectRatioFromDefault(md);
  const red = st.redRect || defaultCenteredRect(aspect, 0.5);
  const saved = savedAreasForView(slice, st.activeView);

  const specs = [];
  for (const type of PH_ORDER) {
    const count = Math.max(0, Number(slots[type]) || 0);
    for (let i = 0; i < count; i++) {
      specs.push({ type, index: i });
    }
  }
  if (!specs.length) return [];

  const buckets = { creator_design: [], additional_design: [], qr: [], logo: [] };
  saved.forEach((area, idx) => {
    const type = normalizeAreaType(area);
    if (buckets[type]) buckets[type].push({ area, idx });
  });

  return specs.map((spec, globalIdx) => {
    const bucket = buckets[spec.type] || [];
    const savedArea = bucket[spec.index]?.area;
    const savedRect = rectFromConfigArea(savedArea);
    const rect =
      savedRect ||
      defaultStackRect(red, globalIdx, specs.length, aspect > 0 ? aspect : 1);

    const overlay = { type: spec.type, index: spec.index, rect };
    if (spec.type === "qr" || spec.type === "logo") {
      const url = brandImageUrl(brandAssets, spec.type);
      if (url) overlay.imageUrl = url;
    }
    return overlay;
  });
}

export function renderPlacementOverlaysHtml(overlays) {
  return (overlays || [])
    .map((ov) => {
      const cls =
        ov.type === "creator_design"
          ? "ce-pa-rect--creator"
          : ov.type === "additional_design"
            ? "ce-pa-rect--additional"
            : "ce-pa-rect--brand";
      const r = ov.rect || {};
      const angle = Number(r.angle) || 0;
      const transform = angle ? ` transform: rotate(${angle}deg);` : "";
      const img =
        ov.imageUrl && (ov.type === "qr" || ov.type === "logo")
          ? `<img src="${escapeHtml(ov.imageUrl)}" alt="" />`
          : "";
      return `<div class="ce-pa-rect ce-pa-rect--overlay ${cls}" data-ph-type="${escapeHtml(ov.type)}" data-ph-index="${ov.index}"
        style="left:${(r.x || 0) * 100}%;top:${(r.y || 0) * 100}%;width:${(r.w || 0) * 100}%;height:${(r.h || 0) * 100}%;${transform}">${img}</div>`;
    })
    .join("");
}

export function refreshPlacementOverlayLayer(container, overlays) {
  const layer = container?.querySelector?.(".ce-pa-placement-layer");
  if (!layer) return;
  layer.innerHTML = renderPlacementOverlaysHtml(overlays);
}
