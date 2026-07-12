import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const matrixPath = join(root, "admin-partner-portal/js/catalog-editor/utils/variant-matrix.js");

const { calcVk, vkFromPublishOrCalc } = await import(pathToFileURL(matrixPath).href);

describe("variant-matrix pricing", () => {
  it("calcVk applies fixed dollar margin in cents", () => {
    const ek = 1625; // $16.25
    expect(calcVk(ek, "fixed", 10)).toBe(2625); // $26.25
  });

  it("calcVk applies percent margin", () => {
    const ek = 1000;
    expect(calcVk(ek, "percent", 30)).toBe(1300);
  });

  it("vkFromPublishOrCalc prefers stale publish price when below legacy threshold", () => {
    const prices = new Map([["123", 2058]]);
    const ek = 1625;
    expect(vkFromPublishOrCalc(prices, "123", ek, true, "fixed", 10)).toBe(2058);
  });

  it("vkFromPublishOrCalc falls back to calcVk when publish price looks like legacy cost×100 bug", () => {
    const prices = new Map([["123", 81250]]);
    const ek = 1625;
    expect(vkFromPublishOrCalc(prices, "123", ek, true, "fixed", 10)).toBe(2625);
  });

  it("buildSizeRow initial VK uses calcVk not prices_json (regression)", () => {
    const src = readFileSync(matrixPath, "utf8");
    expect(src).toContain("calcVk(ek, profitMode, profitVal)");
    expect(src).not.toMatch(/buildSizeRow[\s\S]*vkFromPublishOrCalc/);
    expect(src).toContain("updateRowVk(row)");
  });
});
