import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { showToast, confirmAction } from "/partner/shared/js/partner-shell.js";
import {
  fetchProvidersBundle,
  fetchProviderCatalogDetail,
  saveProviders,
  createVersion,
  deleteVersion,
  saveVersionConfig,
} from "../api.js";
import { renderVersionConfigPanel, collectVersionConfigPanel, collectPrintAreaDimensionUpdates } from "../version-config-panel.js";
import { renderInactivePrintAreasHtml } from "../provider-print-technical.js";
import { markEditorDirty, checkDirty } from "../editor-dirty.js";
import {
  groupProvidersByShipCountry,
  resolveProviderShipCountry,
  buildCountryFlagHtml,
} from "../provider-country-groups.js";
import {
  renderMarketCountryPicker,
  bindMarketCountryPicker,
  syncMarketCountryPickerFromDom,
  normalizeCountryCodeList,
  regionCodesFromCountryCodes,
} from "../market-country-picker.js";
import { publishPlanForProvider } from "../editor-product-title.js";
import { mergeVisibilityIntoVersionConfig, refreshVisibilityTriSwitch } from "../editor-visibility.js";
import { resolveActivePrintProviderIds } from "../active-provider-ids.js";

const CE_PROV_SIDEBAR_KEY = "admin_catalog_editor_prov_sidebar_collapsed";

function isProvSidebarCollapsed() {
  return sessionStorage.getItem(CE_PROV_SIDEBAR_KEY) === "1";
}

function providerId(fp) {
  const raw =
    fp?.print_provider_id ??
    fp?.external_provider_id ??
    fp?.catalogData?.id ??
    fp?.profile?.print_provider_id ??
    fp?.id;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0 && String(n) === String(raw).trim()) return n;
  const s = String(raw ?? "").trim();
  // Opaque partner ids (Todify ma-1) — keep string; never strip to trailing digits.
  if (/^[a-z][\w.-]*$/i.test(s)) return s;
  return NaN;
}

function rowFromBlueprintProvider(cp) {
  const pid = Number(cp?.id);
  return {
    type: "available",
    print_provider_id: pid,
    name: cp?.title || `Provider #${cp?.id}`,
    region: cp?.location?.country || "Other",
    locationLabel: cp?.location?.city ? `${cp.location.country} / ${cp.location.city}` : cp?.location?.country || "",
    locationDetail: cp?.location || null,
    catalogData: cp,
    is_enabled: false,
  };
}

function rowFromFulfillmentProvider(fp) {
  const raw = fp.external_provider_id;
  const n = Number(raw);
  const pid =
    Number.isFinite(n) && n > 0 && String(n) === String(raw).trim()
      ? n
      : String(raw || "").trim() || null;
  return {
    type: "configured",
    print_provider_id: pid,
    external_provider_id: fp.external_provider_id,
    name: fp.name || `Provider ${fp.external_provider_id}`,
    region: "Other",
    is_enabled: false,
  };
}

function buildProviderList(data) {
  const merged = Array.isArray(data.merged_providers) ? data.merged_providers : [];
  const filteredMerged = merged.filter((p) => {
    const id = providerId(p);
    return id != null && id !== "" && !(typeof id === "number" && !Number.isFinite(id));
  });
  if (filteredMerged.length) return filteredMerged;

  const fromBlueprint = (data.blueprint_providers || []).map(rowFromBlueprintProvider);
  if (fromBlueprint.length) return fromBlueprint;

  const fromFulfillment = (data.providers || []).map(rowFromFulfillmentProvider);
  return fromFulfillment.filter((p) => {
    const id = providerId(p);
    return id != null && id !== "" && !(typeof id === "number" && !Number.isFinite(id));
  });
}

