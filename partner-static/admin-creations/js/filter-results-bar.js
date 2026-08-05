/**
 * Shared Results bar for Admin Designs / Products filter pages.
 * Count + Include/Exclude chips with × to clear back to neutral.
 */

import { escapeHtml } from "/creations/shared/js/partner-api.js";

function chipHtml(chip, kind) {
  const section = chip.section != null ? String(chip.section) : "";
  const value = chip.value != null ? String(chip.value) : "";
  const label = String(chip.label || value || "");
  const kindClass =
    kind === "exclude" ? "cr-results-bar__chip--exclude" : kind === "search" ? "cr-results-bar__chip--search" : "cr-results-bar__chip--include";
  const removeAttrs =
    kind === "search"
      ? `data-cr-results-clear-search="1"`
      : `data-cr-results-section="${escapeHtml(section)}" data-cr-results-value="${escapeHtml(value)}"`;
  return `<span class="cr-results-bar__chip ${kindClass}" title="${escapeHtml(label)}">
    <span class="cr-results-bar__chip-text">${escapeHtml(label)}</span>
    <button type="button" class="cr-results-bar__chip-x" ${removeAttrs} aria-label="Remove filter ${escapeHtml(label)}">×</button>
  </span>`;
}

function groupHtml(title, chips, kind) {
  if (!chips.length) return "";
  return `<div class="cr-results-bar__group" data-kind="${escapeHtml(kind)}">
    <span class="cr-results-bar__group-label">${escapeHtml(title)}</span>
    ${chips.map((c) => chipHtml(c, kind)).join("")}
  </div>`;
}

/**
 * @param {{
 *   count: number,
 *   nounSingular: string,
 *   nounPlural: string,
 *   searchQuery?: string,
 *   includeChips?: Array<{ section: string, value: string, label: string }>,
 *   excludeChips?: Array<{ section: string, value: string, label: string }>,
 *   loading?: boolean,
 * }} opts
 */
export function filterResultsBarHtml(opts = {}) {
  const n = Math.max(0, Number(opts.count) || 0);
  const noun = n === 1 ? opts.nounSingular || "item" : opts.nounPlural || "items";
  const search = String(opts.searchQuery || "").trim();
  const includeChips = Array.isArray(opts.includeChips) ? opts.includeChips : [];
  const excludeChips = Array.isArray(opts.excludeChips) ? opts.excludeChips : [];
  const loading = !!opts.loading;
  const hasFilters = !!(search || includeChips.length || excludeChips.length);
  const countLabel = loading && n === 0 ? "…" : n.toLocaleString("en-US");

  // Inner markup only — host element already has class `cr-results-bar`.
  return `
      <div class="cr-results-bar__count">${countLabel} ${escapeHtml(noun)}</div>
      <div class="cr-results-bar__chips">
        ${
          search
            ? chipHtml({ section: "search", value: "q", label: `Search: ${search}` }, "search")
            : ""
        }
        ${groupHtml("Include", includeChips, "include")}
        ${groupHtml("Exclude", excludeChips, "exclude")}
        ${
          !hasFilters
            ? `<span class="cr-results-bar__hint">No filters selected</span>`
            : `<button type="button" class="cr-results-bar__clear" data-cr-results-clear-all="1">Clear all</button>`
        }
      </div>`;
}

/**
 * @param {HTMLElement|null} root
 * @param {{
 *   onRemoveTri?: (section: string, value: string) => void,
 *   onClearSearch?: () => void,
 *   onClearAll?: () => void,
 * }} handlers
 */
export function bindFilterResultsBar(root, handlers = {}) {
  if (!root) return;

  root.querySelectorAll("[data-cr-results-clear-search]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handlers.onClearSearch?.();
    });
  });

  root.querySelectorAll("[data-cr-results-clear-all]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handlers.onClearAll?.();
    });
  });

  root.querySelectorAll("[data-cr-results-section]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const section = btn.getAttribute("data-cr-results-section");
      const value = btn.getAttribute("data-cr-results-value");
      if (section == null || value == null) return;
      handlers.onRemoveTri?.(section, value);
    });
  });
}
