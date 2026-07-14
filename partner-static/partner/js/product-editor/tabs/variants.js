import { escapeHtml } from "/shared/js/partner-api.js";
import { openModal, showToast } from "/shared/js/partner-shell.js";

const COLOR_NAME_PRESETS = {
  black: "#000000",
  white: "#ffffff",
  red: "#dc2626",
  blue: "#2563eb",
  navy: "#1e3a5f",
  green: "#16a34a",
  "forest green": "#228b22",
  "dark green": "#006400",
  yellow: "#eab308",
  orange: "#f97316",
  pink: "#ec4899",
  "light pink": "#f9a8d4",
  purple: "#9333ea",
  grey: "#6b7280",
  gray: "#6b7280",
  "dark heather": "#4a4a4a",
  "sport grey": "#999999",
  heather: "#b0b0b0",
  maroon: "#800000",
  sand: "#c2b280",
  cream: "#fffdd0",
  beige: "#f5f5dc",
  brown: "#92400e",
  royal: "#4169e1",
  charcoal: "#36454f",
  "dark grey": "#555555",
  "light blue": "#93c5fd",
  indigo: "#4f46e5",
  daisy: "#fef08a",
  coral: "#f87171",
  teal: "#14b8a6",
  burgundy: "#800020",
  olive: "#808000",
  khaki: "#c3b091",
  gold: "#d4a017",
  silver: "#c0c0c0",
  tan: "#d2b48c",
};

const DEFAULT_HEX = "#808080";

function normalizeHex(raw, fallback = DEFAULT_HEX) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
  if (/^#[0-9a-f]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  return fallback;
}

function presetHexFromTitle(title) {
  const lower = String(title || "")
    .toLowerCase()
    .trim();
  if (!lower) return DEFAULT_HEX;
  if (COLOR_NAME_PRESETS[lower]) return COLOR_NAME_PRESETS[lower];
  const keys = Object.keys(COLOR_NAME_PRESETS).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (lower.includes(key) || key.includes(lower)) return COLOR_NAME_PRESETS[key];
  }
  return DEFAULT_HEX;
}

