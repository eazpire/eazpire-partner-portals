import { escapeHtml } from "/partner/shared/js/partner-api.js";
import {
  saveMeta,
  fetchCreatorSettings,
  saveCreatorSettings,
  searchShopifyTaxonomy,
  resolveShopifyTaxonomy,
  fetchUsedShopifyTaxonomy,
} from "../api.js";
import { bindTabDirtyInputs, notifyActiveTabDirty } from "../editor-tab-dirty.js";
import { publishProfileForProvider } from "../editor-product-title.js";

function resolveMetaProviderId(ctx) {
  return (
    Number(
      ctx.selectedPrintProviderId ||
        ctx.bundle.active_providers?.[0]?.print_provider_id ||
        ctx.bundle.publish_profiles?.[0]?.print_provider_id
    ) || null
  );
}

function skillMetaSectionHtml(meta) {
  const audienceStr = Array.isArray(meta?.audience) ? meta.audience.join(", ") : String(meta?.audience || "");
  return `
    <section class="ce-meta-card ce-meta-card--product-meta">
      <h3 class="ce-section-title">Product metadata</h3>
      <p class="ce-hint">General product metadata (skill info, shop facets, listing). Leave blank to use catalog/blueprint defaults.</p>
      <div class="field">
        <label for="ce-meta-brand">Base product brand</label>
        <input class="input" id="ce-meta-brand" value="${escapeHtml(meta?.provider_brand || "")}" placeholder="e.g. Gildan" />
      </div>
      <div class="field">
        <label for="ce-meta-model">Base product model</label>
        <input class="input" id="ce-meta-model" value="${escapeHtml(meta?.base_product_model || "")}" placeholder="e.g. Softstyle" />
      </div>
      <div class="field">
        <label for="ce-meta-audience">Audience (comma-separated)</label>
        <input class="input" id="ce-meta-audience" value="${escapeHtml(audienceStr)}" placeholder="e.g. Men, Women, Unisex" />
      </div>
    </section>`;
}

function categoryFieldHtml(profile) {
  const gid = profile?.shopify_category_id || "";
  const path = profile?.shopify_category_name || "";
  return `
    <div class="field ce-shopify-cat-field">
      <label>Shopify category</label>
      <div class="ce-shopify-cat-path" id="ce-meta-shopify-cat-path" title="${escapeHtml(path || "No category selected")}">
        ${escapeHtml(path || "No category selected — click Set to choose")}
      </div>
      <div class="ce-shopify-cat-row">
        <input
          class="input"
          id="ce-meta-shopify-cat"
          value="${escapeHtml(gid)}"
          readonly
          aria-readonly="true"
          placeholder="gid://shopify/TaxonomyCategory/…"
        />
        <button type="button" class="btn btn-secondary" id="ce-meta-shopify-cat-set">Set</button>
      </div>
      <input type="hidden" id="ce-meta-shopify-cat-name" value="${escapeHtml(path)}" />
      <p class="ce-hint">Category ID is read-only. Use Set to open the Shopify taxonomy finder. Changes apply when you Save this tab.</p>
    </div>`;
}