function initProvidersState(ctx, data) {
  const merged = buildProviderList(data);
  const activeFromDb = resolveActivePrintProviderIds({
    active_providers: data.active_providers,
    merged_providers: merged,
    publish_plans: data.publish_plans,
    versions: data.versions,
  });

  const availableCount = merged.filter((p) => !activeFromDb.has(providerId(p))).length;
  const activeCount = merged.length - availableCount;

  ctx.providersTabState = {
    bundle: data,
    merged,
    activeIds: new Set(activeFromDb),
    selectedPid: null,
    sidebarFilter: activeCount > 0 && availableCount === 0 ? "active" : "available",
    catalogCache: new Map(),
    localVersions: new Map(),
    deletedVersionIds: [],
    pendingNewVersions: [],
    selectedVersionIdx: 0,
    printAreaDimEdits: new Map(),
    expandedCountries: new Set(),
    editingVersionId: null,
    marketEdits: new Map(),
  };

  for (const plan of data.publish_plans || []) {
    const pp = Number(plan?.profile?.print_provider_id ?? plan?.print_provider_id);
    if (!Number.isFinite(pp)) continue;
    let countryCodes = [];
    try {
      countryCodes = JSON.parse(plan.country_codes_json || "[]");
    } catch {
      countryCodes = [];
    }
    let normalized = normalizeCountryCodeList(countryCodes);
    const available = normalizeCountryCodeList(data.available_partner_countries || []);
    if (data.markets_mode === "partner" && available.length) {
      if (!normalized.length) normalized = [...available];
      else normalized = normalized.filter((cc) => available.includes(cc));
    }
    ctx.providersTabState.marketEdits.set(pp, {
      plan_id: plan.id,
      provider_name: plan.provider_name || "",
      country_codes: normalized,
      country_of_origin: String(plan.country_of_origin || "").trim().toUpperCase(),
    });
  }

  if (merged.length) {
    const first =
      merged.find((p) => activeFromDb.has(providerId(p))) ||
      merged.find((p) =>
        ctx.providersTabState.sidebarFilter === "available" ? !activeFromDb.has(providerId(p)) : activeFromDb.has(providerId(p))
      ) ||
      merged[0];
    ctx.providersTabState.selectedPid = providerId(first);
  }
}

function versionsForProvider(state, pid) {
  const key = String(pid);
  if (state.localVersions.has(key)) return state.localVersions.get(key);
  const fromBundle = (state.bundle.versions || []).filter((v) => String(v.external_provider_id) === key);
  const sorted = fromBundle.slice().sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));
  state.localVersions.set(key, sorted);
  return sorted;
}

function isProviderActive(state, pid) {
  return state.activeIds.has(Number(pid));
}

function filteredProviders(state) {
  const list = state.merged || [];
  if (state.sidebarFilter === "active") {
    return list.filter((p) => isProviderActive(state, providerId(p)));
  }
  return list.filter((p) => !isProviderActive(state, providerId(p)));
}

function providerLabel(fp) {
  return fp.name || fp.title || `Provider ${providerId(fp)}`;
}

function renderProviderListItem(fp, state) {
  const pid = providerId(fp);
  const active = isProviderActive(state, pid);
  const selected = state.selectedPid === pid;
  const ship = resolveProviderShipCountry(fp);
  const city = fp.locationDetail?.city || fp.catalogData?.location?.city;
  const locExtra = city ? ` · ${city}` : "";
  return `<li>
    <button type="button" class="ce-prov-list-item ${selected ? "active" : ""}" data-pid="${pid}">
      <span class="ce-prov-list-name">${escapeHtml(providerLabel(fp))}</span>
      <span class="ce-prov-list-meta">ID ${escapeHtml(String(pid))} · ${escapeHtml(ship.name)}${escapeHtml(locExtra)}</span>
      <span class="ce-prov-list-status ${active ? "is-active" : ""}">${active ? "Active" : "Available"}</span>
    </button>
  </li>`;
}

function renderProviderCountryGroups(list, state) {
  if (!list.length) {
    return `<p class="ce-hint ce-prov-list-empty">No providers in this list.</p>`;
  }
  const groups = groupProvidersByShipCountry(list, providerId);
  const expanded = state.expandedCountries || new Set();
  return groups
    .map((group) => {
      const isOpen = expanded.has(group.code);
      const flagHtml = buildCountryFlagHtml(group.code === "OTHER" ? "" : group.code, {
        className: "ce-prov-country-flag",
      });
      return `<details class="ce-prov-country-group" data-country="${escapeHtml(group.code)}"${isOpen ? " open" : ""}>
        <summary class="ce-prov-country-summary">
          ${flagHtml}
          <span class="ce-prov-country-name">${escapeHtml(group.name)}</span>
          <span class="ce-prov-country-count">${group.providers.length}</span>
        </summary>
        <div class="ce-prov-country-body">
          <ul class="ce-prov-list ce-prov-list--nested">
            ${group.providers.map((fp) => renderProviderListItem(fp, state)).join("")}
          </ul>
        </div>
      </details>`;
    })
    .join("");
}

function bindProviderListClicks(ctx, root, container) {
  container?.querySelectorAll(".ce-prov-list-item").forEach((btn) => {
    btn.onclick = () => selectProvider(ctx, root, Number(btn.dataset.pid));
  });
  container?.querySelectorAll(".ce-prov-country-group").forEach((details) => {
    details.addEventListener("toggle", () => {
      const code = details.dataset.country;
      if (!code || !ctx.providersTabState) return;
      if (details.open) ctx.providersTabState.expandedCountries.add(code);
      else ctx.providersTabState.expandedCountries.delete(code);
    });
  });
}

