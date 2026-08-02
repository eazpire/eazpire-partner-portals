/**
 * Admin Creations → Product Modal → Edit Design panel.
 * Fullscreen studio viewer: move / scale / rotate, print-area clip, Save / Update footer.
 */

import { partnerFetch, escapeHtml } from "/creations/shared/js/partner-api.js";
import { showToast } from "/creations/shared/js/partner-shell.js";

const DEFAULT_TRANSFORM = { x: 0.5, y: 0.5, scale: 0.95, angle: 0 };
const CMC = typeof window !== "undefined" ? window.CreatorMockCompositing : null;

function cloneTr(tr) {
  return {
    x: Number(tr?.x),
    y: Number(tr?.y),
    scale: Number(tr?.scale),
    angle: Number(tr?.angle ?? tr?.rotate) || 0,
  };
}

/** Free placement (own coordinate system) — x/y may leave the print zone. */
function normalizeTr(tr) {
  const out = cloneTr(tr);
  if (!Number.isFinite(out.x)) out.x = DEFAULT_TRANSFORM.x;
  if (!Number.isFinite(out.y)) out.y = DEFAULT_TRANSFORM.y;
  if (!Number.isFinite(out.scale) || out.scale <= 0) out.scale = DEFAULT_TRANSFORM.scale;
  if (!Number.isFinite(out.angle)) out.angle = 0;
  out.x = Math.max(-2, Math.min(3, out.x));
  out.y = Math.max(-2, Math.min(3, out.y));
  out.scale = Math.max(0.08, Math.min(4, out.scale));
  out.angle = ((out.angle % 360) + 360) % 360;
  if (out.angle > 180) out.angle -= 360;
  return out;
}

function trEqual(a, b, eps = 1e-4) {
  if (!a || !b) return !a && !b;
  return (
    Math.abs(a.x - b.x) < eps &&
    Math.abs(a.y - b.y) < eps &&
    Math.abs(a.scale - b.scale) < eps &&
    Math.abs((a.angle || 0) - (b.angle || 0)) < eps
  );
}

function placementsEqual(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    if (!trEqual(normalizeTr(a?.[k]), normalizeTr(b?.[k]))) return false;
  }
  return true;
}

function parseZone(zone) {
  if (CMC?.parseZoneFrac) return CMC.parseZoneFrac(zone);
  return { l: 0.28, t: 0.22, w: 0.44, h: 0.48 };
}

function snapRotate5(deg) {
  const n = Number(deg) || 0;
  return Math.round(n / 5) * 5;
}

/**
 * @param {object} ui
 */
