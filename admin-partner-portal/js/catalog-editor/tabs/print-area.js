import { escapeHtml } from "/partner/shared/js/partner-api.js";
import {
  fetchPrintAreaBundle,
  savePrintAreaSnapshot,
  loadPrintifySettings,
  savePrintAreasConfig,
} from "../api.js";
import { mountPrintAreaCanvas } from "../print-area-canvas.js";

const DESIGN_TYPES = ["classic", "backprint", "pattern", "photo"];

function versionsForProvider(ctx, sourceVersions) {
  const pid = String(ctx.selectedPrintProviderId || "");
  return (sourceVersions || ctx.bundle?.versions || [])
    .filter((v) => String(v.external_provider_id) === pid)
    .slice()
    .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));
}

function ensureSelectedVersionForProvider(ctx, providerVersions) {
  const versions = versionsForProvider(ctx, providerVersions);
  if (!versions.length) {
    ctx.selectedVersionId = null;
    return null;
  }
  const match = versions.find((v) => String(v.id) === String(ctx.selectedVersionId));
  if (match) return match.id;
  ctx.selectedVersionId = versions[0].id;
  return versions[0].id;
}

function renderVersionSubnav(versions, selectedVersionId) {
  if (versions.length <= 1) return "";
  const tabs = versions
    .map((v, idx) => {
      const isStd = idx === 0;
      const name = v.display_name || (isStd ? "Standard" : `Version ${idx + 1}`);
      const active = String(v.id) === String(selectedVersionId) ? " active" : "";
      const badge = isStd ? `<span class="ce-prov-ver-badge">Standard</span>` : "";
      return `<button type="button" class="ce-pa-ver-tab ce-prov-ver-tab${active}" data-version-id="${escapeHtml(
        String(v.id)
      )}" role="tab" aria-selected="${active ? "true" : "false"}">${badge}<span class="ce-pa-ver-label">${escapeHtml(
        name
      )}</span></button>`;
    })
    .join("");
  return `
    <div class="ce-pa-version-subnav">
      <div class="ce-pa-version-subnav-head">
        <span class="ce-pa-version-subnav-title">Versions</span>
        <span class="ce-hint ce-pa-version-subnav-hint">Configure print area per version</span>
      </div>
      <div class="ce-pa-version-tabs ce-prov-version-tabs" role="tablist">${tabs}</div>
    </div>`;
}