function renderVersionTabs(versions, selectedIdx, editingVersionId = null) {
  if (!versions.length) {
    return `<div class="ce-prov-version-tabs"><span class="ce-hint">No versions yet — activate provider to create Standard.</span></div>`;
  }
  const tabs = versions
    .map((v, idx) => {
      const isStd = idx === 0;
      const vid = v.id || v._tempId;
      const name = v.display_name || (isStd ? "Standard" : `Version ${idx + 1}`);
      const isEditing = String(editingVersionId) === String(vid);
      const canDelete = !isStd;
      const badge = isStd ? `<span class="ce-prov-ver-badge">Standard</span>` : "";
      const readonlyAttr = isEditing ? "" : " readonly";
      const editBtnClass = isEditing ? "ce-prov-ver-save" : "ce-prov-ver-edit";
      const editBtnLabel = isEditing ? "✓" : "✎";
      const editBtnTitle = isEditing ? "Save name" : "Edit name";
      const deleteBtn = canDelete
        ? `<button type="button" class="ce-prov-ver-del" data-version-id="${escapeHtml(String(vid))}" title="Delete version" aria-label="Delete version">×</button>`
        : "";
      return `<div class="ce-prov-ver-tab ${idx === selectedIdx ? "active" : ""}" data-ver-idx="${idx}" role="tab" tabindex="0">
        ${badge}
        <input type="text" class="input input-sm ce-prov-ver-name${isStd ? " ce-prov-ver-name--std" : ""}" data-version-id="${escapeHtml(String(vid))}" value="${escapeHtml(name)}" placeholder="${isStd ? "Product name" : "Version name"}"${readonlyAttr} />
        <button type="button" class="ce-prov-ver-action ${editBtnClass}" data-version-id="${escapeHtml(String(vid))}" title="${editBtnTitle}" aria-label="${editBtnTitle}">${editBtnLabel}</button>
        ${deleteBtn}
      </div>`;
    })
    .join("");
  return `<div class="ce-prov-version-tabs" role="tablist">${tabs}
    <button type="button" class="ce-prov-ver-tab ce-prov-ver-tab--add" id="ce-prov-add-version" title="Add version">+</button>
  </div>`;
}

function allLocalVersions(state) {
  const out = [];
  for (const versions of state.localVersions.values()) {
    out.push(...(versions || []));
  }
  const bundleVersions = state.bundle?.versions || [];
  for (const v of bundleVersions) {
    if (!out.some((x) => String(x.id || x._tempId) === String(v.id || v._tempId))) out.push(v);
  }
  return out;
}

function partnerAvailableCountries(state) {
  return normalizeCountryCodeList(state?.bundle?.available_partner_countries || []);
}

function marketsMode(state) {
  return state?.bundle?.markets_mode === "partner" ? "partner" : "full";
}

function marketStateForProvider(state, pid) {
  const key = Number(pid);
  if (!state.marketEdits.has(key)) {
    const plan = publishPlanForProvider(state.bundle, key);
    let countryCodes = [];
    try {
      countryCodes = JSON.parse(plan?.country_codes_json || "[]");
    } catch {
      countryCodes = [];
    }
    let normalized = normalizeCountryCodeList(countryCodes);
    const available = partnerAvailableCountries(state);
    // Partner/todify: only partner set is choosable; seed from partner when plan empty
    if (marketsMode(state) === "partner" && available.length) {
      if (!normalized.length) normalized = [...available];
      else normalized = normalized.filter((cc) => available.includes(cc));
    }
    state.marketEdits.set(key, {
      plan_id: plan?.id || null,
      provider_name: plan?.provider_name || "",
      country_codes: normalized,
      country_of_origin: String(plan?.country_of_origin || "").trim().toUpperCase(),
    });
  }
  return state.marketEdits.get(key);
}

function renderProviderMarketsSection(state, pid) {
  const market = marketStateForProvider(state, pid);
  const pickerId = `ce-prov-market-${pid}`;
  const partnerMode = marketsMode(state) === "partner";
  const allowed = partnerMode ? partnerAvailableCountries(state) : null;
  const hint = partnerMode
    ? "Only countries the partner selected for this product. Enable the ones that should publish."
    : "Choose countries where this provider can publish. Catalog regions are derived automatically.";
  return `
    <section class="ce-prov-markets">
      <h4 class="ce-prov-section-title">Markets</h4>
      <p class="ce-hint">${escapeHtml(hint)}</p>
      ${renderMarketCountryPicker({
        idPrefix: pickerId,
        selected: market.country_codes,
        allowedCountries: allowed,
        defaultCollapsed: true,
        emptyMessage: partnerMode
          ? "Partner has not selected shipping countries yet. Ask them to set countries in the Partner product Details tab."
          : undefined,
      })}
      <div class="field ce-prov-origin-field">
        <label for="${escapeHtml(pickerId)}-origin">Country of origin</label>
        <input class="input ce-prov-origin" id="${escapeHtml(pickerId)}-origin" data-pid="${pid}" maxlength="2" placeholder="e.g. DE" value="${escapeHtml(market.country_of_origin || "")}" />
      </div>
    </section>`;
}

