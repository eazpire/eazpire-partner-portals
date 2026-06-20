import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { fetchProvidersBundle, fetchProviderCatalogDetail, saveProviders } from "../api.js";
import { renderVersionConfigPanel, collectVersionConfigPanel, collectPrintAreaDimensionUpdates } from "../version-config-panel.js";
import { renderInactivePrintAreasHtml } from "../provider-print-technical.js";
import { markEditorDirty, checkDirty } from "../editor-dirty.js";

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
  if (Number.isFinite(n) && n > 0) return n;
  const m = String(raw ?? "").match(/(?:^new_)?(\d+)$/);
  return m ? Number(m[1]) : NaN;
}

function rowFromBlueprintProvider(cp) {
  const pid = Number(cp?.id);
  return {
    type: "available",
    print_provider_id: pid,
    name: cp?.title || `Provider #${cp?.id}`,
    region: cp?.location?.country || "Other",
    locationLabel: cp?.location?.city ? `${cp.location.country} / ${cp.location.city}` : cp?.location?.country || "",
    catalogData: cp,
    is_enabled: false,
  };
}

function rowFromFulfillmentProvider(fp) {
  const pid = Number(fp.external_provider_id);
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
  if (merged.length) return merged.filter((p) => Number.isFinite(providerId(p)));

  const fromBlueprint = (data.blueprint_providers || []).map(rowFromBlueprintProvider);
  if (fromBlueprint.length) return fromBlueprint;

  const fromFulfillment = (data.providers || []).map(rowFromFulfillmentProvider);
  return fromFulfillment.filter((p) => Number.isFinite(providerId(p)));
}

function initProvidersState(ctx, data) {
  const merged = buildProviderList(data);
  const activeFromDb = new Set(
    (data.active_providers || []).map((r) => Number(r.print_provider_id)).filter((n) => Number.isFinite(n))
  );

  for (const p of merged) {
    const pid = providerId(p);
    if (Number.isFinite(pid) && p.is_enabled) activeFromDb.add(pid);
  }

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
  };

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
  const region = fp.region || "Other";
  const loc = fp.locationLabel ? ` · ${fp.locationLabel}` : "";
  return `<li>
    <button type="button" class="ce-prov-list-item ${selected ? "active" : ""}" data-pid="${pid}">
      <span class="ce-prov-list-name">${escapeHtml(providerLabel(fp))}</span>
      <span class="ce-prov-list-meta">ID ${escapeHtml(String(pid))} · ${escapeHtml(String(region))}${escapeHtml(loc)}</span>
      <span class="ce-prov-list-status ${active ? "is-active" : ""}">${active ? "Active" : "Available"}</span>
    </button>
  </li>`;
}

function renderVersionTabs(versions, selectedIdx) {
  if (!versions.length) {
    return `<div class="ce-prov-version-tabs"><span class="ce-hint">No versions yet — activate provider to create Standard.</span></div>`;
  }
  const tabs = versions
    .map((v, idx) => {
      const isStd = idx === 0;
      const vid = v.id || v._tempId;
      const name = v.display_name || (isStd ? "Standard" : `Version ${idx + 1}`);
      const badge = isStd ? `<span class="ce-prov-ver-badge">Standard</span>` : "";
      const nameInput = isStd
        ? `<input type="text" class="input input-sm ce-prov-ver-name ce-prov-ver-name--std" data-version-id="${escapeHtml(String(vid))}" value="${escapeHtml(name)}" placeholder="Product name" />`
        : `<input type="text" class="input input-sm ce-prov-ver-name" data-version-id="${escapeHtml(String(vid))}" value="${escapeHtml(name)}" placeholder="Version name" />`;
      return `<button type="button" class="ce-prov-ver-tab ${idx === selectedIdx ? "active" : ""}" data-ver-idx="${idx}" role="tab">
        ${badge}${nameInput}
      </button>`;
    })
    .join("");
  return `<div class="ce-prov-version-tabs" role="tablist">${tabs}
    <button type="button" class="ce-prov-ver-tab ce-prov-ver-tab--add" id="ce-prov-add-version" title="Add version">+</button>
  </div>`;
}