export async function loadMetaTab(ctx) {
  const providerId = resolveMetaProviderId(ctx);
  const profile = publishProfileForProvider(ctx.bundle, providerId);

  let skillMeta = { provider_brand: "", base_product_model: "", audience: [] };
  try {
    const data = await fetchCreatorSettings(ctx.productKey);
    skillMeta = data?.skill_meta || skillMeta;
  } catch (err) {
    console.warn("[meta] skill_meta load failed", err);
  }

  // Resolve breadcrumb when we only have a GID stored.
  let enriched = { ...profile };
  if (profile?.shopify_category_id && !profile?.shopify_category_name) {
    try {
      const res = await resolveShopifyTaxonomy(profile.shopify_category_id);
      if (res?.category?.full_path) {
        enriched = {
          ...profile,
          shopify_category_name: res.category.full_path,
        };
      }
    } catch (err) {
      console.warn("[meta] taxonomy resolve failed", err);
    }
  }

  return `
    <div class="ce-tab-panel ce-meta-panel">
      <section class="ce-meta-card ce-meta-card--shop">
        <h3 class="ce-section-title">Shop listing content</h3>
        <p class="ce-hint">Texts and Shopify category for the selected print provider. Product title and visibility are set per version on the Provider tab and in the footer.</p>
        ${categoryFieldHtml(enriched)}
        <div class="field">
          <label for="ce-meta-features">Product features</label>
          <textarea class="textarea" id="ce-meta-features" rows="4" placeholder="HTML or plain text">${escapeHtml(profile?.product_features || "")}</textarea>
        </div>
        <div class="field">
          <label for="ce-meta-care">Care instructions</label>
          <textarea class="textarea" id="ce-meta-care" rows="3">${escapeHtml(profile?.care_instructions || "")}</textarea>
        </div>
        <div class="field">
          <label for="ce-meta-size">Size table HTML</label>
          <textarea class="textarea" id="ce-meta-size" rows="3">${escapeHtml(profile?.size_table_html || "")}</textarea>
        </div>
        <div class="field">
          <label for="ce-meta-gpsr">GPSR HTML</label>
          <textarea class="textarea" id="ce-meta-gpsr" rows="2">${escapeHtml(profile?.gpsr_html || "")}</textarea>
        </div>
        <input type="hidden" id="ce-meta-provider-id" value="${escapeHtml(String(providerId || ""))}" />
      </section>
      ${skillMetaSectionHtml(skillMeta)}
    </div>`;
}

/** @deprecated use loadMetaTab — kept for any external callers */
export function renderMetaTab(ctx) {
  const providerId = resolveMetaProviderId(ctx);
  const profile = publishProfileForProvider(ctx.bundle, providerId);
  return `
    <div class="ce-tab-panel ce-meta-panel">
      <section class="ce-meta-card ce-meta-card--shop">
        <h3 class="ce-section-title">Shop listing content</h3>
        ${categoryFieldHtml(profile)}
        <input type="hidden" id="ce-meta-provider-id" value="${escapeHtml(String(providerId || ""))}" />
      </section>
    </div>`;
}

export function snapshotMetaTab() {
  const el = (id) => document.getElementById(id);
  const audienceRaw = el("ce-meta-audience")?.value || "";
  const audience = audienceRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    print_provider_id: Number(el("ce-meta-provider-id")?.value) || null,
    shopify_category_id: el("ce-meta-shopify-cat")?.value || null,
    shopify_category_name: el("ce-meta-shopify-cat-name")?.value || null,
    product_features: el("ce-meta-features")?.value || null,
    care_instructions: el("ce-meta-care")?.value || null,
    size_table_html: el("ce-meta-size")?.value || null,
    gpsr_html: el("ce-meta-gpsr")?.value || null,
    skill_meta: {
      provider_brand: el("ce-meta-brand")?.value || "",
      base_product_model: el("ce-meta-model")?.value || "",
      audience,
    },
  };
}

function applyCategoryToFields(categoryId, fullPath) {
  const idEl = document.getElementById("ce-meta-shopify-cat");
  const nameEl = document.getElementById("ce-meta-shopify-cat-name");
  const pathEl = document.getElementById("ce-meta-shopify-cat-path");
  if (idEl) idEl.value = categoryId || "";
  if (nameEl) nameEl.value = fullPath || "";
  if (pathEl) {
    pathEl.textContent = fullPath || "No category selected — click Set to choose";
    pathEl.title = fullPath || "No category selected";
  }
}