function renderActiveDetail(state, catalogDetail) {
  const pid = state.selectedPid;
  const versions = versionsForProvider(state, pid);
  const idx = Math.min(state.selectedVersionIdx, Math.max(0, versions.length - 1));
  state.selectedVersionIdx = idx;
  const version = versions[idx];
  const versionBody = version
    ? renderVersionConfigPanel(version, catalogDetail)
    : `<p class="ce-hint">Loading version…</p>`;

  return `
    <div class="ce-prov-detail-active">
      <div class="ce-prov-detail-head">
        <div class="ce-prov-detail-head-main">
          <h3 class="ce-prov-detail-title">${escapeHtml(providerLabel(state.merged.find((p) => providerId(p) === pid) || {}))}</h3>
        </div>
        <label class="ce-prov-toggle">
          <input type="checkbox" class="ce-prov-active-toggle" data-pid="${pid}" checked />
          <span>Active for this product</span>
        </label>
      </div>
      ${renderVersionTabs(versions, idx, state.editingVersionId)}
      <div class="ce-prov-version-pane">${versionBody}</div>
      ${renderProviderMarketsSection(state, pid)}
    </div>`;
}

function renderInactiveDetail(state, catalogDetail) {
  const pid = state.selectedPid;
  const fp = state.merged.find((p) => providerId(p) === pid) || {};
  const variants = catalogDetail?.variants || [];
  const printAreas =
    catalogDetail && catalogDetail.ok === false
      ? `<p class="ce-hint">Could not load provider details${catalogDetail.error ? `: ${escapeHtml(String(catalogDetail.error))}` : "."}</p>`
      : renderInactivePrintAreasHtml(variants, {
          variantPrintAreas: catalogDetail?.variant_print_areas || [],
        });

  return `
    <div class="ce-prov-detail-inactive">
      <div class="ce-prov-detail-head">
        <h3 class="ce-prov-detail-title">${escapeHtml(providerLabel(fp))}</h3>
        <label class="ce-prov-toggle">
          <input type="checkbox" class="ce-prov-active-toggle" data-pid="${pid}" />
          <span>Activate for this product</span>
        </label>
      </div>
      <p class="ce-hint">Print area positions and decoration technology from Printify catalog (read-only).</p>
      ${printAreas}
    </div>`;
}

function renderDetailPane(state, catalogDetail, loading) {
  if (!state.selectedPid) {
    return `<div class="ce-prov-detail-empty"><p class="ce-hint">Select a provider from the sidebar.</p></div>`;
  }
  if (loading) {
    return `<div class="ce-prov-detail-loading"><p class="catalog-editor-loading">Loading provider details…</p></div>`;
  }
  if (isProviderActive(state, state.selectedPid)) {
    return renderActiveDetail(state, catalogDetail);
  }
  return renderInactiveDetail(state, catalogDetail);
}

function renderProvidersTabHtml(ctx, state, { detailLoading = false } = {}) {
  const catalogDetail = state.catalogCache.get(String(state.selectedPid)) || null;
  const list = filteredProviders(state);
  const collapsed = isProvSidebarCollapsed();

  return `
    <div class="ce-tab-panel ce-prov-tab">
      <div class="ce-prov-layout ${collapsed ? "ce-prov-layout--collapsed" : ""}">
        <aside class="ce-prov-sidebar-wrap">
          <div class="ce-prov-sidebar">
            <div class="ce-prov-filter-tabs" role="tablist">
              <button type="button" class="ce-prov-filter-btn ${state.sidebarFilter === "available" ? "active" : ""}" data-filter="available">Available</button>
              <button type="button" class="ce-prov-filter-btn ${state.sidebarFilter === "active" ? "active" : ""}" data-filter="active">Active</button>
            </div>
            <div class="ce-prov-list-scroll">
              ${renderProviderCountryGroups(list, state)}
            </div>
          </div>
          <button type="button" class="ce-prov-rail" id="ce-prov-sidebar-toggle" aria-label="Toggle provider sidebar">
            <span class="ce-prov-rail-arrow" aria-hidden="true">‹</span>
          </button>
        </aside>
        <div class="ce-prov-detail" id="ce-prov-detail">
          ${renderDetailPane(state, catalogDetail, detailLoading)}
        </div>
      </div>
    </div>`;
}

