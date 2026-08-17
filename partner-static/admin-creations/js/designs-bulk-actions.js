/**
 * Which bulk dock actions apply to the current design selection.
 * Counts are "how many selected designs this action would change".
 */

export function libraryStatusOf(item) {
  return String(item?.library_status || "").trim().toLowerCase() === "inactive" ? "inactive" : "active";
}

export function visibilityOf(item) {
  const top = item?.visibility;
  const meta = item?.metadata && typeof item.metadata === "object" ? item.metadata.visibility : "";
  const raw = top != null && String(top).trim() !== "" ? top : meta;
  return String(raw || "private").trim().toLowerCase() === "public" ? "public" : "private";
}

export function hasSavedDesignId(item) {
  const id = Number(item?.id || 0);
  return Number.isFinite(id) && id > 0;
}

/** List-level update signal: Printify unpublished_changes (same as Designs filter). */
export function designHasUpdatableChanges(item) {
  if (!item || !hasSavedDesignId(item)) return false;
  if (item.has_updatable_changes === true) return true;
  const statuses = Array.isArray(item.printify_statuses) ? item.printify_statuses.map(String) : [];
  return statuses.includes("unpublished_changes");
}

export function computeDesignBulkActionCounts(items) {
  const list = Array.isArray(items) ? items : [];
  const counts = {
    selected: list.length,
    activate: 0,
    deactivate: 0,
    public: 0,
    private: 0,
    update: 0,
    publish: 0,
    remove: list.length,
  };
  for (const item of list) {
    if (!hasSavedDesignId(item)) continue;
    if (libraryStatusOf(item) === "inactive") counts.activate += 1;
    else counts.deactivate += 1;
    if (visibilityOf(item) === "private") counts.public += 1;
    else counts.private += 1;
    if (designHasUpdatableChanges(item)) counts.update += 1;
    if (item.is_publishable !== false) counts.publish += 1;
  }
  return counts;
}
