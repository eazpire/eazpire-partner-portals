import { describe, it, expect } from "vitest";
import { buildMockupImagesByView, pickMockUrlForView } from "../../src/features/manufacturers/partnerCatalog/mockupImagesByView.js";

describe("mockupImagesByView", () => {
  it("groups images by view and color", () => {
    const byView = buildMockupImagesByView([
      { view_key: "front", color_name: "Black", image_url: "https://x/black.jpg", is_default: 1 },
      { view_key: "front", color_name: "White", image_url: "https://x/white.jpg", is_default: 0 },
    ]);
    expect(byView.front.Black.image_url).toBe("https://x/black.jpg");
    expect(byView.front.White.image_url).toBe("https://x/white.jpg");
  });

  it("picks default or first mock url", () => {
    const byView = buildMockupImagesByView([
      { view_key: "back", color_name: "Red", image_url: "https://x/red.jpg", is_default: 0 },
      { view_key: "back", color_name: "Blue", image_url: "https://x/blue.jpg", is_default: 1 },
    ]);
    expect(pickMockUrlForView(byView, "back")).toBe("https://x/blue.jpg");
    expect(pickMockUrlForView(byView, "back", "Red")).toBe("https://x/red.jpg");
  });
});