async function ensureCatalogDetail(ctx, pid) {
  const state = ctx.providersTabState;
  const key = String(pid);
  if (state.catalogCache.has(key)) return state.catalogCache.get(key);
  const detail = await fetchProviderCatalogDetail(ctx.productKey, pid);
  if (detail?.ok) {
    state.catalogCache.set(key, detail);
    if (detail.versions?.length) {
      const sorted = detail.versions.slice().sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));
      if (!state.localVersions.has(key)) {
        state.localVersions.set(key, sorted);
      } else {
        const byId = new Map(sorted.map((v) => [String(v.id || v._tempId), v]));
        const merged = state.localVersions.get(key).map((v) => {
          const sv = byId.get(String(v.id || v._tempId));
          if (!sv) return v;
          return {
            ...v,
            ...sv,
            product_version_config: sv.product_version_config ?? v.product_version_config,
            studio_config: sv.studio_config ?? v.studio_config,
          };
        });
        state.localVersions.set(key, merged);
      }
    }
  } else {
    state.catalogCache.set(key, { ok: false, error: detail?.error || "load_failed", variants: [] });
  }
  return detail;
}

function refreshDetail(ctx, root, { loading = false } = {}) {
  const state = ctx.providersTabState;
  const detailEl = root.querySelector("#ce-prov-detail");
  if (!detailEl) return;
  const catalogDetail = state.catalogCache.get(String(state.selectedPid)) || null;
  detailEl.innerHTML = renderDetailPane(state, catalogDetail, loading);
  bindDetailEvents(ctx, root);
  refreshVisibilityTriSwitch(ctx);
}

function refreshProviderList(ctx, root) {
  const state = ctx.providersTabState;
  const scrollEl = root.querySelector(".ce-prov-list-scroll");
  if (!scrollEl) return;
  const list = filteredProviders(state);
  scrollEl.innerHTML = renderProviderCountryGroups(list, state);
  bindProviderListClicks(ctx, root, scrollEl);
}

function syncVersionsFromDom(ctx, root) {
  const state = ctx.providersTabState;
  const pid = state.selectedPid;
  if (!pid || !root) return;
  const versions = versionsForProvider(state, pid);
  const pane = root.querySelector(".ce-prov-version-pane");
  if (!pane) return;

  for (let idx = 0; idx < versions.length; idx++) {
    const v = versions[idx];
    const vid = v.id || v._tempId;
    const activeBody = pane.querySelector(`[data-version-id="${vid}"]`);
    if (!activeBody) continue;
    const nameInput = root.querySelector(`.ce-prov-ver-name[data-version-id="${vid}"]`);
    if (nameInput) v.display_name = nameInput.value?.trim() || v.display_name;
    v.product_version_config = collectVersionConfigPanel(pane, v.product_version_config, vid);
    v.product_version_config = mergeVisibilityIntoVersionConfig(ctx, v, v.product_version_config);
    versions[idx] = v;
  }
  state.localVersions.set(String(pid), versions);

  const catalogDetail = state.catalogCache.get(String(pid)) || { variants: [] };
  const dimUpdates = collectPrintAreaDimensionUpdates(pane, catalogDetail);
  if (dimUpdates.length) state.printAreaDimEdits.set(String(pid), dimUpdates);
}

function syncMarketsFromDom(ctx, root) {
  const state = ctx.providersTabState;
  const pid = state.selectedPid;
  if (!pid || !root) return;
  const pickerId = `ce-prov-market-${pid}`;
  const market = marketStateForProvider(state, pid);
  market.country_codes = syncMarketCountryPickerFromDom(root, pickerId);
  const originEl = root.querySelector(`#${CSS.escape(`${pickerId}-origin`)}`);
  if (originEl) {
    market.country_of_origin = String(originEl.value || "").trim().toUpperCase().slice(0, 2);
  }
  state.marketEdits.set(Number(pid), market);
}

/** Sync in-memory provider tab state from DOM before save/close dirty check. */
export function syncProvidersDomState(ctx) {
  const root = document.getElementById("ce-body");
  if (!root || !ctx?.providersTabState) return;
  syncVersionsFromDom(ctx, root);
  syncMarketsFromDom(ctx, root);
}

function onProvidersInput(ctx, root) {
  syncVersionsFromDom(ctx, root);
  syncMarketsFromDom(ctx, root);
  markEditorDirty();
  checkDirty(collectProvidersTabState(ctx));
}

function versionById(state, pid, versionId) {
  const versions = versionsForProvider(state, pid);
  return versions.find((v) => String(v.id || v._tempId) === String(versionId)) || null;
}

