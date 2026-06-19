/**
 * Catalog Studio — partner / provider tree + product list for admin UI
 */

import { listPartnersForAdmin } from "./printifyPartnerSeed.js";
import { listFulfillmentProviders } from "./fulfillmentProviderService.js";
import { listEazpireProducts } from "./eazpireProductService.js";

async function queryAll(db, sql, ...binds) {
  const stmt = db.prepare(sql);
  const res = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
  return res?.results || [];
}

export async function getCatalogStudioTree(db) {
  const partners = await listPartnersForAdmin(db);
  const out = [];
  for (const partner of partners) {
    const providers = await listFulfillmentProviders(db, partner.id);
    out.push({
      id: partner.id,
      name: partner.name,
      slug: partner.slug,
      integration_type: partner.integration_type,
      provider_count: partner.fulfillment_provider_count,
      live_blueprint_count: partner.live_blueprint_count,
      eazpire_product_count: partner.eazpire_product_count,
      providers: providers.map((fp) => ({
        id: fp.id,
        name: fp.name,
        external_provider_id: fp.external_provider_id,
        status: fp.status,
      })),
    });
  }
  return { ok: true, partners: out };
}

/**
 * @param {object} opts
 * @param {string} opts.manufacturerId
 * @param {string} [opts.providerExternalId] — Printify print_provider_id
 * @param {'available'|'online'|'preview'|'offline'} opts.filter
 */
export async function getCatalogStudioProducts(db, { manufacturerId, providerExternalId, filter }) {
  if (!manufacturerId) return { ok: false, error: "manufacturer_id_required" };

  const providerId = providerExternalId != null && providerExternalId !== "" ? String(providerExternalId) : null;

  if (filter === "available") {
    const rows = await listAvailableBlueprints(db, manufacturerId);
    return { ok: true, filter, items: rows, total: rows.length };
  }

  const status = filter === "online" || filter === "preview" || filter === "offline" ? filter : "online";
  let products = await listEazpireProducts(db, { manufacturerId, catalogStatus: status });

  if (providerId) {
    const keysForProvider = await productKeysForProvider(db, manufacturerId, providerId);
    const keySet = new Set(keysForProvider);
    products = products.filter((p) => keySet.has(p.product_key));
  }

  const items = products.map((p) => ({
    kind: "eazpire_product",
    product_key: p.product_key,
    title: p.title,
    catalog_status: p.catalog_status,
    version_count: p.version_count ?? 0,
    blueprint_title: p.blueprint_title,
    updated_at: p.updated_at,
  }));

  return { ok: true, filter: status, items, total: items.length };
}

async function productKeysForProvider(db, manufacturerId, providerExternalId) {
  const rows = await queryAll(
    db,
    `SELECT DISTINCT v.product_key
     FROM eazpire_product_versions v
     INNER JOIN eazpire_products ep ON ep.product_key = v.product_key
     INNER JOIN manufacturer_fulfillment_providers fp ON fp.id = v.fulfillment_provider_id
     WHERE ep.manufacturer_id = ? AND fp.external_provider_id = ?`,
    manufacturerId,
    providerExternalId
  );
  return rows.map((r) => r.product_key);
}

async function listAvailableBlueprints(db, manufacturerId) {
  const blueprintRows = await queryAll(
    db,
    `SELECT eb.id, eb.blueprint_key, eb.title, eb.normalized_category, eb.status, eb.updated_at
     FROM manufacturer_eazpire_blueprints eb
     WHERE eb.manufacturer_id = ? AND eb.status = 'live'
       AND NOT EXISTS (
         SELECT 1 FROM eazpire_products ep WHERE ep.source_blueprint_id = eb.id
       )
     ORDER BY eb.title ASC`,
    manufacturerId
  );

  return blueprintRows.map((b) => ({
    kind: "blueprint",
    blueprint_id: b.id,
    blueprint_key: b.blueprint_key,
    title: b.title,
    category: b.normalized_category,
    catalog_status: "available",
    updated_at: b.updated_at,
  }));
}
