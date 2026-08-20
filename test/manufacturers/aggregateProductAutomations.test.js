import { describe, it, expect } from "vitest";
import {
  AMAZON_EU_CODES,
  aggregateProductAutomations,
  enabledAmazonCountries,
  emptyAutomationsSummary,
} from "../../src/features/manufacturers/partnerCatalog/aggregateProductAutomations.js";

describe("aggregateProductAutomations", () => {
  it("returns an empty dash state when nothing is on", () => {
    expect(aggregateProductAutomations([])).toEqual(emptyAutomationsSummary());
    expect(
      aggregateProductAutomations([
        { is_active: 1, auto_publish_enabled: 0, automation_shopify_sync_enabled: 0, automation_amazon_publish_enabled: 0 },
      ])
    ).toEqual(emptyAutomationsSummary());
  });

  it("ignores inactive versions", () => {
    const summary = aggregateProductAutomations([
      {
        is_active: 0,
        auto_publish_enabled: 1,
        automation_shopify_sync_enabled: 1,
        automation_amazon_publish_enabled: 1,
        amazon_markets: { DE: true },
      },
    ]);
    expect(summary).toEqual(emptyAutomationsSummary());
  });

  it("shows a channel when any active version has it on", () => {
    const summary = aggregateProductAutomations([
      { is_active: 1, auto_publish_enabled: 1, automation_shopify_sync_enabled: 0, automation_amazon_publish_enabled: 0 },
      { is_active: 1, auto_publish_enabled: 0, automation_shopify_sync_enabled: 1, automation_amazon_publish_enabled: 0 },
    ]);
    expect(summary.printify).toBe(true);
    expect(summary.shopify).toBe(true);
    expect(summary.amazon).toBe(false);
    expect(summary.mixed).toBe(true);
  });

  it("unions Amazon countries and defaults to EU when Amazon is on without markets", () => {
    const summary = aggregateProductAutomations([
      {
        is_active: 1,
        auto_publish_enabled: 1,
        automation_shopify_sync_enabled: 1,
        automation_amazon_publish_enabled: 1,
        amazon_markets: { DE: true, FR: true },
      },
      {
        is_active: 1,
        auto_publish_enabled: 1,
        automation_shopify_sync_enabled: 1,
        automation_amazon_publish_enabled: 1,
        amazon_markets: { IT: true, US: true },
      },
    ]);
    expect(summary.amazon).toBe(true);
    expect(summary.amazon_countries).toEqual(["FR", "DE", "IT", "US"]);
    expect(summary.amazon_count).toBe(4);
    expect(summary.mixed).toBe(false);

    expect(enabledAmazonCountries({}, true)).toEqual(AMAZON_EU_CODES);
    const softstyle = aggregateProductAutomations([
      {
        is_active: 1,
        auto_publish_enabled: 1,
        automation_shopify_sync_enabled: 1,
        automation_amazon_publish_enabled: 1,
        amazon_markets: {},
      },
    ]);
    expect(softstyle.amazon_count).toBe(AMAZON_EU_CODES.length);
    expect(softstyle.amazon_countries).toEqual(AMAZON_EU_CODES);
  });

  it("reads manufacturer auto_publish_config JSON shape", () => {
    const summary = aggregateProductAutomations([
      {
        is_active: 1,
        auto_publish_config: {
          auto_publish_enabled: true,
          automation_shopify_sync_enabled: true,
          automation_amazon_publish_enabled: false,
        },
      },
    ]);
    expect(summary.printify).toBe(true);
    expect(summary.shopify).toBe(true);
    expect(summary.amazon).toBe(false);
  });
});