function slugViewKey(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function ensureViews(ctx) {
  if (!Array.isArray(ctx.localViews)) {
    ctx.localViews = [...(ctx.bundle?.views || [])];
  }
  return ctx.localViews;
}

function buildTreeFromBundle(ctx) {
  const variants = ctx.bundle?.variants || [];
  const hexFromBundle = ctx.localColorHexes || ctx.bundle?.color_hexes || {};
  const byColor = new Map();

  for (const v of variants) {
    const color = String(v.color || "").trim();
    const size = String(v.size || "").trim();
    if (!color || !size) continue;
    if (!byColor.has(color)) {
      const attrs = v.attributes || {};
      const hex = normalizeHex(attrs.color_hex || hexFromBundle[color] || "", "");
      byColor.set(color, {
        color,
        color_hex: hex || "",
        color_hex_from_store: !!hex,
        sizes: [],
      });
    }
    const entry = byColor.get(color);
    if (!entry.sizes.some((s) => s.size === size)) {
      entry.sizes.push({
        size,
        cost_major: (Number(v.base_cost_cents) || 0) / 100,
      });
    }
    if (!entry.color_hex) {
      const attrs = v.attributes || {};
      const hex = normalizeHex(attrs.color_hex || hexFromBundle[color] || "", "");
      if (hex) {
        entry.color_hex = hex;
        entry.color_hex_from_store = true;
      }
    }
  }

  if (!byColor.size) {
    const colors = [...(ctx.localColors || ctx.bundle?.colors || [])].filter(Boolean);
    const sizes = [...(ctx.localSizes || ctx.bundle?.sizes || [])].filter(Boolean);
    // No invented Black/S/M/L — empty until partner adds a variant color.
    if (!colors.length) return [];
    const sizeList = sizes.length ? sizes : ["S", "M", "L"];
    for (const color of colors) {
      const hex = normalizeHex(hexFromBundle[color] || "", "");
      byColor.set(color, {
        color,
        color_hex: hex || "",
        color_hex_from_store: !!hex,
        sizes: sizeList.map((size) => ({ size, cost_major: 0 })),
      });
    }
  }

  return [...byColor.values()].map((row) => ({
    ...row,
    color_hex: row.color_hex || presetHexFromTitle(row.color),
  }));
}

function ensureVariantTree(ctx) {
  if (!Array.isArray(ctx.localVariantTree)) {
    ctx.localVariantTree = buildTreeFromBundle(ctx);
  }
  return ctx.localVariantTree;
}

function syncTreeDerived(ctx) {
  const tree = ensureVariantTree(ctx);
  ctx.localColors = tree.map((r) => r.color).filter(Boolean);
  ctx.localSizes = [...new Set(tree.flatMap((r) => r.sizes.map((s) => s.size).filter(Boolean)))];
  ctx.localColorHexes = {};
  for (const row of tree) {
    if (row.color) ctx.localColorHexes[row.color] = normalizeHex(row.color_hex || presetHexFromTitle(row.color));
  }
}

function mockupUrlForColor(ctx, color) {
  const mocks = ctx.localMockups || ctx.bundle?.mockups || [];
  const match =
    mocks.find((m) => String(m.color_key || "").trim() === color && (m.image_url || m.image_r2_key)) ||
    mocks.find(
      (m) =>
        String(m.color_key || "")
          .trim()
          .toLowerCase() === String(color).toLowerCase() && (m.image_url || m.image_r2_key)
    );
  return match?.image_url || null;
}

function sampleAverageHexFromImage(url) {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const size = 32;
        canvas.width = size;
        canvas.height = size;
        const c2d = canvas.getContext("2d", { willReadFrequently: true });
        if (!c2d) {
          resolve(null);
          return;
        }
        c2d.drawImage(img, 0, 0, size, size);
        const data = c2d.getImageData(0, 0, size, size).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 32) continue;
          // Skip near-white / near-transparent background noise lightly
          const rr = data[i];
          const gg = data[i + 1];
          const bb = data[i + 2];
          if (rr > 245 && gg > 245 && bb > 245) continue;
          r += rr;
          g += gg;
          b += bb;
          n += 1;
        }
        if (!n) {
          resolve(null);
          return;
        }
        const toHex = (v) => Math.round(v / n).toString(16).padStart(2, "0");
        resolve(`#${toHex(r)}${toHex(g)}${toHex(b)}`);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function autofillHexFromMockups(ctx) {
  const tree = ensureVariantTree(ctx);
  let changed = false;
  await Promise.all(
    tree.map(async (row) => {
      // Keep saved or manually picked hexes; only fill missing / provisional values
      if (row.color_hex_manual || row.color_hex_from_store) return;
      const url = mockupUrlForColor(ctx, row.color);
      if (!url) {
        const next = presetHexFromTitle(row.color);
        if (row.color_hex !== next) {
          row.color_hex = next;
          changed = true;
        }
        return;
      }
      const sampled = await sampleAverageHexFromImage(url);
      const next = sampled || presetHexFromTitle(row.color);
      if (row.color_hex !== next) {
        row.color_hex = next;
        changed = true;
      }
    })
  );
  if (changed) syncTreeDerived(ctx);
  return changed;
}

function iconEdit() {
  return `<svg class="pe-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M11.7 1.3a1.5 1.5 0 0 1 2.1 2.1l-.6.6-2.1-2.1.6-.6ZM9.5 3.5 2 11v3h3l7.5-7.5-3-3Z"/></svg>`;
}

function iconRemove() {
  return `<svg class="pe-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4.2 3.2 8 7l3.8-3.8 1 1L9 8l3.8 3.8-1 1L8 9l-3.8 3.8-1-1L7 8 3.2 4.2l1-1Z"/></svg>`;
}

