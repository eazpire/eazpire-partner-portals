import { describe, expect, it } from "vitest";
import { buildAdminGridViews } from "../../src/features/manufacturers/adminCreationsPortalApi.js";

describe("adminCreationsPortalApi helpers", () => {
  it("builds front/back grid views from saved listing mock URLs", () => {
    const views = buildAdminGridViews({
      previewUrl: "https://cdn.example/studio-front-preview.jpg",
      mockUrlsJson: JSON.stringify([
        "https://cdn.example/studio-front-preview.jpg",
        "https://cdn.example/studio-back-preview.jpg",
      ]),
      previewMockIndex: 0,
    });

    expect(views.map((v) => v.view)).toEqual(["front", "back"]);
    expect(views.map((v) => v.src)).toEqual([
      "https://cdn.example/studio-front-preview.jpg",
      "https://cdn.example/studio-back-preview.jpg",
    ]);
    expect(views[0].is_preview).toBe(true);
  });
});
