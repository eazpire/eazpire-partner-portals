/**
 * Print area validation (Bauplan §8.3)
 */

export function validatePrintArea(input) {
  const errors = [];
  const width = Number(input?.width_px);
  const height = Number(input?.height_px);
  const dpi = Number(input?.dpi ?? 300);
  const safe = input?.safe_zone || input?.safe_zone_json || {};
  const fileTypes = input?.supported_file_types || input?.allowed_file_types || ["png"];

  if (!width || width <= 0) errors.push("width_px_invalid");
  if (!height || height <= 0) errors.push("height_px_invalid");
  if (!dpi || dpi < 150) errors.push("dpi_too_low");
  if (!Array.isArray(fileTypes) || fileTypes.length === 0) errors.push("file_types_required");

  if (safe && width && height) {
    const sx = Number(safe.x ?? 0);
    const sy = Number(safe.y ?? 0);
    const sw = Number(safe.width ?? width);
    const sh = Number(safe.height ?? height);
    if (sx < 0 || sy < 0 || sw <= 0 || sh <= 0) errors.push("safe_zone_invalid");
    if (sx + sw > width || sy + sh > height) errors.push("safe_zone_outside_canvas");
  }

  return { ok: errors.length === 0, errors };
}

export function validatePrintAreaForSubmit(areas) {
  if (!Array.isArray(areas) || areas.length === 0) {
    return { ok: false, errors: ["print_area_required"] };
  }
  for (const area of areas) {
    const v = validatePrintArea(area);
    if (!v.ok) return v;
  }
  return { ok: true, errors: [] };
}