export function renderEditDesignPanelHtml(ui) {
  if (ui.loading) {
    return `<p class="cr-pd-loading">Loading design editor…</p>`;
  }
  if (ui.error) {
    return `<p class="cr-pd-error" role="alert">${escapeHtml(ui.error)}</p>`;
  }
  const ed = ui.editDesign;
  if (!ed) {
    return `<div class="cr-pd-empty">No edit-design data for this product.</div>`;
  }

  const positions = Array.isArray(ed.positions) && ed.positions.length ? ed.positions : ["front"];
  const active = positions.includes(ui.activePos) ? ui.activePos : positions[0];
  const view = ed.views?.[active] || {};
  const mockUrl = view.mock_url || "";
  const designUrl = ed.design_url || "";
  const zone = parseZone(view.zone);
  const dirty = !placementsEqual(ui.working, ui.savedBaseline);
  const pending = !!ui.pendingUpdate;
  const busy = !!ui.busy;
  const isTodify = !ed.printify_product_id;

  const tabs = positions
    .map(
      (pos) =>
        `<button type="button" class="cr-pd-ed-tab${pos === active ? " active" : ""}" data-cr-ed-pos="${escapeHtml(pos)}">${escapeHtml(pos === "front" ? "Front" : pos === "back" ? "Back" : pos)}</button>`
    )
    .join("");

  const updateEnabled = isTodify ? !dirty && !busy : pending && !dirty && !busy;
  let status = "";
  if (dirty) status = "Unsaved changes";
  else if (pending) status = isTodify ? "Saved — ready to Update" : "Saved — ready to Update Printify";
  else status = "In sync";

  return `
    <section class="cr-pd-ed">
      <div class="cr-pd-ed__viewer" id="cr-pd-ed-viewer">
        <div class="cr-pd-ed__frame" id="cr-pd-ed-frame">
          <div class="cr-pd-ed__stage" id="cr-pd-ed-stage">
            ${
              mockUrl
                ? `<img class="cr-pd-ed__mock" id="cr-pd-ed-mock" src="${escapeHtml(mockUrl)}" alt="Product mock" draggable="false" />`
                : `<div class="cr-pd-ed__mock-missing">No ${escapeHtml(active)} mock available</div>`
            }
            <div class="cr-pd-ed__zone" id="cr-pd-ed-zone" style="left:${zone.l * 100}%;top:${zone.t * 100}%;width:${zone.w * 100}%;height:${zone.h * 100}%;">
              <div class="cr-pd-ed__zone-clip" id="cr-pd-ed-zone-clip">
                ${
                  designUrl
                    ? `<div class="cr-pd-ed__design-wrap" id="cr-pd-ed-design-wrap">
                        <img class="cr-pd-ed__design" id="cr-pd-ed-design" src="${escapeHtml(designUrl)}" alt="Design" draggable="false" />
                      </div>`
                    : `<div class="cr-pd-ed__design-missing">No design image found</div>`
                }
              </div>
            </div>
            ${
              designUrl
                ? `<div class="cr-pd-ed__chrome" id="cr-pd-ed-chrome" hidden>
                    <button type="button" class="cr-pd-ed__rz cr-pd-ed__rz--scale" data-cr-ed-rz="scale" aria-label="Scale design"></button>
                    <button type="button" class="cr-pd-ed__rz cr-pd-ed__rz--rotate" data-cr-ed-rz="rotate" aria-label="Rotate design"></button>
                  </div>`
                : ""
            }
          </div>
        </div>
        <div class="cr-pd-ed__tabs" role="tablist" aria-label="Print positions">${tabs}</div>
      </div>
      <footer class="cr-pd-ed__foot">
        <p class="cr-pd-ed__status" id="cr-pd-ed-status">${escapeHtml(status)}</p>
        <div class="cr-pd-ed__actions">
          <button type="button" class="btn btn-secondary" id="cr-pd-ed-save" ${dirty && !busy ? "" : "disabled"}>${busy ? "Working…" : "Save"}</button>
          <button type="button" class="btn btn-primary" id="cr-pd-ed-update" ${updateEnabled ? "" : "disabled"}>${busy ? "Working…" : "Update"}</button>
        </div>
      </footer>
    </section>`;
}

function applyTransform(root, tr) {
  const zoneEl = root.querySelector("#cr-pd-ed-zone");
  const designEl = root.querySelector("#cr-pd-ed-design");
  if (!zoneEl || !designEl) return;
  const norm = normalizeTr(tr);
  if (CMC?.applyDesignTransformInZone) {
    CMC.applyDesignTransformInZone(
      designEl,
      zoneEl,
      { x: norm.x, y: norm.y, scale: norm.scale, rotate: norm.angle, flipX: false, flipY: false },
      { uiScaleMax: 4, freeEdit: true }
    );
  } else {
    const zoneW = zoneEl.offsetWidth || 1;
    const zoneH = zoneEl.offsetHeight || 1;
    designEl.style.width = Math.max(8, zoneW * norm.scale) + "px";
    designEl.style.height = "auto";
    designEl.style.left = "50%";
    designEl.style.top = "50%";
    const dx = (norm.x - 0.5) * zoneW;
    const dy = (norm.y - 0.5) * zoneH;
    designEl.style.transform = `translate(-50%, -50%) translate(${dx}px,${dy}px) rotate(${norm.angle}deg)`;
  }
  syncChrome(root);
}