function renderViewChips(ctx) {
  const views = ensureViews(ctx);
  if (!views.length) {
    return `<p class="ce-hint pe-empty-hint">No views yet. Use Add View to create one.</p>`;
  }
  return `<div class="pe-view-chips" role="list">
    ${views
      .map(
        (v, i) => `<div class="pe-view-chip" role="listitem" data-view-idx="${i}" title="${escapeHtml(v.view_key)}${v.printable ? "" : " · not printable"}">
      <span class="pe-view-chip__label">${escapeHtml(v.label || v.view_key)}</span>
      <button type="button" class="pe-icon-btn pe-edit-view" data-idx="${i}" aria-label="Edit view">${iconEdit()}</button>
      <button type="button" class="pe-icon-btn pe-rm-view" data-idx="${i}" aria-label="Remove view">${iconRemove()}</button>
    </div>`
      )
      .join("")}
  </div>`;
}

function renderVariantTree(ctx) {
  const tree = ensureVariantTree(ctx);
  const currency = ctx.localCurrency || ctx.bundle?.product?.currency || "EUR";
  if (!tree.length) {
    return `<p class="ce-hint pe-empty-hint">No variants yet. Use Add Variant to add a color.</p>`;
  }
  return tree
    .map((row, colorIdx) => {
      const hex = normalizeHex(row.color_hex || presetHexFromTitle(row.color));
      const sizeRows = (row.sizes || [])
        .map(
          (sz, sizeIdx) => `<div class="pe-var-size-row" data-color-idx="${colorIdx}" data-size-idx="${sizeIdx}">
          <span class="pe-var-tree-guide" aria-hidden="true"></span>
          <div class="field pe-var-size-name">
            <label class="visually-hidden">Size</label>
            <input class="input input-sm pe-size-name" type="text" value="${escapeHtml(sz.size)}" placeholder="Size" data-color-idx="${colorIdx}" data-size-idx="${sizeIdx}" />
          </div>
          <div class="field pe-var-size-price">
            <label class="visually-hidden">Price (${escapeHtml(currency)})</label>
            <div class="pe-price-wrap">
              <span class="pe-price-currency">${escapeHtml(currency)}</span>
              <input class="input input-sm pe-size-cost" type="number" step="0.01" min="0" value="${escapeHtml(sz.cost_major ?? "")}" data-color-idx="${colorIdx}" data-size-idx="${sizeIdx}" />
            </div>
          </div>
          <button type="button" class="pe-icon-btn pe-rm-size" data-color-idx="${colorIdx}" data-size-idx="${sizeIdx}" aria-label="Remove size">${iconRemove()}</button>
        </div>`
        )
        .join("");

      return `<div class="pe-var-color" data-color-idx="${colorIdx}">
        <div class="pe-var-color-row">
          <label class="pe-color-dot" title="Color swatch">
            <input type="color" class="pe-color-picker" value="${escapeHtml(hex)}" data-color-idx="${colorIdx}" aria-label="Pick color for ${escapeHtml(row.color)}" />
            <span class="pe-color-dot__swatch" style="background:${escapeHtml(hex)}"></span>
          </label>
          <div class="field pe-var-color-name">
            <label class="visually-hidden">Color name</label>
            <input class="input input-sm pe-color-name" type="text" value="${escapeHtml(row.color)}" placeholder="Color name" data-color-idx="${colorIdx}" />
          </div>
          <code class="pe-hex-code">${escapeHtml(hex)}</code>
          <button type="button" class="btn btn-secondary btn-sm pe-add-size" data-color-idx="${colorIdx}">Add Size</button>
          <button type="button" class="pe-icon-btn pe-rm-color" data-color-idx="${colorIdx}" aria-label="Remove color">${iconRemove()}</button>
        </div>
        <div class="pe-var-size-list">${sizeRows || `<p class="ce-hint pe-var-size-empty">No sizes — add one under this color.</p>`}</div>
      </div>`;
    })
    .join("");
}

