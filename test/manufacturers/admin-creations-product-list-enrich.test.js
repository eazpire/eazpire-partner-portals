import { describe, it, expect } from "vitest";
import {
  buildProductFilterFacets,
  publicationChannelKeys,
  channelLabelForKey,
  amazonMarketKeys,
  amazonMarketLabelForKey,
  amazonStatusKeys,
  countFilledMetafields,
  extractFilledMetafieldMap,
  buildAltImageGroupsFromNode,
  regroupAltImagesByView,
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
  it("publicationChannelKeys returns Shopify Channels only (eazpire Web / Android)", () => {
    expect(publicationChannelKeys()).toEqual(["onlineshop", "eazpire_headless"]);
    expect(channelLabelForKey("onlineshop")).toBe("eazpire Web");
    expect(channelLabelForKey("eazpire_headless")).toBe("eazpire Android");
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

  it("extractFilledMetafieldMap builds namespace.key map from edges", () => {
    expect(
      extractFilledMetafieldMap({
        metafields: {
          edges: [
            { node: { namespace: "custom", key: "product_key", value: "pk-1" } },
            { node: { namespace: "custom", key: "provider", value: "" } },
            { node: { namespace: "descriptors", key: "subtitle", value: "Hello" } },
            { node: { namespace: "custom", key: "missing_ns_skip", value: "x" } }, // still has ns+key
          ],
        },
        mfPrintifyId: { value: "ignored-when-edges-present" },
      })
    ).toEqual({
      "custom.product_key": "pk-1",
      "descriptors.subtitle": "Hello",
      "custom.missing_ns_skip": "x",
    });
  });

  it("extractFilledMetafieldMap falls back to aliased mf* fields", () => {
    expect(
      extractFilledMetafieldMap({
        mfPrintifyId: { value: "pf-1" },
        mfProductKey: { value: "" },
        mfProvider: { value: "printify" },
        mfSample: { value: null },
      })
    ).toEqual({
      "custom.printify_product_id": "pf-1",
      "custom.provider": "printify",
    });
    expect(extractFilledMetafieldMap(null)).toEqual({});
  });

  it("buildAltImageGroupsFromNode groups by Color|view alt and marks Featured first", () => {
    const groups = buildAltImageGroupsFromNode({
      featuredMedia: { image: { url: "https://cdn.example/black-front.jpg" } },
      images: {
        edges: [
          {
            node: {
              url: "https://cdn.example/red-back.jpg",
              altText: "Red|back",
            },
          },
          {
            node: {
              url: "https://cdn.example/black-front.jpg",
              altText: "Black|front|preview-default",
            },
          },
          {
            node: {
              url: "https://cdn.example/black-lifestyle.jpg",
              altText: "Black|lifestyle",
            },
          },
          {
            node: {
              url: "https://cdn.example/red-front.jpg",
              altText: "Red|front",
            },
          },
        ],
      },
    });

    expect(groups.map((g) => g.variant_label)).toEqual(["Black", "Red"]);
    expect(groups[0].views.map((v) => v.view)).toEqual(["front", "lifestyle"]);
    expect(groups[0].views[0].is_featured).toBe(true);
    expect(groups[0].views[0].is_preview).toBe(true);
    expect(groups[1].views.map((v) => v.view)).toEqual(["front", "back"]);

    const byView = regroupAltImagesByView(groups);
    expect(byView.map((g) => g.view)).toEqual(["front", "back", "lifestyle"]);
    expect(byView[0].variants.map((v) => v.variant_label)).toEqual(["Black", "Red"]);
    expect(byView[1].variants.map((v) => v.variant_label)).toEqual(["Red"]);
  });

  it("enrich prefers Shopify node variants / metafields / Color|view alts (Customer Softstyle)", async () => {
    const { enrichCreationsProductListFacets } = await import(
      "../../src/features/manufacturers/adminCreationsProductListEnrich.js"
    );
    const node = {
      id: "gid://shopify/Product/10351905505562",
      status: "ACTIVE",
      totalVariants: { count: 55 },
      featuredMedia: { image: { url: "https://cdn.example/white-front.jpg" } },
      images: {
        edges: [
          {
            node: {
              url: "https://cdn.example/white-front.jpg",
              altText: "White|front|preview-default",
            },
          },
          { node: { url: "https://cdn.example/white-back.jpg", altText: "White|back" } },
          { node: { url: "https://cdn.example/red-front.jpg", altText: "Red|front|preview-default" } },
        ],
      },
      metafields: {
        edges: [
          { node: { namespace: "custom", key: "product_key", value: "unisex-softstyle-cotton-tee" } },
          { node: { namespace: "custom", key: "printify_product_id", value: "pf-1" } },
        ],
      },
      publications: { edges: [] },
      resourcePublications: { edges: [] },
      variants: {
        nodes: [
          { selectedOptions: [{ name: "Color", value: "White" }, { name: "Size", value: "S" }] },
          { selectedOptions: [{ name: "Color", value: "Red" }, { name: "Size", value: "M" }] },
        ],
      },
    };
    const nodes = indexShopifyNodesById([node]);
    const [row] = await enrichCreationsProductListFacets(
      {},
      [
        {
          id: "studio:1",
          product_key: "unisex-softstyle-cotton-tee",
          title: "Softstyle",
          shopify_product_id: "10351905505562",
          source: "customer",
          images: ["https://cdn.example/studio-stub.jpg"],
          grid_views: [
            {
              src: "https://cdn.example/studio-stub.jpg",
              view: "front",
              variant_label: "Default",
              alt: "",
            },
          ],
        },
      ],
      nodes
    );
    expect(row.variant_count).toBe(55);
    expect(row.metafields_filled_count).toBe(2);
    expect(row.alt_image_texts).toEqual([
      "White|front|preview-default",
      "White|back",
      "Red|front|preview-default",
    ]);
    expect(row.alt_image_groups.map((g) => g.variant_label).sort()).toEqual(["Red", "White"]);
    expect(row.live_colors).toEqual(["White", "Red"]);
  });

  it("enrich live_colors ignore leftover mockup labels when Shopify no longer has that color", async () => {
    const { enrichCreationsProductListFacets } = await import(
      "../../src/features/manufacturers/adminCreationsProductListEnrich.js"
    );
    const node = {
      id: "gid://shopify/Product/10366679154970",
      status: "ACTIVE",
      totalVariants: { count: 4 },
      images: {
        edges: [{ node: { url: "https://cdn.example/black.png", altText: "Black|front" } }],
      },
      metafields: { edges: [] },
      publications: { edges: [] },
      resourcePublications: { edges: [] },
      variants: {
        nodes: [
          { selectedOptions: [{ name: "Color", value: "White" }, { name: "Size", value: "S" }] },
          { selectedOptions: [{ name: "Color", value: "Navy" }, { name: "Size", value: "M" }] },
        ],
      },
    };
    const [row] = await enrichCreationsProductListFacets(
      {},
      [
        {
          id: "10366679154970",
          shopify_product_id: "10366679154970",
          title: "Scruffy Dog",
          live_colors: ["Black"],
          grid_views: [{ src: "https://cdn.example/black.png", variant_label: "Black" }],
        },
      ],
      indexShopifyNodesById([node])
    );
    expect(row.live_colors).toEqual(["White", "Navy"]);
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
        channel_keys: ["onlineshop"],
        channel_labels: ["eazpire Web"],
        channel_count: 1,
        amazon_market_keys: ["amazon_eu", "amazon_de"],
        amazon_status_keys: ["online"],
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

    expect(facets.channels).toEqual([
      { key: "onlineshop", label: "eazpire Web", count: 1 },
      { key: "eazpire_headless", label: "eazpire Android", count: 0 },
    ]);
    expect(facets.amazon_markets.find((f) => f.key === "amazon_eu")).toMatchObject({
      label: "Amazon EU",
      count: 1,
      depth: 0,
    });
    expect(facets.amazon_markets.find((f) => f.key === "amazon_de")).toMatchObject({
      label: "DE",
      count: 1,
      depth: 1,
    });
    expect(facets.amazon_status).toEqual(
      expect.arrayContaining([
        { key: "online", label: "Online", count: 1 },
        { key: "pending", label: "Pending", count: 0 },
      ])
    );

    expect(facets.channel_count).toBeUndefined();

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
    expect(facets.channels).toEqual([
      { key: "onlineshop", label: "eazpire Web", count: 0 },
      { key: "eazpire_headless", label: "eazpire Android", count: 0 },
    ]);
    expect(facets.amazon_markets[0]).toMatchObject({ key: "amazon_eu", label: "Amazon EU", count: 0, depth: 0 });
    expect(facets.amazon_status).toEqual([
      { key: "online", label: "Online", count: 0 },
      { key: "pending", label: "Pending", count: 0 },
    ]);
  });

  it("buildProductFilterFacets splits Channels / Amazon Markets / Amazon Status", () => {
    expect(amazonMarketKeys()[0]).toBe("amazon_eu");
    expect(amazonMarketLabelForKey("amazon_na")).toBe("Amazon US");
    expect(amazonStatusKeys()).toEqual(["online", "pending"]);

    const facets = buildProductFilterFacets([
      product({
        channel_keys: ["onlineshop"],
        channel_labels: ["eazpire Web"],
        amazon_market_keys: ["amazon_eu", "amazon_de"],
        amazon_status_keys: ["online"],
      }),
      product({
        product_key: "pk-2",
        id: "1002",
        channel_keys: ["eazpire_headless"],
        channel_labels: ["eazpire Android"],
        amazon_market_keys: ["amazon_na", "amazon_us"],
        amazon_status_keys: ["pending"],
      }),
      product({
        product_key: "pk-3",
        id: "1003",
        channel_keys: [],
        amazon_market_keys: ["amazon_eu", "amazon_fr"],
        amazon_status_keys: ["online", "pending"],
      }),
    ]);
    expect(facets.channels).toEqual([
      { key: "onlineshop", label: "eazpire Web", count: 1 },
      { key: "eazpire_headless", label: "eazpire Android", count: 1 },
    ]);
    expect(facets.amazon_markets.find((f) => f.key === "amazon_eu")?.count).toBe(2);
    expect(facets.amazon_markets.find((f) => f.key === "amazon_na")?.count).toBe(1);
    expect(facets.amazon_markets.find((f) => f.key === "amazon_de")?.count).toBe(1);
    expect(facets.amazon_status.find((f) => f.key === "online")?.count).toBe(2);
    expect(facets.amazon_status.find((f) => f.key === "pending")?.count).toBe(2);
  });
});
