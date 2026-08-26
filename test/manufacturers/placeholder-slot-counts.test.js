import { describe, it, expect } from "vitest";
import {
  hasAnyPlaceholderSlotCounts,
  keepPreviousPlaceholderSlotsIfCollectWouldWipe,
  derivePlaceholderSlotsFromEazEditor,
} from "../../admin-partner-portal/js/catalog-editor/provider-print-technical.js";

describe("placeholder slot counts (Provider Print area positions)", () => {
  it("treats empty PAT map as no explicit slots", () => {
    expect(hasAnyPlaceholderSlotCounts({})).toBe(false);
    expect(hasAnyPlaceholderSlotCounts(null)).toBe(false);
  });

  it("keeps previous slots when a collect would save all zeros", () => {
    const prev = {
      front: { qr: 0, logo: 0, creator_design: 1, additional_design: 0 },
      neck: { qr: 0, logo: 1, creator_design: 0, additional_design: 0 },
      back: { qr: 0, logo: 0, creator_design: 0, additional_design: 0 },
    };
    const collected = {
      front: { qr: 0, logo: 0, creator_design: 0, additional_design: 0 },
      neck: { qr: 0, logo: 0, creator_design: 0, additional_design: 0 },
      back: { qr: 0, logo: 0, creator_design: 0, additional_design: 0 },
    };
    expect(keepPreviousPlaceholderSlotsIfCollectWouldWipe(prev, collected)).toEqual(prev);
  });

  it("accepts a real all-zero collect when previous was also empty", () => {
    const zeros = { front: { qr: 0, logo: 0, creator_design: 0, additional_design: 0 } };
    expect(keepPreviousPlaceholderSlotsIfCollectWouldWipe({}, zeros)).toEqual(zeros);
  });

  it("reads front creator + neck logo from eaz_editor, not legacy edit_mode back design", () => {
    const cfg = {
      eaz_admin: {
        by_version: {
          standard: {
            by_design_type: {
              classic: {
                eaz_editor: {
                  placeholders_by_position: {
                    neck: [{ name: "logo" }],
                    front: [{ name: "creator_design" }],
                  },
                },
              },
            },
          },
        },
      },
      by_design_type: {
        classic: {
          edit_mode: {
            back: { areas: [{ type: "creator_design" }] },
            front: { areas: [{ type: "creator_design" }] },
            neck: { areas: [{ type: "logo" }] },
          },
        },
      },
    };
    const slots = derivePlaceholderSlotsFromEazEditor(cfg);
    expect(slots.front.creator_design).toBe(1);
    expect(slots.neck.logo).toBe(1);
    expect(slots.back).toBeUndefined();
  });
});