export function renderVariantsTab(ctx) {
  ensureViews(ctx);
  ensureVariantTree(ctx);
  syncTreeDerived(ctx);
  const currency = ctx.localCurrency || ctx.bundle?.product?.currency || "EUR";
  const viewsOpen = ctx.uiCollapse?.views !== false;
  const variantsOpen = ctx.uiCollapse?.variants !== false;

  return `
    <div class="ce-tab-panel pe-variants-panel">
      <details class="pe-collapse" id="pe-collapse-views" ${viewsOpen ? "open" : ""}>
        <summary class="pe-collapse__summary">
          <span class="pe-collapse__title">Views</span>
          <span class="pe-collapse__hint">Mockup slots &amp; printable sides</span>
        </summary>
        <div class="pe-collapse__body">
          <p class="ce-hint">Views define mockup slots and printable sides. Add each side you need (e.g. Front, Back).</p>
          <div class="ce-inline-actions pe-collapse__actions">
            <button type="button" class="btn btn-primary btn-sm" id="pe-add-view">Add View</button>
          </div>
          <div id="pe-views-list" class="pe-views-list">${renderViewChips(ctx)}</div>
        </div>
      </details>

      <details class="pe-collapse" id="pe-collapse-variants" ${variantsOpen ? "open" : ""}>
        <summary class="pe-collapse__summary">
          <span class="pe-collapse__title">Colors &amp; sizes</span>
          <span class="pe-collapse__hint">Wholesale cost per size</span>
        </summary>
        <div class="pe-collapse__body">
          <p class="ce-hint">Sizes share the same mockup per color. Costs are wholesale / purchase price in the product currency. Color dots default from mockups or the color name; you can override them.</p>
          <div class="pe-var-toolbar">
            <button type="button" class="btn btn-primary btn-sm" id="pe-add-variant">Add Variant</button>
            <div class="field pe-var-currency-field">
              <label for="pe-var-currency">Currency</label>
              <select class="input input-sm" id="pe-var-currency">
                ${["EUR", "USD", "MAD", "GBP"].map((c) => `<option value="${c}" ${currency === c ? "selected" : ""}>${c}</option>`).join("")}
              </select>
            </div>
            <div class="field pe-var-setall-field">
              <label for="pe-set-all-price">Price</label>
              <div class="pe-setall-row">
                <input class="input input-sm" id="pe-set-all-price" type="number" step="0.01" min="0" placeholder="0.00" />
                <button type="button" class="btn btn-secondary btn-sm" id="pe-set-all-btn">Set All</button>
              </div>
            </div>
          </div>
          <div id="pe-variant-tree" class="pe-var-tree">${renderVariantTree(ctx)}</div>
        </div>
      </details>
    </div>`;
}

export function snapshotVariantsTab(ctx) {
  syncTreeDerived(ctx);
  const tree = ensureVariantTree(ctx);
  const currency = document.getElementById("pe-var-currency")?.value || ctx.localCurrency || "EUR";
  const costs_major = {};
  const color_hexes = {};
  for (const row of tree) {
    const color = String(row.color || "").trim();
    if (!color) continue;
    color_hexes[color] = normalizeHex(row.color_hex || presetHexFromTitle(color));
    for (const sz of row.sizes || []) {
      const size = String(sz.size || "").trim();
      if (!size) continue;
      costs_major[`${color}||${size}`] = Number(sz.cost_major) || 0;
    }
  }
  return {
    views: [...ensureViews(ctx)],
    colors: Object.keys(color_hexes),
    sizes: [...new Set(tree.flatMap((r) => (r.sizes || []).map((s) => String(s.size || "").trim()).filter(Boolean)))],
    currency,
    costs_major,
    color_hexes,
  };
}

function rememberCollapse(ctx, root) {
  if (!ctx.uiCollapse) ctx.uiCollapse = {};
  const views = root.querySelector("#pe-collapse-views");
  const variants = root.querySelector("#pe-collapse-variants");
  if (views) ctx.uiCollapse.views = views.open;
  if (variants) ctx.uiCollapse.variants = variants.open;
}

