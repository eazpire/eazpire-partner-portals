import { describe, it, expect } from "vitest";
import {
  buildProductFilterFacets,
  publicationChannelKeys,
  channelLabelForKey,
  countFilledMetafields,
  indexShopifyNodesById,
  isAmazonChannelPresentStatus,
  isAmazonLiveStatus,
  isAmazonSuccessfullyPublished,
  isAmazonPendingPublish,
  nodePublishedToHeadless,
  nodePublishedToOnlineStore,
  normalizePublicationGid,
} from "../../src/features/manufacturers/adminCreationsProductListEnrich.js";

function product(overrides = {}) {
  return {
    product_key: "pk-1",
    id: "1001",
    title: "Test Product",
    filter_provider: "printify",
    provider_label: "Printify",
    variant_count: 1,
    catalog_count: 0,
    market_count: 0,
    market_labels: [],
    metafields_filled_count: 0,
    channel_count: 0,
    channel_keys: [],
    channel_labels: [],
    alt_image_texts: [],
    branding_white_count: 0,
    branding_black_count: 0,
    needs_update: false,
    ...overrides,
  };
}

describe("adminCreationsProductListEnrich", () => {
  it("publicationChannelKeys returns the fixed Creations sales channel list incl. Amazon + Pending", () => {
    expect(publicationChannelKeys()).toEqual([
      "eazpire",
      "onlineshop",
      "eazpire_headless",
      "amazon_eu",
      "amazon_us",
      "pending_amazon_eu",
      "pending_amazon_us",
    ]);
    expect(channelLabelForKey("amazon_eu")).toBe("Amazon EU");
    expect(channelLabelForKey("amazon_us")).toBe("Amazon US");
    expect(channelLabelForKey("pending_amazon_eu")).toBe("Pending Amazon EU");
    expect(channelLabelForKey("pending_amazon_us")).toBe("Pending Amazon US");
  });

  it("Amazon success vs pending mapping uses Admin status criteria (ASIN / verified / in-flight)", () => {
    expect(isAmazonChannelPresentStatus("verifying")).toBe(true);
    expect(isAmazonChannelPresentStatus("feed_pending")).toBe(true);
    expect(isAmazonChannelPresentStatus("active")).toBe(true);
    expect(isAmazonChannelPresentStatus("dry_run_failed")).toBe(false);
    expect(isAmazonLiveStatus("verifying")).toBe(false);
    expect(isAmazonLiveStatus("active")).toBe(true);

    expect(isAmazonSuccessfullyPublished({ status: "feed_pending" })).toBe(false);
    expect(isAmazonSuccessfullyPublished({ status: "verifying" })).toBe(false);
    expect(isAmazonSuccessfullyPublished({ status: "feed_pending", asin: "B0TEST" })).toBe(true);
    expect(isAmazonSuccessfullyPublished({ status: "failed", verified_status: "BUYABLE" })).toBe(true);
    expect(isAmazonSuccessfullyPublished({ status: "live" })).toBe(true);

    expect(isAmazonPendingPublish({ status: "feed_pending" })).toBe(true);
    expect(isAmazonPendingPublish({ status: "verifying" })).toBe(true);
    expect(isAmazonPendingPublish({ status: "feed_pending", asin: "B0TEST" })).toBe(false);
    expect(isAmazonPendingPublish({ status: "dry_run_failed" })).toBe(false);
    expect(isAmazonPendingPublish({ status: "failed", verified_status: "FAILED", feed_id: "1" })).toBe(
      false
    );
  });

  it("Headless channel uses resourcePublications publication IDs (not listing_origin)", () => {
    const headlessGid = "gid://shopify/Publication/293707546906";
    expect(normalizePublicationGid("293707546906")).toBe(headlessGid);
    expect(
      nodePublishedToHeadless(
        {
          resourcePublications: {
            edges: [
              {
                node: {
                  isPublished: true,
                  publication: { id: headlessGid },
                },
              },
            ],
          },
        },
        [headlessGid]
      )
    ).toBe(true);
    expect(
      nodePublishedToHeadless(
        {
          resourcePublications: {
            edges: [
              {
                node: {
                  isPublished: true,
                  publication: { id: "gid://shopify/Publication/other" },
                },
              },
            ],
          },
        },
        [headlessGid]
      )
    ).toBe(false);
    // listing_origin alone must NOT imply Headless
    expect(nodePublishedToHeadless({ mfListingOrigin: { value: "creator" } }, [headlessGid])).toBe(
      false
    );
  });

  it("Online Store channel uses publications.channel name", () => {
    expect(
      nodePublishedToOnlineStore({
        status: "DRAFT",
        publications: {
          edges: [
            {
              node: {
                isPublished: true,
                channel: { name: "Online Store" },
              },
            },
          ],
        },
      })
    ).toBe(true);
    expect(
      nodePublishedToOnlineStore({
        status: "ACTIVE",
        publications: {
          edges: [
            {
              node: {
                isPublished: false,
                channel: { name: "Online Store" },
              },
            },
          ],
        },
      })
    ).toBe(false);
    // Fallback when publications missing: ACTIVE
    expect(nodePublishedToOnlineStore({ status: "ACTIVE" })).toBe(true);
  });

  it("countFilledMetafields prefers metafields.edges when present", () => {
    expect(
      countFilledMetafields({
        metafields: {
          edges: [
            { node: { value: "a" } },
            { node: { value: "" } },
            { node: { value: "b" } },
          ],
        },
        mfPrintifyId: { value: "ignored-when-edges-present" },
      })
    ).toBe(2);
  });

  it("countFilledMetafields falls back to non-empty mf* values", () => {
    expect(
      countFilledMetafields({
        mfPrintifyId: { value: "pf-1" },
        mfProductKey: { value: "" },
        mfProvider: { value: "printify" },
        mfSample: { value: null },
        title: "Not a metafield",
      })
    ).toBe(2);
    expect(countFilledMetafields(null)).toBe(0);
  });

  it("indexShopifyNodesById normalizes ids and skips unresolvable nodes", () => {
    const map = indexShopifyNodesById([
      { id: "gid://shopify/Product/123" },
      { id: "studio:26" },
      { id: "456.0" },
    ]);
    expect(map.size).toBe(2);
    expect(map.get("123")).toBeTruthy();
    expect(map.get("456")).toBeTruthy();
  });

  it("buildProductFilterFacets returns exact-count facets for variants/catalogs/branding/metafields", () => {
    const products = [
      product({ product_key: "pk-1", filter_provider: "printify", provider_label: "Printify", variant_count: 1 }),
      product({
        product_key: "pk-2",
        filter_provider: "printify",
        provider_label: "Printify",
        variant_count: 8,
        channel_keys: ["eazpire", "onlineshop"],
        channel_labels: ["eazpire", "Online Store"],
        channel_count: 2,
        catalog_count: 52,
        market_count: 52,
        needs_update: true,
      }),
      product({
        product_key: "pk-3",
        filter_provider: "todify",
        provider_label: "Todify",
        variant_count: 25,
        metafields_filled_count: 4,
        alt_image_texts: ["Front view"],
        branding_white_count: 10,
        branding_black_count: 15,
        catalog_count: 1,
        market_count: 1,
      }),
    ];

    const facets = buildProductFilterFacets(products);

    expect(facets.total).toBe(3);

    expect(facets.provider).toEqual(
      expect.arrayContaining([
        { key: "printify", label: "Printify", count: 2 },
        { key: "todify", label: "Todify", count: 1 },
      ])
    );

    expect(facets.variants).toEqual(
      expect.arrayContaining([
        { key: "1", label: "1", count: 1 },
        { key: "8", label: "8", count: 1 },
        { key: "25", label: "25", count: 1 },
      ])
    );

    expect(facets.channels).toEqual(
      expect.arrayContaining([
        { key: "eazpire", label: "eazpire", count: 1 },
        { key: "onlineshop", label: "Online Store", count: 1 },
        { key: "amazon_eu", label: "Amazon EU", count: 0 },
        { key: "amazon_us", label: "Amazon US", count: 0 },
        { key: "pending_amazon_eu", label: "Pending Amazon EU", count: 0 },
        { key: "pending_amazon_us", label: "Pending Amazon US", count: 0 },
      ])
    );

    expect(facets.channel_count).toEqual(
      expect.arrayContaining([
        { key: "0", label: "0", count: 2 },
        { key: "2", label: "2", count: 1 },
      ])
    );

    expect(facets.catalogs).toEqual(
      expect.arrayContaining([
        { key: "0", label: "0", count: 1 },
        { key: "1", label: "1", count: 1 },
        { key: "52", label: "52", count: 1 },
      ])
    );

    expect(facets.metafields).toEqual(
      expect.arrayContaining([
        { key: "0", label: "0", count: 2 },
        { key: "4", label: "4", count: 1 },
      ])
    );

    expect(facets.alt_image_texts).toEqual(
      expect.arrayContaining([
        { key: "missing", label: "Missing alt text", count: 2 },
        { key: "has", label: "Has alt text", count: 1 },
      ])
    );

    expect(facets.branding_white).toEqual(
      expect.arrayContaining([
        { key: "0", label: "0", count: 2 },
        { key: "10", label: "10", count: 1 },
      ])
    );

    expect(facets.branding_black).toEqual(
      expect.arrayContaining([
        { key: "0", label: "0", count: 2 },
        { key: "15", label: "15", count: 1 },
      ])
    );

    expect(facets.needs_update).toEqual(
      expect.arrayContaining([
        { key: "no", label: "Up to date", count: 2 },
        { key: "yes", label: "Needs update", count: 1 },
      ])
    );
  });

  it("buildProductFilterFacets handles an empty product list", () => {
    const facets = buildProductFilterFacets([]);
    expect(facets.total).toBe(0);
    expect(facets.provider).toEqual([]);
    expect(facets.needs_update).toEqual([]);
    expect(facets.channels).toEqual(
      expect.arrayContaining([
        { key: "amazon_eu", label: "Amazon EU", count: 0 },
        { key: "amazon_us", label: "Amazon US", count: 0 },
      ])
    );
  });

  it("buildProductFilterFacets counts Amazon EU/US and Pending Amazon channel keys", () => {
    const facets = buildProductFilterFacets([
      product({
        channel_keys: ["amazon_eu", "eazpire"],
        channel_labels: ["Amazon EU", "eazpire"],
        channel_count: 2,
      }),
      product({
        product_key: "pk-2",
        id: "1002",
        channel_keys: ["amazon_us"],
        channel_labels: ["Amazon US"],
        channel_count: 1,
      }),
      product({
        product_key: "pk-3",
        id: "1003",
        channel_keys: ["pending_amazon_us", "eazpire_headless"],
        channel_labels: ["Pending Amazon US", "eazpire Headless"],
        channel_count: 2,
      }),
    ]);
    expect(facets.channels).toEqual(
      expect.arrayContaining([
        { key: "amazon_eu", label: "Amazon EU", count: 1 },
        { key: "amazon_us", label: "Amazon US", count: 1 },
        { key: "pending_amazon_us", label: "Pending Amazon US", count: 1 },
        { key: "pending_amazon_eu", label: "Pending Amazon EU", count: 0 },
        { key: "eazpire", label: "eazpire", count: 1 },
        { key: "eazpire_headless", label: "eazpire Headless", count: 1 },
      ])
    );
  });
});