async function commitVersionName(ctx, root, versionId) {
  const state = ctx.providersTabState;
  const pid = state.selectedPid;
  const inp = root.querySelector(`.ce-prov-ver-name[data-version-id="${cssEscapeAttr(versionId)}"]`);
  const name = inp?.value?.trim();
  if (!name) {
    showToast("Name required", "Enter a version name.");
    return;
  }

  const v = versionById(state, pid, versionId);
  if (!v) return;

  if (v._tempId && !v.id) {
    v.display_name = name;
    state.editingVersionId = null;
    refreshDetail(ctx, root);
    return;
  }

  try {
    const res = await saveVersionConfig(versionId, { display_name: name, auto_mirror: false });
    if (!res?.ok) throw new Error(res?.error || "save_failed");
    v.display_name = name;
    if (res.version) Object.assign(v, res.version);
    state.editingVersionId = null;
    state.localVersions.set(String(pid), versionsForProvider(state, pid));
    refreshDetail(ctx, root);
    onProvidersInput(ctx, root);
    showToast("Name saved", name);
  } catch (err) {
    showToast("Save failed", err?.message || String(err));
  }
}

async function deleteVersionConfirmed(ctx, root, versionId) {
  const state = ctx.providersTabState;
  const pid = state.selectedPid;
  const versions = versionsForProvider(state, pid);
  const idx = versions.findIndex((v) => String(v.id || v._tempId) === String(versionId));
  if (idx <= 0) return;

  const v = versions[idx];
  const label = v.display_name || `Version ${idx + 1}`;

  if (v._tempId && !v.id) {
    versions.splice(idx, 1);
    state.pendingNewVersions = state.pendingNewVersions.filter((x) => x._tempId !== v._tempId);
    state.localVersions.set(String(pid), versions);
    if (state.editingVersionId === versionId) state.editingVersionId = null;
    if (state.selectedVersionIdx >= versions.length) state.selectedVersionIdx = Math.max(0, versions.length - 1);
    refreshDetail(ctx, root);
    onProvidersInput(ctx, root);
    showToast("Version removed", label);
    return;
  }

  try {
    const res = await deleteVersion(versionId);
    if (!res?.ok) throw new Error(res?.error || "delete_failed");
    versions.splice(idx, 1);
    state.localVersions.set(String(pid), versions);
    if (state.editingVersionId === versionId) state.editingVersionId = null;
    if (state.selectedVersionIdx >= versions.length) state.selectedVersionIdx = Math.max(0, versions.length - 1);
    refreshDetail(ctx, root);
    onProvidersInput(ctx, root);
    showToast("Version deleted", label);
  } catch (err) {
    showToast("Delete failed", err?.message || String(err));
  }
}

async function addVersionPersisted(ctx, root) {
  const state = ctx.providersTabState;
  const pid = state.selectedPid;
  if (!pid) return;

  const versions = versionsForProvider(state, pid);
  const addBtn = root.querySelector("#ce-prov-add-version");
  if (addBtn) addBtn.disabled = true;

  try {
    const res = await createVersion(ctx.productKey, {
      print_provider_id: pid,
      display_name: `Version ${versions.length + 1}`,
      sort_order: versions.length,
      auto_mirror: false,
    });
    if (!res?.ok || !res.version) throw new Error(res?.error || "create_failed");

    versions.push(res.version);
    state.localVersions.set(String(pid), versions);
    state.selectedVersionIdx = versions.length - 1;
    state.editingVersionId = null;
    refreshDetail(ctx, root);
    onProvidersInput(ctx, root);
    showToast("Version added", res.version.display_name || "New version");
  } catch (err) {
    showToast("Could not add version", err?.message || String(err));
  } finally {
    if (addBtn) addBtn.disabled = false;
  }
}

function bindVersionTabDelegation(ctx, root) {
  if (ctx._versionTabDelegationBound) return;
  ctx._versionTabDelegationBound = true;

  root.addEventListener("click", (e) => {
    if (!e.target.closest(".ce-prov-version-tabs")) return;

    const delBtn = e.target.closest(".ce-prov-ver-del");
    if (delBtn) {
      e.preventDefault();
      e.stopPropagation();
      const vid = delBtn.dataset.versionId;
      const inp = root.querySelector(`.ce-prov-ver-name[data-version-id="${cssEscapeAttr(vid)}"]`);
      const name = inp?.value?.trim() || "this version";
      confirmAction({
        title: "Delete version",
        message: `Delete "${name}"? This cannot be undone.`,
        confirmLabel: "Delete",
        confirmClass: "btn-danger",
        onConfirm: () => deleteVersionConfirmed(ctx, root, vid),
      });
      return;
    }

    const editBtn = e.target.closest(".ce-prov-ver-edit");
    if (editBtn) {
      e.preventDefault();
      e.stopPropagation();
      const vid = editBtn.dataset.versionId;
      ctx.providersTabState.editingVersionId = vid;
      refreshDetail(ctx, root);
      const inp = root.querySelector(`.ce-prov-ver-name[data-version-id="${cssEscapeAttr(vid)}"]`);
      inp?.focus();
      inp?.select();
      return;
    }

    const saveBtn = e.target.closest(".ce-prov-ver-save");
    if (saveBtn) {
      e.preventDefault();
      e.stopPropagation();
      void commitVersionName(ctx, root, saveBtn.dataset.versionId);
      return;
    }

    const addBtn = e.target.closest("#ce-prov-add-version");
    if (addBtn) {
      e.preventDefault();
      e.stopPropagation();
      void addVersionPersisted(ctx, root);
      return;
    }

    const tab = e.target.closest(".ce-prov-ver-tab");
    if (!tab || e.target.closest(".ce-prov-ver-name, .ce-prov-ver-action, .ce-prov-ver-del")) return;

    syncVersionsFromDom(ctx, root);
    const idx = Number(tab.dataset.verIdx);
    if (!Number.isFinite(idx)) return;
    ctx.providersTabState.selectedVersionIdx = idx;
    ctx.providersTabState.editingVersionId = null;
    refreshDetail(ctx, root);
    onProvidersInput(ctx, root);
  });

  root.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const inp = e.target.closest?.(".ce-prov-ver-name");
    if (!inp) return;
    e.preventDefault();
    e.stopPropagation();
    const vid = inp.dataset.versionId;
    if (ctx.providersTabState.editingVersionId === vid) {
      void commitVersionName(ctx, root, vid);
    }
  });
}