function openViewModal(ctx, editIdx = null) {
  const existing = editIdx != null ? ensureViews(ctx)[editIdx] : null;
  const isEdit = !!existing;
  openModal({
    title: isEdit ? "Edit View" : "Add View",
    bodyHtml: `
      <div class="field">
        <label for="pe-view-modal-key">View key</label>
        <input class="input" id="pe-view-modal-key" value="${escapeHtml(existing?.view_key || "")}" placeholder="e.g. lifestyle" ${isEdit ? "readonly" : ""} />
      </div>
      <div class="field">
        <label for="pe-view-modal-label">Label</label>
        <input class="input" id="pe-view-modal-label" value="${escapeHtml(existing?.label || "")}" placeholder="Display name" />
      </div>
      <label class="pe-chip" style="margin-top:8px">
        <input type="checkbox" id="pe-view-modal-printable" ${existing?.printable === false ? "" : "checked"} /> Printable
      </label>`,
    onSave: async () => {
      const key = slugViewKey(document.getElementById("pe-view-modal-key")?.value);
      const label = document.getElementById("pe-view-modal-label")?.value?.trim() || key;
      const printable = document.getElementById("pe-view-modal-printable")?.checked !== false;
      if (!key) throw new Error("View key is required");
      const list = ensureViews(ctx);
      if (isEdit) {
        list[editIdx] = { ...list[editIdx], view_key: key, label, printable };
      } else {
        if (list.some((v) => v.view_key === key)) throw new Error("A view with this key already exists");
        list.push({ view_key: key, label, sort_order: list.length, printable });
      }
      ctx.markDirty?.();
      ctx.reloadTab?.();
    },
  });
}

function refreshTreeDom(ctx, root) {
  syncTreeDerived(ctx);
  const host = root.querySelector("#pe-variant-tree");
  if (host) host.innerHTML = renderVariantTree(ctx);
  bindTreeEvents(ctx, root);
  ctx.markDirty?.();
}

function bindTreeEvents(ctx, root) {
  root.querySelectorAll(".pe-color-name").forEach((input) => {
    input.addEventListener("change", () => {
      const idx = Number(input.dataset.colorIdx);
      const tree = ensureVariantTree(ctx);
      const row = tree[idx];
      if (!row) return;
      const next = String(input.value || "").trim() || "Color";
      row.color = next;
      if (!row.color_hex_manual) {
        row.color_hex = presetHexFromTitle(next);
      }
      refreshTreeDom(ctx, root);
    });
  });

  root.querySelectorAll(".pe-color-picker").forEach((input) => {
    input.addEventListener("input", () => {
      const idx = Number(input.dataset.colorIdx);
      const tree = ensureVariantTree(ctx);
      const row = tree[idx];
      if (!row) return;
      row.color_hex = normalizeHex(input.value);
      row.color_hex_manual = true;
      const swatch = root.querySelector(`.pe-var-color[data-color-idx="${idx}"] .pe-color-dot__swatch`);
      const code = root.querySelector(`.pe-var-color[data-color-idx="${idx}"] .pe-hex-code`);
      if (swatch) swatch.style.background = row.color_hex;
      if (code) code.textContent = row.color_hex;
      syncTreeDerived(ctx);
      ctx.markDirty?.();
    });
  });

  root.querySelectorAll(".pe-size-name").forEach((input) => {
    input.addEventListener("change", () => {
      const cIdx = Number(input.dataset.colorIdx);
      const sIdx = Number(input.dataset.sizeIdx);
      const tree = ensureVariantTree(ctx);
      const row = tree[cIdx];
      if (!row?.sizes?.[sIdx]) return;
      row.sizes[sIdx].size = String(input.value || "").trim() || "Size";
      syncTreeDerived(ctx);
      ctx.markDirty?.();
    });
  });

  root.querySelectorAll(".pe-size-cost").forEach((input) => {
    input.addEventListener("input", () => {
      const cIdx = Number(input.dataset.colorIdx);
      const sIdx = Number(input.dataset.sizeIdx);
      const tree = ensureVariantTree(ctx);
      const row = tree[cIdx];
      if (!row?.sizes?.[sIdx]) return;
      row.sizes[sIdx].cost_major = Number(input.value) || 0;
      syncTreeDerived(ctx);
      ctx.markDirty?.();
    });
  });

  root.querySelectorAll(".pe-add-size").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.colorIdx);
      const tree = ensureVariantTree(ctx);
      const row = tree[idx];
      if (!row) return;
      const used = new Set(row.sizes.map((s) => s.size));
      let n = 1;
      let name = "Size";
      while (used.has(name)) {
        n += 1;
        name = `Size ${n}`;
      }
      const setAll = Number(document.getElementById("pe-set-all-price")?.value);
      row.sizes.push({ size: name, cost_major: Number.isFinite(setAll) ? setAll : 0 });
      refreshTreeDom(ctx, root);
    });
  });

  root.querySelectorAll(".pe-rm-size").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cIdx = Number(btn.dataset.colorIdx);
      const sIdx = Number(btn.dataset.sizeIdx);
      const tree = ensureVariantTree(ctx);
      const row = tree[cIdx];
      if (!row) return;
      row.sizes = row.sizes.filter((_, i) => i !== sIdx);
      refreshTreeDom(ctx, root);
    });
  });

  root.querySelectorAll(".pe-rm-color").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.colorIdx);
      ctx.localVariantTree = ensureVariantTree(ctx).filter((_, i) => i !== idx);
      refreshTreeDom(ctx, root);
    });
  });
}

