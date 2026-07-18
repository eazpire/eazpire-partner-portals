/**
 * Catalog editor → Creator Settings (Skill Tree, preview images, print areas, EAZV).
 * Product metadata (brand/model/audience) lives on the Meta tab.
 */
import { escapeHtml, partnerUpload } from "/partner/shared/js/partner-api.js";
import { fetchCreatorSettings, saveCreatorSettings } from "../api.js";
import { bindTabDirtyInputs, notifyActiveTabDirty } from "../editor-tab-dirty.js";

function ensureState(ctx) {
  if (!ctx.creatorSettingsState) {
    ctx.creatorSettingsState = {
      loaded: false,
      data: null,
      creator_level: "starter",
      cost_eaz: 180,
      preview_images: [],
      variant_costs: [],
      print_areas: [],
      variantsOpen: true,
      printAreasOpen: true,
    };
  }
  return ctx.creatorSettingsState;
}

function levelOptionsHtml(selected, softstyleLocked) {
  const opts = [{ value: "starter", label: "Starter Products" }];
  for (let lv = 3; lv <= 10; lv++) {
    opts.push({ value: String(lv), label: `Level ${lv}` });
  }
  return opts
    .map((o) => {
      const disabled = softstyleLocked && o.value !== "starter" ? " disabled" : "";
      const sel = String(selected) === o.value ? " selected" : "";
      return `<option value="${escapeHtml(o.value)}"${sel}${disabled}>${escapeHtml(o.label)}</option>`;
    })
    .join("");
}

function previewGridHtml(images) {
  const tiles = [
    `<button type="button" class="ce-cs-preview-tile ce-cs-preview-tile--add" id="ce-cs-preview-add" aria-label="Upload preview image">
      <span class="ce-cs-preview-add-icon" aria-hidden="true">+</span>
      <span class="ce-cs-preview-add-label">Upload</span>
    </button>`,
  ];
  (images || []).forEach((item, idx) => {
    const url = typeof item === "string" ? item : item?.url;
    if (!url) return;
    tiles.push(
      `<div class="ce-cs-preview-tile" data-preview-idx="${idx}">
        <img src="${escapeHtml(url)}" alt="" loading="lazy" />
        <button type="button" class="ce-cs-preview-remove" data-preview-remove="${idx}" aria-label="Remove image">×</button>
      </div>`
    );
  });
  return `<div class="ce-cs-preview-grid">${tiles.join("")}</div>
    <input type="file" id="ce-cs-preview-file" accept="image/png,image/jpeg,image/webp" multiple hidden />`;
}

function variantCostsHtml(variants, open) {
  if (!variants?.length) {
    return `<p class="ce-hint">No variant unlock nodes for this product yet (Softstyle color/size tree syncs from Variants).</p>`;
  }
  const rows = variants
    .map((v) => {
      return `<label class="ce-cs-variant-row">
        <span class="ce-cs-variant-title">${escapeHtml(v.title || v.node_key)}
          <span class="ce-cs-variant-kind">${escapeHtml(v.kind || "")}</span>
        </span>
        <input type="number" class="input ce-cs-variant-cost" min="0" step="1"
          data-variant-node="${escapeHtml(v.node_key)}" value="${escapeHtml(String(v.cost_eaz ?? 60))}" />
      </label>`;
    })
    .join("");

  return `
    <details class="ce-cs-variants" ${open ? "open" : ""}>
      <summary class="ce-cs-variants__summary">Variant EAZV costs (${variants.length})</summary>
      <div class="ce-cs-variants__toolbar">
        <label class="ce-cs-bulk">
          <span>Bulk value</span>
          <input type="number" class="input" id="ce-cs-bulk-cost" min="0" step="1" value="60" />
        </label>
        <button type="button" class="btn btn-secondary" id="ce-cs-bulk-apply">Apply to all variants</button>
      </div>
      <div class="ce-cs-variants__list">${rows}</div>
    </details>`;
}