function syncChrome(root) {
  const stage = root.querySelector("#cr-pd-ed-stage");
  const chrome = root.querySelector("#cr-pd-ed-chrome");
  const design = root.querySelector("#cr-pd-ed-design");
  if (!stage || !chrome || !design) return;
  if (!design.classList.contains("is-laid-out")) {
    chrome.hidden = true;
    return;
  }
  const sr = stage.getBoundingClientRect();
  const dr = design.getBoundingClientRect();
  if (dr.width < 2 || dr.height < 2) {
    chrome.hidden = true;
    return;
  }
  chrome.hidden = false;
  chrome.style.left = `${dr.left - sr.left}px`;
  chrome.style.top = `${dr.top - sr.top}px`;
  chrome.style.width = `${dr.width}px`;
  chrome.style.height = `${dr.height}px`;
}

function fitStage(root) {
  const stage = root.querySelector("#cr-pd-ed-stage");
  const mock = root.querySelector("#cr-pd-ed-mock");
  const frame = root.querySelector("#cr-pd-ed-frame");
  if (!stage || !mock || !frame) return;
  if (CMC?.fitMockStage) CMC.fitMockStage(stage, mock, frame);
}

/**
 * @param {HTMLElement} root
 * @param {object} ui
 */
export function bindEditDesignPanel(root, ui) {
  if (!root || !ui?.editDesign) return;

  const refreshButtons = () => {
    const dirty = !placementsEqual(ui.working, ui.savedBaseline);
    const saveBtn = root.querySelector("#cr-pd-ed-save");
    const updateBtn = root.querySelector("#cr-pd-ed-update");
    const status = root.querySelector("#cr-pd-ed-status");
    const isTodify = !ui.editDesign.printify_product_id;
    if (saveBtn) saveBtn.disabled = !dirty || !!ui.busy;
    if (updateBtn) {
      updateBtn.disabled = isTodify
        ? !(!dirty && !ui.busy)
        : !(ui.pendingUpdate && !dirty) || !!ui.busy;
    }
    if (status) {
      if (dirty) status.textContent = "Unsaved changes";
      else if (ui.pendingUpdate) status.textContent = isTodify ? "Saved — ready to Update" : "Saved — ready to Update Printify";
      else status.textContent = "In sync";
    }
  };

  const activePos = () => {
    const positions = ui.editDesign.positions || ["front"];
    return positions.includes(ui.activePos) ? ui.activePos : positions[0];
  };

  const currentTr = () => normalizeTr(ui.working[activePos()] || DEFAULT_TRANSFORM);

  const setWorkingTr = (tr) => {
    ui.working[activePos()] = normalizeTr(tr);
    applyTransform(root, ui.working[activePos()]);
    refreshButtons();
    ui.onDirtyChange?.(isEditDesignDirty(ui));
  };

  const mock = root.querySelector("#cr-pd-ed-mock");
  const design = root.querySelector("#cr-pd-ed-design");
  const layout = () => {
    fitStage(root);
    applyTransform(root, currentTr());
  };
  if (mock) {
    if (mock.complete) layout();
    else mock.addEventListener("load", layout, { once: true });
  }
  if (design) {
    if (design.complete) layout();
    else design.addEventListener("load", layout, { once: true });
  }
  requestAnimationFrame(layout);
  window.addEventListener("resize", layout, { passive: true });

  root.querySelectorAll("[data-cr-ed-pos]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pos = btn.dataset.crEdPos;
      if (!pos || pos === ui.activePos) return;
      ui.activePos = pos;
      ui.onRerender?.();
    });
  });

  const wrap = root.querySelector("#cr-pd-ed-design-wrap");
  const zoneEl = root.querySelector("#cr-pd-ed-zone");
  let drag = null;

  const onMove = (e) => {
    if (!drag || !zoneEl) return;
    const zoneW = zoneEl.offsetWidth || 1;
    const zoneH = zoneEl.offsetHeight || 1;
    const tr = cloneTr(drag.startTr);
    if (drag.mode === "move") {
      tr.x = drag.startTr.x + (e.clientX - drag.startX) / zoneW;
      tr.y = drag.startTr.y + (e.clientY - drag.startY) / zoneH;
    } else if (drag.mode === "scale") {
      const startDist = Math.hypot(drag.startX - drag.cx, drag.startY - drag.cy);
      const curDist = Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy);
      const ratio = startDist > 1 ? curDist / startDist : 1;
      tr.scale = drag.startTr.scale * ratio;
    } else if (drag.mode === "rotate") {
      const ang0 = Math.atan2(drag.startY - drag.cy, drag.startX - drag.cx);
      const ang = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
      tr.angle = snapRotate5(drag.startTr.angle + ((ang - ang0) * 180) / Math.PI);
    }
    setWorkingTr(tr);
  };
  const onUp = () => {
    drag = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  };

  const startDrag = (mode, e) => {
    if (e.button != null && e.button !== 0) return;
    const rect = wrap?.getBoundingClientRect();
    drag = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startTr: currentTr(),
      cx: rect ? rect.left + rect.width / 2 : e.clientX,
      cy: rect ? rect.top + rect.height / 2 : e.clientY,
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    e.preventDefault();
  };

  wrap?.addEventListener("pointerdown", (e) => {
    if (e.target?.closest?.("[data-cr-ed-rz]")) return;
    startDrag("move", e);
  });

  root.querySelectorAll("[data-cr-ed-rz]").forEach((handle) => {
    handle.addEventListener("pointerdown", (e) => {
      const mode = handle.dataset.crEdRz === "rotate" ? "rotate" : "scale";
      startDrag(mode, e);
      e.stopPropagation();
    });
  });

  root.querySelector("#cr-pd-ed-save")?.addEventListener("click", async () => {
    if (ui.busy) return;
    ui.busy = true;
    refreshButtons();
    try {
      const data = await partnerFetch("admin-creations-edit-design-save", {
        method: "POST",
        body: {
          shopify_product_id: ui.editDesign.shopify_product_id,
          placements: ui.working,
        },
      });
      const draft = data.draft || {};
      ui.savedBaseline = {};
      for (const [k, v] of Object.entries(draft.placements || ui.working)) {
        ui.savedBaseline[k] = normalizeTr(v);
      }
      ui.working = { ...ui.savedBaseline };
      ui.pendingUpdate = !!data.pending_update || !!draft.pending_update;
      if (ui.editDesign.draft) {
        ui.editDesign.draft = { ...ui.editDesign.draft, ...draft, pending_update: ui.pendingUpdate };
      } else {
        ui.editDesign.draft = { ...draft, pending_update: ui.pendingUpdate };
      }
      ui.editDesign.pending_update = ui.pendingUpdate;
      showToast("Saved", "Design placement saved");
      ui.onDirtyChange?.(false);
      refreshButtons();
    } catch (e) {
      showToast("Error", e.message || "Save failed");
    } finally {
      ui.busy = false;
      refreshButtons();
    }
  });

  root.querySelector("#cr-pd-ed-update")?.addEventListener("click", async () => {
    if (ui.busy) return;
    if (!placementsEqual(ui.working, ui.savedBaseline)) return;
    const isTodify = !ui.editDesign.printify_product_id;
    if (!isTodify && !ui.pendingUpdate) return;
    ui.busy = true;
    refreshButtons();
    try {
      const data = await partnerFetch("admin-creations-edit-design-update", {
        method: "POST",
        body: {
          shopify_product_id: ui.editDesign.shopify_product_id,
          ...(isTodify && !ui.pendingUpdate ? { force_recompose: true } : {}),
        },
      });
      ui.pendingUpdate = !!data.pending_update;
      if (data.draft) {
        ui.editDesign.draft = data.draft;
        ui.savedBaseline = {};
        for (const [k, v] of Object.entries(data.draft.placements || {})) {
          ui.savedBaseline[k] = normalizeTr(v);
        }
        ui.working = { ...ui.savedBaseline };
      }
      ui.editDesign.pending_update = ui.pendingUpdate;
      const composed = Number(data?.mock_attach?.composed) || 0;
      showToast(
        "Updated",
        isTodify
          ? composed > 0
            ? `Design-on-mock uploaded (${composed} view(s))`
            : "Shopify mockups refreshed"
          : "Printify placement updated and Shopify refresh requested"
      );
      ui.onDirtyChange?.(false);
      refreshButtons();
    } catch (e) {
      showToast("Error", e.message || "Update failed");
    } finally {
      ui.busy = false;
      refreshButtons();
    }
  });

  refreshButtons();
}