export async function loadPrintAreaTab(ctx) {
  const providerVersions = versionsForProvider(ctx, ctx.bundle?.versions);
  ensureSelectedVersionForProvider(ctx, providerVersions);

  const data = await fetchPrintAreaBundle(
    ctx.productKey,
    ctx.selectedPrintProviderId,
    ctx.selectedVersionId
  );
  ctx.printAreaData = data;
  const version = data.version;
  const studioJson = JSON.stringify(version?.studio_config || {}, null, 2);
  const qrJson = JSON.stringify(version?.qr_logo_snapshot || {}, null, 2);
  const versionSubnav = renderVersionSubnav(providerVersions, ctx.selectedVersionId);

  const designType = ctx.selectedDesignType || "classic";
  const imageUrl = data.mockup_defaults?.[0]?.template_r2_key
    ? `${window.CREATOR_API_CONFIG?.BASE_URL || ""}/mockup/${data.mockup_defaults[0].template_r2_key}`
    : "";

  return `
    <div class="ce-tab-panel">
      ${versionSubnav}
      <div class="ce-inline-actions">
        ${DESIGN_TYPES.map(
          (t) =>
            `<button type="button" class="btn btn-secondary btn-sm ce-pa-design-tab ${
              designType === t ? "active" : ""
            }" data-design-type="${t}">${escapeHtml(t)}</button>`
        ).join("")}
      </div>
      <div class="ce-inline-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="ce-pa-load-printify">Load Printify</button>
      </div>
      <div id="ce-print-area-canvas" data-image="${escapeHtml(imageUrl)}"></div>
      <div class="field"><label>Studio config JSON</label>
        <textarea class="textarea ce-code" id="ce-pa-studio" rows="10">${escapeHtml(studioJson)}</textarea></div>
      <div class="field"><label>QR / logo snapshot JSON</label>
        <textarea class="textarea ce-code" id="ce-pa-qr" rows="8">${escapeHtml(qrJson)}</textarea></div>
      <div class="field"><label>Print areas config JSON (publish profile)</label>
        <textarea class="textarea ce-code" id="ce-pa-config" rows="8">${escapeHtml(
          JSON.stringify(
            (ctx.bundle.publish_profiles || []).find(
              (p) => Number(p.print_provider_id) === Number(ctx.selectedPrintProviderId)
            )?.print_areas_config_json || {},
            null,
            2
          )
        )}</textarea></div>
      <p class="ce-hint">${(data.mockup_defaults || []).length} mockup default(s), ${(data.variant_print_areas || []).length} variant print area(s).</p>
    </div>`;
}

export function bindPrintAreaTab(ctx, root) {
  root.querySelectorAll(".ce-pa-ver-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextId = btn.dataset.versionId;
      if (!nextId || String(nextId) === String(ctx.selectedVersionId)) return;
      ctx.selectedVersionId = nextId;
      ctx.reloadTab();
    });
  });
  root.querySelectorAll(".ce-pa-design-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      ctx.selectedDesignType = btn.dataset.designType;
      ctx.reloadTab();
    });
  });

  const firstDefault = ctx.printAreaData?.mockup_defaults?.[0];
  const imageUrl = firstDefault?.image_url
    ? firstDefault.image_url
    : firstDefault?.template_r2_key
      ? `${window.CREATOR_API_CONFIG?.BASE_URL || ""}/mockup/${firstDefault.template_r2_key}`
      : "";
  ctx.printAreaCanvasHandle?.destroy?.();
  ctx.printAreaCanvasHandle = mountPrintAreaCanvas(root, ctx, {
    productKey: ctx.productKey,
    printAreaKey: firstDefault?.print_area_key || "front",
    imageUrl,
    rect: firstDefault?.print_area_rect_json || { x: 0.2, y: 0.2, w: 0.45, h: 0.45 },
    mockupRect: firstDefault?.mockup_print_area_rect_json || null,
    universalRect: firstDefault?.universal_print_area_rect_json || null,
  });

  root.querySelector("#ce-pa-load-printify")?.addEventListener("click", async () => {
    const pid = ctx.selectedPrintProviderId;
    const version = (ctx.printAreaData?.versions || []).find((v) => String(v.id) === String(ctx.selectedVersionId));
    const printifyProductId =
      version?.external_template_product_id ||
      (ctx.templateData?.template?.printify_product_id || ctx.templateData?.version?.external_template_product_id);
    if (!pid || !printifyProductId) return;
    await loadPrintifySettings({
      product_key: ctx.productKey,
      print_provider_id: pid,
      version_id: ctx.selectedVersionId,
      printify_product_id: printifyProductId,
      design_type: ctx.selectedDesignType || "classic",
      auto_mirror: false,
    });
    ctx.reloadTab();
  });
}

export async function savePrintAreaTab(ctx) {
  const versionId = ctx.selectedVersionId;
  if (!versionId) return;
  let studio_config = {};
  let qr_logo_snapshot = null;
  try {
    studio_config = JSON.parse(document.getElementById("ce-pa-studio")?.value || "{}");
    const qrRaw = document.getElementById("ce-pa-qr")?.value?.trim();
    if (qrRaw) qr_logo_snapshot = JSON.parse(qrRaw);
  } catch {
    throw new Error("Invalid print area JSON");
  }
  await savePrintAreaSnapshot(versionId, { studio_config, qr_logo_snapshot, auto_mirror: false });
  const cfgRaw = document.getElementById("ce-pa-config")?.value?.trim();
  if (cfgRaw && ctx.selectedPrintProviderId) {
    let config = {};
    try {
      config = JSON.parse(cfgRaw);
    } catch {
      throw new Error("Invalid print areas config JSON");
    }
    await savePrintAreasConfig({
      product_key: ctx.productKey,
      print_provider_id: ctx.selectedPrintProviderId,
      config,
      auto_mirror: false,
    });
  }
}
