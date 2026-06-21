import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const portal = join(__dirname, "../../admin-partner-portal/js/catalog-editor");
const helpersSrc = readFileSync(join(portal, "print-area/helpers.js"), "utf8");

/** Mirrors rectFromSavedSource + resolveRedRectForView saved-path (no aspect shrink). */
function rectFromSavedSource(raw) {
  const r = typeof raw === "object" ? raw : JSON.parse(String(raw));
  const out = {
    x: Number(r.x) || 0,
    y: Number(r.y) || 0,
    w: Math.max(0.02, Math.min(1, Number(r.w) || 0.4)),
    h: Math.max(0.02, Math.min(1, Number(r.h) || 0.4)),
    angle: Number(r.angle) || 0,
  };
  out.x = Math.max(0, Math.min(1 - out.w, out.x));
  out.y = Math.max(0, Math.min(1 - out.h, out.y));
  return out;
}

describe("print area rect persistence", () => {
  it("helpers preserve saved rect without normalizeRectToPrintAspect on DB load", () => {
    expect(helpersSrc).toContain("export function rectFromSavedSource");
    expect(helpersSrc).toMatch(/hasDbPrintAreaRect\(md\)[\s\S]{0,80}rectFromSavedSource/);
    expect(helpersSrc).not.toMatch(
      /hasDbPrintAreaRect\(md\)[\s\S]{0,120}normalizeRectToPrintAspect\(md\.print_area_rect_json/
    );
  });

  it("saved rect path keeps exact dimensions", () => {
    const saved = { x: 0.1, y: 0.15, w: 0.72, h: 0.36, angle: 12 };
    const out = rectFromSavedSource(saved);
    expect(out.x).toBeCloseTo(saved.x, 4);
    expect(out.y).toBeCloseTo(saved.y, 4);
    expect(out.w).toBeCloseTo(saved.w, 4);
    expect(out.h).toBeCloseTo(saved.h, 4);
    expect(out.angle).toBeCloseTo(saved.angle, 4);
  });

  it("savePrintAreaTab persists mockup default rects on tab save", () => {
    const tabSrc = readFileSync(join(portal, "tabs/print-area.js"), "utf8");
    expect(tabSrc).toContain("persistMockupDefaultRects");
    expect(tabSrc).toContain("savePrintAreaRect");
    expect(tabSrc).toContain("st.boundsDirty = false");
    expect(tabSrc).toContain("loadRectsForVariantGroup(st, data, st.activeVariantGroupId)");
  });

  it("dual-viewer skips aspect re-fit for saved DB rects on mount", () => {
    const src = readFileSync(join(portal, "print-area/dual-viewer.js"), "utf8");
    expect(src).toContain("!st.boundsDirty && hasDbPrintAreaRect(md)");
  });

  it("variant group load uses rectFromSavedSource", () => {
    expect(helpersSrc).toMatch(/vpa\?\.print_area_rect_json[\s\S]{0,80}rectFromSavedSource/);
  });
});