function cssEscapeAttr(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(String(value));
  }
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function bindDetailEvents(ctx, root) {
  root.querySelector(".ce-prov-active-toggle")?.addEventListener("change", (e) => {
    const pid = Number(e.target.dataset.pid);
    if (e.target.checked) {
      stateActivate(ctx, pid);
    } else {
      stateDeactivate(ctx, pid);
    }
    refreshProviderList(ctx, root);
    refreshDetail(ctx, root);
    onProvidersInput(ctx, root);
  });

  root.querySelectorAll(".ce-prov-ver-name").forEach((inp) => {
    inp.addEventListener("click", (e) => e.stopPropagation());
  });

  root.querySelectorAll(".ce-prov-ph-qty, .ce-prov-dt-cb, .ce-prov-dim-h, .ce-prov-dim-w").forEach((el) => {
    el.addEventListener("input", () => onProvidersInput(ctx, root));
    el.addEventListener("change", () => onProvidersInput(ctx, root));
  });

  const pid = ctx.providersTabState?.selectedPid;
  if (pid) {
    const pickerId = `ce-prov-market-${pid}`;
    bindMarketCountryPicker(root, pickerId, () => onProvidersInput(ctx, root));
    root.querySelector(`#${CSS.escape(`${pickerId}-origin`)}`)?.addEventListener("input", () =>
      onProvidersInput(ctx, root)
    );
  }
}

function stateActivate(ctx, pid) {
  const state = ctx.providersTabState;
  state.activeIds.add(pid);
  const versions = versionsForProvider(state, pid);
  if (!versions.length) {
    const tempId = `new_std_${pid}_${Date.now()}`;
    const std = {
      _tempId: tempId,
      display_name: "Standard",
      sort_order: 0,
      external_provider_id: String(pid),
      product_version_config: { placeholders_by_position: {}, design_types: [] },
    };
    state.localVersions.set(String(pid), [std]);
    state.pendingNewVersions.push({
      _tempId: tempId,
      print_provider_id: pid,
      display_name: "Standard",
      sort_order: 0,
      product_version_config: { placeholders_by_position: {}, design_types: [] },
    });
  }
  state.selectedVersionIdx = 0;
}

function stateDeactivate(ctx, pid) {
  const state = ctx.providersTabState;
  state.activeIds.delete(pid);
  state.editingVersionId = null;
}

async function selectProvider(ctx, root, pid) {
  const state = ctx.providersTabState;
  state.selectedPid = pid;
  const fp = state.merged.find((p) => providerId(p) === pid);
  if (fp) {
    const { code } = resolveProviderShipCountry(fp);
    state.expandedCountries.add(code);
  }
  state.selectedVersionIdx = 0;
  state.editingVersionId = null;
  refreshProviderList(ctx, root);
  refreshDetail(ctx, root, { loading: true });
  try {
    await ensureCatalogDetail(ctx, pid);
  } catch {
    /* detail pane shows empty state */
  }
  refreshDetail(ctx, root);
  onProvidersInput(ctx, root);
}

export async function loadProvidersTab(ctx) {
  const data = await fetchProvidersBundle(ctx.productKey);
  ctx.providersData = data;
  initProvidersState(ctx, data);
  if (ctx.providersTabState.selectedPid) {
    try {
      await ensureCatalogDetail(ctx, ctx.providersTabState.selectedPid);
    } catch {
      /* non-fatal */
    }
  }
  return renderProvidersTabHtml(ctx, ctx.providersTabState);
}

