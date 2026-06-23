import { describe, it, expect } from "vitest";
import {
  PARTNER_CALIBRATION_PH_PREFIX,
  isPartnerCalibrationPhFillImage,
  collectCalibrationPlaceholderTargets,
  applyCalibrationGreenToPrintAreas,
  createSolidGreenPngBuffer,
  viewKeyToPrintAreaKey,
  normPlaceholderPosition,
  resolveCalibrationPlaceholderDimensions,
} from "../../src/features/manufacturers/partnerCatalog/setPrintifyCalibrationMarkers.js";

describe("setPrintifyCalibrationMarkers", () => {
  it("detects partner calibration fill images by filename", () => {
    expect(isPartnerCalibrationPhFillImage({ file_name: `${PARTNER_CALIBRATION_PH_PREFIX}-front.png` })).toBe(true);
    expect(isPartnerCalibrationPhFillImage({ filename: "other.png" })).toBe(false);
  });

  it("creates green PNG with exact dimensions", () => {
    const buf = createSolidGreenPngBuffer(120, 80);
    expect(buf.byteLength).toBeGreaterThan(100);
  });

  it("collects placeholder targets with width/height", () => {
    const targets = collectCalibrationPlaceholderTargets([
      {
        placeholders: [
          { position: "front", width: 2400, height: 3200, images: [{ type: "image" }] },
          { position: "back", width: 2400, height: 3200, images: [{ type: "text" }] },
        ],
      },
    ]);
    expect(targets.has("front")).toBe(true);
    expect(targets.get("front")).toEqual({ width: 2400, height: 3200 });
    expect(targets.has("back")).toBe(true);
  });

  it("resolves dimensions from image metadata when placeholder width is missing", () => {
    const dims = resolveCalibrationPlaceholderDimensions(
      { position: "front", images: [{ width: 1800, height: 2400 }] },
      {},
      null
    );
    expect(dims).toEqual({ width: 1800, height: 2400 });
    const targets = collectCalibrationPlaceholderTargets(
      [{ placeholders: [{ position: "front", images: [{ width: 1800, height: 2400 }] }] }],
      null
    );
    expect(targets.get("front")).toEqual({ width: 1800, height: 2400 });
  });

  it("falls back to catalog dimensions by position", () => {
    const catalog = new Map([["front", { width: 4200, height: 4800 }]]);
    const targets = collectCalibrationPlaceholderTargets(
      [{ placeholders: [{ position: "front", images: [] }] }],
      catalog
    );
    expect(targets.get("front")).toEqual({ width: 4200, height: 4800 });
  });

  it("prefers catalog dimensions over scaled-down design image metadata", () => {
    const catalog = new Map([
      ["front", { width: 3185, height: 3636 }],
      ["back", { width: 3185, height: 3636 }],
    ]);
    const targets = collectCalibrationPlaceholderTargets(
      [
        {
          placeholders: [
            {
              position: "front",
              images: [{ type: "image/png", width: 2560, height: 3136, scale: 0.01 }],
            },
          ],
        },
      ],
      catalog
    );
    expect(targets.get("front")).toEqual({ width: 3185, height: 3636 });
  });

  it("replaces all existing images with only the green marker", () => {
    const areas = [
      {
        placeholders: [
          {
            position: "front",
            width: 100,
            height: 100,
            images: [
              { id: "old-design", type: "image", x: "0.1", y: "0.1", scale: "0.5" },
              { id: "qr-code", type: "qr" },
              { id: "brand-logo", type: "logo", name: "eazpire-branding.png" },
            ],
          },
        ],
      },
    ];
    const idMap = new Map([["front", "upload-green-1"]]);
    const scaleMap = new Map([["front", 1]]);
    const out = applyCalibrationGreenToPrintAreas(areas, idMap, scaleMap);
    const ph = out[0].placeholders[0];
    expect(ph.images).toHaveLength(1);
    expect(ph.images[0].id).toBe("upload-green-1");
    expect(ph.images[0].x).toBe("0.5");
    expect(ph.images[0].scale).toBe("1.000000");
  });

  it("clears non-target placeholders so only green markers remain", () => {
    const areas = [
      {
        placeholders: [
          {
            position: "front",
            width: 100,
            height: 100,
            images: [{ id: "old", type: "image" }],
          },
          {
            position: "neck",
            images: [{ id: "neck-logo", type: "logo" }],
          },
        ],
      },
    ];
    const idMap = new Map([["front", "upload-green-1"]]);
    const scaleMap = new Map([["front", 1]]);
    const out = applyCalibrationGreenToPrintAreas(areas, idMap, scaleMap);
    expect(out[0].placeholders[0].images).toHaveLength(1);
    expect(out[0].placeholders[1].images).toEqual([]);
  });

  it("maps view keys to print area keys", () => {
    expect(viewKeyToPrintAreaKey("white_front")).toBe("front");
    expect(viewKeyToPrintAreaKey("back")).toBe("back");
    expect(normPlaceholderPosition("Left-Sleeve")).toBe("left_sleeve");
  });
});
