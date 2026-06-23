import { describe, it, expect } from "vitest";
import {
  PARTNER_CALIBRATION_PH_PREFIX,
  isPartnerCalibrationPhFillImage,
  collectCalibrationPlaceholderTargets,
  applyCalibrationGreenToPrintAreas,
  createSolidGreenPngBuffer,
  viewKeyToPrintAreaKey,
  normPlaceholderPosition,
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
    expect(targets.has("back")).toBe(false);
  });

  it("applies green upload id to creator-design placeholder", () => {
    const areas = [
      {
        placeholders: [
          {
            position: "front",
            width: 100,
            height: 100,
            images: [{ id: "old", type: "image", x: "0.1", y: "0.1", scale: "0.5" }],
          },
        ],
      },
    ];
    const idMap = new Map([["front", "upload-green-1"]]);
    const scaleMap = new Map([["front", 1]]);
    const out = applyCalibrationGreenToPrintAreas(areas, idMap, scaleMap);
    const ph = out[0].placeholders[0];
    expect(ph.images[0].id).toBe("upload-green-1");
    expect(ph.images[0].x).toBe("0.5");
    expect(ph.images[0].scale).toBe("1.000000");
  });

  it("maps view keys to print area keys", () => {
    expect(viewKeyToPrintAreaKey("white_front")).toBe("front");
    expect(viewKeyToPrintAreaKey("back")).toBe("back");
    expect(normPlaceholderPosition("Left-Sleeve")).toBe("left_sleeve");
  });
});