function renderActiveDetail(state, catalogDetail) {
  const pid = state.selectedPid;
  const versions = versionsForProvider(state, pid);
  const idx = Math.min(state.selectedVersionIdx, Math.max(0, versions.length - 1));
  state.selectedVersionIdx = idx;
  const version = versions[idx];
  const versionBody = version ? renderVersionConfigPanel(version, catalogDetail) : `<p class="ce-hint">Loading version…</p>`;

  return `
    <div class="ce-prov-detail-active">
      <div class="ce-prov-detail-head">
        <h3 class="ce-prov-detail-title">${escapeHtml(providerLabel(state.merged.find((p) => providerId(p) === pid) || {}))}</h3>
        <label class="ce-prov-toggle">
          <input type="checkbox" class="ce-prov-active-toggle" data-pid="${pid}" checked />
          <span>Active for this product</span>
        </label>
      </div>
      ${renderVersionTabs(versions, idx)}
      <div class="ce-prov-version-pane">${versionBody}</div>
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
            <ul class="ce-prov-list">
              ${list.map((fp) => renderProviderListItem(fp, state)).join("") || "<li class='ce-hint'>No providers in this list.</li>"}
            </ul>
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
    if (!state.localVersions.has(key) && detail.versions?.length) {
      state.localVersions.set(
        key,
        detail.versions.slice().sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99))
      );
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
}

function refreshProviderList(ctx, root) {
  const state = ctx.providersTabState;
  const listEl = root.querySelector(".ce-prov-list");
  if (!listEl) return;
  const list = filteredProviders(state);
  listEl.innerHTML =
    list.map((fp) => renderProviderListItem(fp, state)).join("") || "<li class='ce-hint'>No providers in this list.</li>";
  listEl.querySelectorAll(".ce-prov-list-item").forEach((btn) => {
    btn.onclick = () => selectProvider(ctx, root, Number(btn.dataset.pid));
  });
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
    versions[idx] = v;
  }
  state.localVersions.set(String(pid), versions);

  const catalogDetail = state.catalogCache.get(String(pid)) || { variants: [] };
  const dimUpdates = collectPrintAreaDimensionUpdates(pane, catalogDetail);
  if (dimUpdates.length) state.printAreaDimEdits.set(String(pid), dimUpdates);
}

function onProvidersInput(ctx, root) {
  syncVersionsFromDom(ctx, root);
  markEditorDirty();
  checkDirty(collectProvidersTabState(ctx));
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

  root.querySelectorAll(".ce-prov-ver-tab:not(.ce-prov-ver-tab--add)").forEach((tab) => {
    tab.addEventListener("click", (e) => {
      if (e.target.closest(".ce-prov-ver-name")) return;
      syncVersionsFromDom(ctx, root);
      const idx = Number(tab.dataset.verIdx);
      ctx.providersTabState.selectedVersionIdx = idx;
      refreshDetail(ctx, root);
      onProvidersInput(ctx, root);
    });
  });

  root.querySelector("#ce-prov-add-version")?.addEventListener("click", () => {
    addLocalVersion(ctx);
    refreshDetail(ctx, root);
    onProvidersInput(ctx, root);
  });

  root.querySelectorAll(".ce-prov-ver-name").forEach((inp) => {
    inp.addEventListener("click", (e) => e.stopPropagation());
  });

  root.querySelectorAll(".ce-prov-ver-name, .ce-prov-ph-qty, .ce-prov-dt-cb, .ce-prov-dim-h, .ce-prov-dim-w").forEach((el) => {
    el.addEventListener("input", () => onProvidersInput(ctx, root));
    el.addEventListener("change", () => onProvidersInput(ctx, root));
  });
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
}

function addLocalVersion(ctx) {
  const state = ctx.providersTabState;
  const pid = state.selectedPid;
  const key = String(pid);
  const versions = versionsForProvider(state, pid);
  const tempId = `new_ver_${pid}_${Date.now()}`;
  const nv = {
    _tempId: tempId,
    display_name: `Version ${versions.length + 1}`,
    sort_order: versions.length,
    external_provider_id: String(pid),
    product_version_config: { placeholders_by_position: {}, design_types: [] },
  };
  versions.push(nv);
  state.localVersions.set(key, versions);
  state.pendingNewVersions.push({
    _tempId: tempId,
    print_provider_id: pid,
    display_name: nv.display_name,
    sort_order: nv.sort_order,
    product_version_config: nv.product_version_config,
  });
  state.selectedVersionIdx = versions.length - 1;
}

async function selectProvider(ctx, root, pid) {
  const state = ctx.providersTabState;
  state.selectedPid = pid;
  state.selectedVersionIdx = 0;
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

  root.querySelectorAll(".ce-prov-filter-btn").forEach((btn) => {
    btn.onclick = () => {
      ctx.providersTabState.sidebarFilter = btn.dataset.filter;
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

  root.querySelectorAll(".ce-prov-list-item").forEach((btn) => {
    btn.onclick = () => selectProvider(ctx, root, Number(btn.dataset.pid));
  });

  bindDetailEvents(ctx, root);
}

export function collectProvidersTabState(ctx) {
  const state = ctx.providersTabState;
  if (!state) return { active_print_provider_ids: [] };

  const root = document.getElementById("ce-body");
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
      const product_version_config = v.product_version_config || collectVersionConfigPanel(root, null, vid);

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

  return {
    active_print_provider_ids: [...state.activeIds],
    version_updates: versionUpdates,
    new_versions: newVersions.map(({ _tempId, ...rest }) => rest),
    deleted_version_ids: deletedIds,
    variant_print_area_updates: variantPrintAreaUpdates,
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