export function isEditDesignDirty(ui) {
  if (!ui?.editDesign) return false;
  return !placementsEqual(ui.working, ui.savedBaseline);
}

export function seedEditDesignUi(payload) {
  const ed = payload?.edit_design || payload || null;
  if (!ed) {
    return {
      editDesign: null,
      loading: false,
      error: "No data",
      activePos: "front",
      working: {},
      savedBaseline: {},
      pendingUpdate: false,
      busy: false,
    };
  }
  const positions = Array.isArray(ed.positions) && ed.positions.length ? ed.positions : ["front"];
  const working = {};
  const savedBaseline = {};
  for (const pos of positions) {
    const draftP = ed.draft?.placements?.[pos];
    const liveP = ed.live_placements?.[pos] || ed.views?.[pos]?.live_placement;
    const seed = normalizeTr(draftP || liveP || DEFAULT_TRANSFORM);
    working[pos] = { ...seed };
  }
  if (ed.draft?.placements && Object.keys(ed.draft.placements).length) {
    for (const [pos, p] of Object.entries(ed.draft.placements)) {
      savedBaseline[pos] = normalizeTr(p);
    }
  } else {
    for (const pos of positions) savedBaseline[pos] = { ...working[pos] };
  }
  return {
    editDesign: ed,
    loading: false,
    error: "",
    activePos: positions[0],
    working,
    savedBaseline,
    pendingUpdate: !!ed.pending_update || !!ed.draft?.pending_update,
    busy: false,
  };
}