export function bindVariantsTab(ctx, root) {
  ensureViews(ctx);
  ensureVariantTree(ctx);
  syncTreeDerived(ctx);

  root.querySelector("#pe-collapse-views")?.addEventListener("toggle", () => rememberCollapse(ctx, root));
  root.querySelector("#pe-collapse-variants")?.addEventListener("toggle", () => rememberCollapse(ctx, root));

  root.querySelector("#pe-var-currency")?.addEventListener("change", () => {
    ctx.localCurrency = document.getElementById("pe-var-currency")?.value || "EUR";
    refreshTreeDom(ctx, root);
  });

  root.querySelector("#pe-add-view")?.addEventListener("click", () => openViewModal(ctx, null));

  root.querySelectorAll(".pe-edit-view").forEach((btn) => {
    btn.addEventListener("click", () => openViewModal(ctx, Number(btn.dataset.idx)));
  });

  root.querySelectorAll(".pe-rm-view").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.idx);
      ctx.localViews = ensureViews(ctx).filter((_, i) => i !== idx);
      ctx.markDirty?.();
      ctx.reloadTab?.();
    });
  });

  root.querySelector("#pe-add-variant")?.addEventListener("click", () => {
    const tree = ensureVariantTree(ctx);
    const used = new Set(tree.map((r) => r.color.toLowerCase()));
    let n = 1;
    let name = "New color";
    while (used.has(name.toLowerCase())) {
      n += 1;
      name = `New color ${n}`;
    }
    const setAll = Number(document.getElementById("pe-set-all-price")?.value);
    const defaultSizes =
      tree[0]?.sizes?.length > 0
        ? tree[0].sizes.map((s) => ({ size: s.size, cost_major: Number.isFinite(setAll) ? setAll : 0 }))
        : [{ size: "M", cost_major: Number.isFinite(setAll) ? setAll : 0 }];
    tree.push({
      color: name,
      color_hex: presetHexFromTitle(name),
      color_hex_manual: false,
      sizes: defaultSizes,
    });
    refreshTreeDom(ctx, root);
    void autofillHexFromMockups(ctx).then((changed) => {
      if (changed) refreshTreeDom(ctx, root);
    });
  });

  root.querySelector("#pe-set-all-btn")?.addEventListener("click", () => {
    const price = Number(document.getElementById("pe-set-all-price")?.value);
    if (!Number.isFinite(price) || price < 0) {
      showToast("Price required", "Enter a price to apply to all sizes");
      return;
    }
    const tree = ensureVariantTree(ctx);
    for (const row of tree) {
      for (const sz of row.sizes) sz.cost_major = price;
    }
    refreshTreeDom(ctx, root);
  });

  bindTreeEvents(ctx, root);

  void autofillHexFromMockups(ctx).then((changed) => {
    if (!changed || !root.isConnected) return;
    // Update swatches quietly — auto-suggested hex does not dirty the tab until the user edits
    syncTreeDerived(ctx);
    const host = root.querySelector("#pe-variant-tree");
    if (host) host.innerHTML = renderVariantTree(ctx);
    bindTreeEvents(ctx, root);
  });
}