function printAreasHtml(areas, open) {
  if (!areas?.length) {
    return `<p class="ce-hint">No print areas found for this product yet (configure on Print Area / Templates).</p>`;
  }
  const rows = areas
    .map((a) => {
      const key = a.key || a.position;
      const checked = a.enabled !== false ? " checked" : "";
      return `<label class="ce-cs-print-row">
        <input type="checkbox" class="ce-cs-print-check" data-print-area="${escapeHtml(key)}"${checked} />
        <span>${escapeHtml(a.label || key)}</span>
      </label>`;
    })
    .join("");
  return `
    <details class="ce-cs-print-areas" ${open ? "open" : ""}>
      <summary class="ce-cs-print-areas__summary">Print Areas (${areas.length})</summary>
      <p class="ce-hint">Enabled areas appear in the Creator Journey product skill info → Print Areas tab.</p>
      <div class="ce-cs-print-areas__list">${rows}</div>
    </details>`;
}

export async function loadCreatorSettingsTab(ctx) {
  const state = ensureState(ctx);
  const data = await fetchCreatorSettings(ctx.productKey);
  state.loaded = true;
  state.data = data;
  state.creator_level = data.creator_level === "starter" ? "starter" : String(data.creator_level);
  state.cost_eaz = Number(data.cost_eaz) || 180;
  state.preview_images = (data.preview_images || []).map((p) => (typeof p === "string" ? p : p.url)).filter(Boolean);
  state.variant_costs = Array.isArray(data.variant_costs) ? data.variant_costs : [];
  state.print_areas = Array.isArray(data.print_areas) ? data.print_areas : [];

  const softstyleLocked = !!data.skill_tree?.softstyle_locked_starter;
  const skill = data.skill_tree || {};

  return `
    <div class="ce-tab-panel ce-cs-panel">
      <section class="ce-meta-card">
        <h3 class="ce-section-title">Skill Tree</h3>
        <p class="ce-hint">How this product appears in Creator Journey → Unlock Tree → Products.</p>
        <dl class="ce-cs-skill-summary">
          <div><dt>Node</dt><dd><code>${escapeHtml(skill.node_key || `product:${ctx.productKey}`)}</code></dd></div>
          <div><dt>Current placement</dt><dd>${
            skill.is_starter
              ? "Starter Products"
              : `Level ${escapeHtml(String(skill.min_level || 3))}`
          }</dd></div>
          ${
            softstyleLocked
              ? "<div><dt>Note</dt><dd>Unisex Softstyle Cotton Tee is always a Starter product (color → size drill-down).</dd></div>"
              : ""
          }
        </dl>
      </section>

      <section class="ce-meta-card">
        <h3 class="ce-section-title">Preview Image</h3>
        <p class="ce-hint">Skill Tree card image — first image wins. Defaults come from Admin Mockups → Preview Images.</p>
        ${previewGridHtml(state.preview_images)}
      </section>

      <section class="ce-meta-card">
        <h3 class="ce-section-title">Creator Level</h3>
        <p class="ce-hint">Starter Products = free first-pick carousel. Levels 3–10 = locked until that display level.</p>
        <div class="field">
          <label for="ce-cs-level">Creator Level</label>
          <select class="input" id="ce-cs-level">
            ${levelOptionsHtml(state.creator_level, softstyleLocked)}
          </select>
        </div>
      </section>

      <section class="ce-meta-card">
        <h3 class="ce-section-title">EAZV Costs</h3>
        <p class="ce-hint">Cost to unlock the product itself, plus optional per-variant costs.</p>
        <div class="field">
          <label for="ce-cs-product-cost">Product unlock (EAZV)</label>
          <input type="number" class="input" id="ce-cs-product-cost" min="0" step="1"
            value="${escapeHtml(String(state.cost_eaz))}" />
        </div>
        ${variantCostsHtml(state.variant_costs, state.variantsOpen)}
      </section>

      <section class="ce-meta-card">
        <h3 class="ce-section-title">Print Areas</h3>
        ${printAreasHtml(state.print_areas, state.printAreasOpen)}
        <p class="ce-hint">Brand / model / audience metadata is on the <strong>Meta</strong> tab.</p>
      </section>
    </div>`;
}