function ensureCategoryFinderModal() {
  let el = document.getElementById("ce-shopify-cat-modal");
  if (el) return el;
  el = document.createElement("div");
  el.id = "ce-shopify-cat-modal";
  el.className = "ce-shopify-cat-modal";
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("inert", "");
  el.innerHTML = `
    <div class="ce-shopify-cat-modal__backdrop" data-ce-cat-close></div>
    <div class="ce-shopify-cat-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="ce-shopify-cat-modal-title">
      <header class="ce-shopify-cat-modal__header">
        <h2 id="ce-shopify-cat-modal-title" class="ce-shopify-cat-modal__title">Set Shopify category</h2>
        <button type="button" class="btn btn-ghost btn-xs ce-shopify-cat-modal__close" data-ce-cat-close aria-label="Close">×</button>
      </header>
      <div class="ce-shopify-cat-modal__body">
        <div class="ce-shopify-cat-used">
          <p class="ce-shopify-cat-used__label">Already used</p>
          <div class="ce-shopify-cat-used__chips" id="ce-shopify-cat-used"></div>
        </div>
        <label class="ce-shopify-cat-search-label" for="ce-shopify-cat-search">Search</label>
        <input type="search" class="input" id="ce-shopify-cat-search" placeholder="e.g. Tank Tops, Hoodies, aa-1-13-8" autocomplete="off" />
        <p class="ce-hint" id="ce-shopify-cat-status">Loading taxonomy…</p>
        <ul class="ce-shopify-cat-list" id="ce-shopify-cat-list" role="listbox" aria-label="Shopify categories"></ul>
      </div>
      <footer class="ce-shopify-cat-modal__footer">
        <button type="button" class="btn btn-ghost" data-ce-cat-close>Cancel</button>
        <button type="button" class="btn btn-primary" id="ce-shopify-cat-apply" disabled>Set</button>
      </footer>
    </div>`;
  document.body.appendChild(el);
  return el;
}

function closeCategoryFinderModal() {
  const el = document.getElementById("ce-shopify-cat-modal");
  if (!el) return;
  el.classList.remove("is-open");
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("inert", "");
}

/**
 * @param {object} ctx
 */