export async function loadEditDesignForProduct(shopifyProductId) {
  const data = await partnerFetch("admin-creations-edit-design", {
    query: { shopify_product_id: shopifyProductId },
  });
  return seedEditDesignUi(data);
}

export async function saveEditDesignWorking(ui) {
  if (!ui?.editDesign) return;
  const data = await partnerFetch("admin-creations-edit-design-save", {
    method: "POST",
    body: {
      shopify_product_id: ui.editDesign.shopify_product_id,
      placements: ui.working,
    },
  });
  const draft = data.draft || {};
  ui.savedBaseline = {};
  for (const [k, v] of Object.entries(draft.placements || ui.working)) {
    ui.savedBaseline[k] = normalizeTr(v);
  }
  ui.working = { ...ui.savedBaseline };
  ui.pendingUpdate = !!data.pending_update || !!draft.pending_update;
  ui.editDesign.draft = { ...(ui.editDesign.draft || {}), ...draft, pending_update: ui.pendingUpdate };
  ui.editDesign.pending_update = ui.pendingUpdate;
  return data;
}

export function discardEditDesignWorking(ui) {
  if (!ui) return;
  ui.working = {};
  for (const [k, v] of Object.entries(ui.savedBaseline || {})) {
    ui.working[k] = normalizeTr(v);
  }
}