export function bindProvidersTab(ctx, root) {
  if (!ctx.providersTabState) return;

  bindVersionTabDelegation(ctx, root);

  root.querySelectorAll(".ce-prov-filter-btn").forEach((btn) => {
    btn.onclick = () => {
      ctx.providersTabState.sidebarFilter = btn.dataset.filter;
      ctx.providersTabState.expandedCountries = new Set();
      root.querySelectorAll(".ce-prov-filter-btn").forEach((b) => b.classList.toggle("active", b === btn));
      refreshProviderList(ctx, root);
      const list = filteredProviders(ctx.providersTabState);
      const stillVisible = list.some((p) => providerId(p) === ctx.providersTabState.selectedPid);
      if (!stillVisible && list.length) {
        selectProvider(ctx, root, providerId(list[0]));
      } else if (!stillVisible) {
        ctx.providersTabState.selectedPid = null;
        refreshDetail(ctx, root);
      }
    };
  });

  root.querySelector("#ce-prov-sidebar-toggle")?.addEventListener("click", () => {
    sessionStorage.setItem(CE_PROV_SIDEBAR_KEY, isProvSidebarCollapsed() ? "0" : "1");
    root.querySelector(".ce-prov-layout")?.classList.toggle("ce-prov-layout--collapsed", isProvSidebarCollapsed());
  });

  bindProviderListClicks(ctx, root, root.querySelector(".ce-prov-list-scroll"));

  bindDetailEvents(ctx, root);
}

export function collectProvidersTabState(ctx) {
  const state = ctx.providersTabState;
  if (!state) return { active_print_provider_ids: [] };

  const root = document.getElementById("ce-body");
  if (root) syncMarketsFromDom(ctx, root);
  const versionUpdates = [];
  const newVersions = [];
  const variantPrintAreaUpdates = [];
  const deletedIds = [...state.deletedVersionIds];

  for (const pid of state.activeIds) {
    const key = String(pid);
    const versions = versionsForProvider(state, pid);
    for (let idx = 0; idx < versions.length; idx++) {
      const v = versions[idx];
      const vid = v.id || v._tempId;
      const displayName = v.display_name || (idx === 0 ? "Standard" : "Version");
      let product_version_config = v.product_version_config;
      if (state.selectedPid === pid && root) {
        product_version_config = collectVersionConfigPanel(root, product_version_config, vid);
      } else {
        product_version_config = product_version_config || collectVersionConfigPanel(root, null, vid);
      }
      product_version_config = mergeVisibilityIntoVersionConfig(ctx, v, product_version_config);

      if (v._tempId && !v.id) {
        newVersions.push({
          print_provider_id: pid,
          display_name: displayName,
          sort_order: v.sort_order ?? idx,
          product_version_config,
        });
      } else if (v.id) {
        versionUpdates.push({
          id: v.id,
          display_name: displayName,
          sort_order: idx,
          product_version_config,
        });
      }
    }

    const dimFromState = state.printAreaDimEdits.get(key);
    if (dimFromState?.length) {
      variantPrintAreaUpdates.push(...dimFromState);
    } else if (state.selectedPid === pid && root) {
      const pane = root.querySelector(".ce-prov-version-pane");
      const catalogDetail = state.catalogCache.get(key) || { variants: [] };
      if (pane) variantPrintAreaUpdates.push(...collectPrintAreaDimensionUpdates(pane, catalogDetail));
    }
  }

  const publishPlanUpdates = [];
  for (const pid of state.activeIds) {
    const market = state.marketEdits.get(Number(pid));
    if (!market?.plan_id) continue;
    let countryCodes = market.country_codes || [];
    if (marketsMode(state) === "partner") {
      const available = new Set(partnerAvailableCountries(state));
      if (available.size) countryCodes = countryCodes.filter((cc) => available.has(cc));
    }
    const regionCodes = regionCodesFromCountryCodes(countryCodes);
    publishPlanUpdates.push({
      id: market.plan_id,
      provider_name: market.provider_name,
      country_codes: countryCodes,
      region_codes: regionCodes,
      country_of_origin: market.country_of_origin || null,
    });
  }

  return {
    active_print_provider_ids: [...state.activeIds],
    version_updates: versionUpdates,
    new_versions: newVersions.map(({ _tempId, ...rest }) => rest),
    deleted_version_ids: deletedIds,
    variant_print_area_updates: variantPrintAreaUpdates,
    publish_plan_updates: publishPlanUpdates,
    auto_mirror: false,
  };
}

export function getProvidersDirtyState(ctx) {
  return collectProvidersTabState(ctx);
}

export async function saveProvidersTab(ctx) {
  const body = collectProvidersTabState(ctx);
  await saveProviders(ctx.productKey, body);
}

export function snapshotProvidersTab(ctx) {
  return collectProvidersTabState(ctx);
}
