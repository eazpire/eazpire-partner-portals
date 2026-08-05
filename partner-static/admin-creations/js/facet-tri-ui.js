/**
 * Shared Admin Creations facet option + tri-switch markup (Products + Designs).
 * Classic faceted search: count 0 → grayed out / not selectable (unless already active so user can clear).
 */

import { escapeHtml } from "/creations/shared/js/partner-api.js";

export function clampTri(st) {
  const n = Number(st);
  if (n === 1 || n === -1) return n;
  return 0;
}

/**
 * @param {string} sectionKey
 * @param {string|number} value
 * @param {number} state -1|0|1
 * @param {{ disabled?: boolean }} [opts]
 */
export function triSwitchHtml(sectionKey, value, state, opts = {}) {
  const st = clampTri(state);
  const disabled = !!opts.disabled;
  const disabledAttr = disabled ? ' aria-disabled="true" data-cr-pf-disabled="1"' : "";
  return `<div class="cr-pf-triswitch${disabled ? " cr-pf-triswitch--disabled" : ""}" data-state="${st}" data-cr-pf-section="${escapeHtml(
    sectionKey
  )}" data-cr-pf-key="${escapeHtml(String(value))}" role="group" aria-label="Filter"${disabledAttr}>
    <div class="cr-pf-triswitch__track">
      <div class="cr-pf-triswitch__thumb"></div>
      <div class="cr-pf-triswitch__labels">
        <button type="button" data-v="-1" aria-label="Exclude"${disabled ? " disabled" : ""}><span class="cr-pf-triswitch__glyph cr-pf-triswitch__glyph--minus">−</span></button>
        <button type="button" data-v="0" aria-label="Neutral"${disabled ? " disabled" : ""}><span class="cr-pf-triswitch__glyph cr-pf-triswitch__glyph--dot"></span></button>
        <button type="button" data-v="1" aria-label="Include"${disabled ? " disabled" : ""}><span class="cr-pf-triswitch__glyph cr-pf-triswitch__glyph--plus">+</span></button>
      </div>
    </div>
  </div>`;
}

/**
 * @param {string} sectionKey
 * @param {{ key: string, label: string, count?: number }} facet
 * @param {number} triState -1|0|1
 */
export function facetOptionRowHtml(sectionKey, facet, triState) {
  const st = clampTri(triState);
  const count = Math.max(0, Number(facet?.count) || 0);
  // Zero-count options are unavailable; keep interactive only if already include/exclude (clear path).
  const unavailable = count === 0 && st === 0;
  const rowClass = [
    "cr-pf-option",
    "cr-pf-option--tri",
    unavailable ? "cr-pf-option--unavailable" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `<div class="${rowClass}" data-tri-state="${st}" data-count="${count}"${
    unavailable ? ' aria-disabled="true"' : ""
  }>
    <span class="cr-pf-option__label" title="${escapeHtml(facet.label)}">${escapeHtml(facet.label)}</span>
    <span class="cr-pf-option__count">${count}</span>
    ${triSwitchHtml(sectionKey, facet.key, st, { disabled: unavailable })}
  </div>`;
}

/**
 * @param {string} sectionKey
 * @param {string} label
 * @param {Array<{ key: string, label: string, count?: number }>} facetList
 * @param {Record<string, number>} triGroup
 * @param {{ headerExtraHtml?: string }} [opts]
 */
export function facetSectionHtml(sectionKey, label, facetList, triGroup = {}, opts = {}) {
  const group = triGroup || {};
  const active = Object.values(group).filter((st) => st === 1 || st === -1).length;
  const rows = (facetList || [])
    .map((f) => facetOptionRowHtml(sectionKey, f, clampTri(group[f.key] || 0)))
    .join("");
  const extra = opts?.headerExtraHtml ? String(opts.headerExtraHtml) : "";
  return `<details class="cr-pf-section" data-cr-pf-group="${escapeHtml(sectionKey)}" open>
    <summary class="cr-pf-section__summary">
      <span class="cr-pf-section__title">${escapeHtml(label)}${extra}</span>
      ${active ? `<span class="cr-pf-section__badge">${active}</span>` : ""}
    </summary>
    <div class="cr-pf-section__body">${rows || '<p class="cr-pf-empty">No values</p>'}</div>
  </details>`;
}

/**
 * Bind tri-switch clicks; ignores unavailable (disabled) switches.
 * @param {HTMLElement} root
 * @param {{
 *   triState: { tri: Record<string, Record<string, number>> },
 *   onChange: () => void,
 * }} opts
 */
export function bindTriSwitches(root, { triState, onChange } = {}) {
  if (!root || !triState?.tri) return;
  const notify = () => {
    if (typeof onChange === "function") onChange();
  };

  root.querySelectorAll(".cr-pf-triswitch").forEach((sw) => {
    if (sw.getAttribute("data-cr-pf-disabled") === "1" || sw.classList.contains("cr-pf-triswitch--disabled")) {
      return;
    }
    sw.querySelectorAll("button[data-v]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (btn.disabled || sw.getAttribute("data-cr-pf-disabled") === "1") return;
        const section = sw.getAttribute("data-cr-pf-section");
        const key = sw.getAttribute("data-cr-pf-key");
        const v = clampTri(parseInt(btn.getAttribute("data-v"), 10));
        if (!section || key == null || !triState.tri[section]) return;
        if (v === 0) delete triState.tri[section][key];
        else triState.tri[section][key] = v;
        sw.setAttribute("data-state", String(v));
        const row = sw.closest(".cr-pf-option--tri");
        if (row) row.setAttribute("data-tri-state", String(v));
        notify();
      });
    });
  });
}
