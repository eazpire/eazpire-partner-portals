/**
 * Map a portal pathname onto its default child view.
 * `/creations` must land on Designs — not an empty root section.
 */
export function resolveShellRoute(path, aliases = {}) {
  const raw = String(path || "").replace(/\/$/, "") || "/";
  return aliases[raw] || raw;
}