async function openCategoryFinderModal(ctx) {
  const modal = ensureCategoryFinderModal();
  const listEl = modal.querySelector("#ce-shopify-cat-list");
  const usedEl = modal.querySelector("#ce-shopify-cat-used");
  const searchEl = modal.querySelector("#ce-shopify-cat-search");
  const statusEl = modal.querySelector("#ce-shopify-cat-status");
  const applyBtn = modal.querySelector("#ce-shopify-cat-apply");
  let selected = null;
  let searchTimer = null;

  const currentId = document.getElementById("ce-meta-shopify-cat")?.value || "";

  function renderList(categories) {
    if (!listEl) return;
    if (!categories.length) {
      listEl.innerHTML = `<li class="ce-shopify-cat-list__empty">No matches</li>`;
      return;
    }
    listEl.innerHTML = categories
      .map((c) => {
        const id = c.category_id || "";
        const path = c.full_path || c.full_name || id;
        const active = selected?.category_id === id || (!selected && id === currentId);
        return `<li>
          <button type="button" class="ce-shopify-cat-item${active ? " is-selected" : ""}"
            role="option" aria-selected="${active ? "true" : "false"}"
            data-cat-id="${escapeHtml(id)}" data-cat-path="${escapeHtml(path)}">
            <span class="ce-shopify-cat-item__path">${escapeHtml(path)}</span>
            <span class="ce-shopify-cat-item__id">${escapeHtml(c.category_short_id || id)}</span>
          </button>
        </li>`;
      })
      .join("");

    listEl.querySelectorAll("[data-cat-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selected = {
          category_id: btn.getAttribute("data-cat-id"),
          full_path: btn.getAttribute("data-cat-path"),
        };
        listEl.querySelectorAll(".ce-shopify-cat-item").forEach((el) => {
          el.classList.toggle("is-selected", el === btn);
          el.setAttribute("aria-selected", el === btn ? "true" : "false");
        });
        if (applyBtn) applyBtn.disabled = !selected?.category_id;
      });
    });
  }

  async function runSearch(q) {
    if (statusEl) statusEl.textContent = "Searching…";
    try {
      const res = await searchShopifyTaxonomy(q, 50);
      if (!res?.ok) throw new Error(res?.error || "search_failed");
      renderList(res.categories || []);
      if (statusEl) {
        const n = (res.categories || []).length;
        statusEl.textContent = q
          ? `${n} result${n === 1 ? "" : "s"}`
          : `Showing ${n} common categories — type to search all`;
      }
    } catch (err) {
      if (statusEl) statusEl.textContent = err?.message || "Search failed";
      renderList([]);
    }
  }

  // Used chips
  if (usedEl) {
    usedEl.innerHTML = `<span class="ce-hint">Loading…</span>`;
    try {
      const used = await fetchUsedShopifyTaxonomy();
      const cats = used?.categories || [];
      if (!cats.length) {
        usedEl.innerHTML = `<span class="ce-hint">None yet</span>`;
      } else {
        usedEl.innerHTML = cats
          .map((c) => {
            const path = c.full_path || c.category_id;
            return `<button type="button" class="ce-shopify-cat-chip" data-cat-id="${escapeHtml(
              c.category_id
            )}" data-cat-path="${escapeHtml(path)}" title="${escapeHtml(path)}">${escapeHtml(
              c.full_name || path.split(" > ").pop() || path
            )}</button>`;
          })
          .join("");
        usedEl.querySelectorAll("[data-cat-id]").forEach((btn) => {
          btn.addEventListener("click", () => {
            selected = {
              category_id: btn.getAttribute("data-cat-id"),
              full_path: btn.getAttribute("data-cat-path"),
            };
            if (applyBtn) applyBtn.disabled = false;
            usedEl.querySelectorAll(".ce-shopify-cat-chip").forEach((el) => {
              el.classList.toggle("is-selected", el === btn);
            });
            // Also highlight in list if present
            listEl?.querySelectorAll(".ce-shopify-cat-item").forEach((el) => {
              const match = el.getAttribute("data-cat-id") === selected.category_id;
              el.classList.toggle("is-selected", match);
            });
          });
        });
      }
    } catch {
      usedEl.innerHTML = `<span class="ce-hint">Could not load used categories</span>`;
    }
  }

  modal.querySelectorAll("[data-ce-cat-close]").forEach((btn) => {
    btn.onclick = () => closeCategoryFinderModal();
  });

  if (applyBtn) {
    applyBtn.disabled = true;
    applyBtn.onclick = () => {
      if (!selected?.category_id) return;
      applyCategoryToFields(selected.category_id, selected.full_path || "");
      closeCategoryFinderModal();
      notifyActiveTabDirty(ctx);
    };
  }

  if (searchEl) {
    searchEl.value = "";
    searchEl.oninput = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => runSearch(searchEl.value.trim()), 220);
    };
  }

  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  modal.removeAttribute("inert");
  await runSearch("");
  searchEl?.focus();
}

export function bindMetaTab(ctx, root) {
  bindTabDirtyInputs(root, ctx);
  root.querySelector("#ce-meta-shopify-cat-set")?.addEventListener("click", () => {
    void openCategoryFinderModal(ctx);
  });
}

export async function saveMetaTab(ctx) {
  const snap = snapshotMetaTab();
  const printProviderId =
    snap.print_provider_id ||
    ctx.selectedPrintProviderId ||
    ctx.bundle.active_providers?.[0]?.print_provider_id;

  await saveMeta(ctx.productKey, {
    print_provider_id: printProviderId,
    shopify_category_id: snap.shopify_category_id,
    shopify_category_name: snap.shopify_category_name,
    product_features: snap.product_features,
    care_instructions: snap.care_instructions,
    size_table_html: snap.size_table_html,
    gpsr_html: snap.gpsr_html,
    auto_mirror: false,
  });

  // Persist product metadata via creator-settings API (skill_meta_json) without wiping other fields.
  await saveCreatorSettings(ctx.productKey, {
    skill_meta_only: true,
    skill_meta: snap.skill_meta,
  });
}