export function snapshotCreatorSettingsTab(ctx) {
  const state = ensureState(ctx);
  const levelEl = document.getElementById("ce-cs-level");
  const costEl = document.getElementById("ce-cs-product-cost");
  const variantInputs = document.querySelectorAll(".ce-cs-variant-cost");
  const variants = [];
  variantInputs.forEach((input) => {
    variants.push({
      node_key: input.getAttribute("data-variant-node"),
      cost_eaz: Number(input.value) || 0,
    });
  });
  const printEnabled = [];
  document.querySelectorAll(".ce-cs-print-check:checked").forEach((input) => {
    const key = input.getAttribute("data-print-area");
    if (key) printEnabled.push(key);
  });
  return {
    creator_level: levelEl?.value || state.creator_level || "starter",
    cost_eaz: Number(costEl?.value) || 0,
    preview_images: [...(state.preview_images || [])],
    variant_costs: variants,
    print_areas_enabled: printEnabled,
  };
}

async function refreshPreviewGrid(ctx, root) {
  const state = ensureState(ctx);
  const sections = root.querySelectorAll(".ce-meta-card");
  const previewSection = [...sections].find((s) => s.querySelector(".ce-cs-preview-grid"));
  if (!previewSection) return;
  const hint = previewSection.querySelector(".ce-hint");
  const title = previewSection.querySelector(".ce-section-title");
  previewSection.innerHTML =
    (title ? title.outerHTML : '<h3 class="ce-section-title">Preview Image</h3>') +
    (hint
      ? hint.outerHTML
      : '<p class="ce-hint">Skill Tree card image — first image wins. Defaults come from Admin Mockups → Preview Images.</p>') +
    previewGridHtml(state.preview_images);
  bindPreviewControls(ctx, root);
  notifyActiveTabDirty(ctx);
}

function bindPreviewControls(ctx, root) {
  const state = ensureState(ctx);
  const addBtn = root.querySelector("#ce-cs-preview-add");
  const fileInput = root.querySelector("#ce-cs-preview-file");
  if (addBtn && fileInput) {
    addBtn.onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      const files = [...(fileInput.files || [])];
      fileInput.value = "";
      for (const file of files) {
        try {
          const res = await partnerUpload("admin-eazpire-creator-settings-image-upload", file, {
            query: { product_key: ctx.productKey },
          });
          const url = res.image_url;
          if (url && !state.preview_images.includes(url)) {
            state.preview_images.push(url);
          }
        } catch (err) {
          console.warn("[creator-settings] upload failed", err);
        }
      }
      await refreshPreviewGrid(ctx, root);
    };
  }
  root.querySelectorAll("[data-preview-remove]").forEach((btn) => {
    btn.onclick = async () => {
      const idx = Number(btn.getAttribute("data-preview-remove"));
      if (!Number.isFinite(idx)) return;
      state.preview_images.splice(idx, 1);
      await refreshPreviewGrid(ctx, root);
    };
  });
}

export function bindCreatorSettingsTab(ctx, root) {
  const state = ensureState(ctx);
  bindTabDirtyInputs(root, ctx);
  bindPreviewControls(ctx, root);

  const bulkBtn = root.querySelector("#ce-cs-bulk-apply");
  const bulkInput = root.querySelector("#ce-cs-bulk-cost");
  if (bulkBtn && bulkInput) {
    bulkBtn.onclick = () => {
      const value = Number(bulkInput.value) || 0;
      root.querySelectorAll(".ce-cs-variant-cost").forEach((input) => {
        input.value = String(value);
      });
      notifyActiveTabDirty(ctx);
    };
  }

  const details = root.querySelector(".ce-cs-variants");
  if (details) {
    details.addEventListener("toggle", () => {
      state.variantsOpen = details.open;
    });
  }
  const printDetails = root.querySelector(".ce-cs-print-areas");
  if (printDetails) {
    printDetails.addEventListener("toggle", () => {
      state.printAreasOpen = printDetails.open;
    });
  }
}

export async function saveCreatorSettingsTab(ctx) {
  const snap = snapshotCreatorSettingsTab(ctx);
  await saveCreatorSettings(ctx.productKey, {
    creator_level: snap.creator_level,
    cost_eaz: snap.cost_eaz,
    preview_images: snap.preview_images,
    variant_costs: snap.variant_costs,
    print_areas_enabled: snap.print_areas_enabled,
  });
  ctx.creatorSettingsState = null;
}
