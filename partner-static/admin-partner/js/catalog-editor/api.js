import { partnerFetch } from "/partner/shared/js/partner-api.js";

export async function fetchEditorBundle(productKey) {
  return partnerFetch("admin-eazpire-product-editor-bundle", { query: { product_key: productKey } });
}

export async function fetchDriftV2() {
  return partnerFetch("admin-eazpire-catalog-mirror-status-v2");
}

export async function mirrorProduct(productKey) {
  return partnerFetch("admin-eazpire-catalog-mirror-run", {
    method: "POST",
    body: { product_key: productKey },
  });
}

export async function saveMeta(productKey, body) {
  return partnerFetch("admin-eazpire-product-meta-save", {
    method: "POST",
    body: { product_key: productKey, ...body },
  });
}

export async function fetchProvidersBundle(productKey) {
  return partnerFetch("admin-eazpire-product-providers-bundle", { query: { product_key: productKey } });
}

export async function fetchProviderCatalogDetail(productKey, printProviderId) {
  return partnerFetch("admin-eazpire-provider-catalog-detail", {
    query: { product_key: productKey, print_provider_id: printProviderId },
  });
}

export async function saveProviders(productKey, body) {
  return partnerFetch("admin-eazpire-product-providers-save", {
    method: "POST",
    body: { product_key: productKey, ...body },
  });
}

export async function createVersion(productKey, body) {
  return partnerFetch("admin-eazpire-product-version-create", {
    method: "POST",
    body: { product_key: productKey, ...body },
  });
}

export async function deleteVersion(versionId) {
  return partnerFetch("admin-eazpire-product-version-delete", {
    method: "POST",
    body: { id: versionId },
  });
}

export async function saveVersionConfig(versionId, body) {
  return partnerFetch("admin-eazpire-product-version-config-save", {
    method: "POST",
    body: { id: versionId, ...body },
  });
}

export async function fetchPrintAreaBundle(productKey, printProviderId, versionId) {
  return partnerFetch("admin-eazpire-print-area-bundle", {
    query: {
      product_key: productKey,
      print_provider_id: printProviderId || undefined,
      version_id: versionId || undefined,
    },
  });
}

export async function savePrintAreaSnapshot(versionId, body) {
  return partnerFetch("admin-eazpire-print-area-snapshot-save", {
    method: "POST",
    body: { version_id: versionId, ...body },
  });
}

export async function fetchVariantsBundle(productKey, printProviderId) {
  return partnerFetch("admin-eazpire-variants-bundle", {
    query: { product_key: productKey, print_provider_id: printProviderId },
  });
}

export async function saveVariants(productKey, printProviderId, body) {
  return partnerFetch("admin-eazpire-variants-save", {
    method: "POST",
    body: { product_key: productKey, print_provider_id: printProviderId, ...body },
  });
}

export async function fetchTemplateBundle(productKey, printProviderId) {
  return partnerFetch("admin-eazpire-template-bundle", {
    query: { product_key: productKey, print_provider_id: printProviderId },
  });
}

export async function saveTemplate(productKey, printProviderId, body) {
  return partnerFetch("admin-eazpire-template-save", {
    method: "POST",
    body: { product_key: productKey, print_provider_id: printProviderId, ...body },
  });
}

export async function fetchMockupsBundle(productKey, printProviderId) {
  return partnerFetch("admin-eazpire-mockups-bundle", {
    query: {
      product_key: productKey,
      print_provider_id: printProviderId || undefined,
    },
  });
}

export async function saveMockups(productKey, body) {
  return partnerFetch("admin-eazpire-mockups-save", {
    method: "POST",
    body: { product_key: productKey, ...body },
  });
}

export async function saveAutomations(versionId, body) {
  return partnerFetch("admin-eazpire-automations-save", {
    method: "POST",
    body: { version_id: versionId, ...body },
  });
}

export async function fetchPublishedBundle(productKey) {
  return partnerFetch("admin-eazpire-published-bundle", { query: { product_key: productKey } });
}

export async function updatePublished(body) {
  return partnerFetch("admin-eazpire-published-update", { method: "POST", body });
}

export async function deletePublished(body) {
  return partnerFetch("admin-eazpire-published-delete", { method: "POST", body });
}

export async function fetchProductReadiness(productKey) {
  return partnerFetch("admin-eazpire-product-readiness", { query: { product_key: productKey } });
}

export async function resolveCountries(codes = []) {
  return partnerFetch("admin-eazpire-resolve-countries", {
    query: { codes: (codes || []).join(",") },
  });
}

export async function loadPrintifySettings(body) {
  return partnerFetch("admin-eazpire-load-printify-settings", { method: "POST", body });
}

export async function savePrintAreaRect(body) {
  return partnerFetch("admin-eazpire-print-area-rect-save", { method: "POST", body });
}

export async function savePrintAreasConfig(body) {
  return partnerFetch("admin-eazpire-print-areas-config-save", { method: "POST", body });
}

export async function refreshVariantsFromTemplate(body) {
  return partnerFetch("admin-eazpire-variants-refresh-from-template", { method: "POST", body });
}

export async function createTemplateDraft(body) {
  return partnerFetch("admin-eazpire-template-create-draft", { method: "POST", body });
}

export async function removeTemplateDraft(body) {
  return partnerFetch("admin-eazpire-template-remove-draft", { method: "POST", body });
}

export async function fetchPrintifyMockups(body) {
  return partnerFetch("admin-eazpire-fetch-printify-mockups", { method: "POST", body });
}

export async function updatePublishedAll(body) {
  return partnerFetch("admin-eazpire-published-update-all", { method: "POST", body });
}

/** Save Printify product ID, then run the section-specific sync API. */
export async function syncTemplateSection(productKey, printProviderId, section, printifyProductId, extra = {}) {
  const pid = String(printifyProductId || "").trim();
  if (!pid) throw new Error("Printify product ID required.");

  await saveTemplate(productKey, printProviderId, {
    printify_product_id: pid,
    auto_mirror: false,
  });

  const base = {
    product_key: productKey,
    print_provider_id: printProviderId,
    printify_product_id: pid,
    auto_mirror: false,
    ...extra,
  };

  if (section === "mockups") return fetchPrintifyMockups(base);
  if (section === "variants") return refreshVariantsFromTemplate(base);
  if (section === "print_areas") return loadPrintifySettings(base);
  throw new Error(`Unknown template section: ${section}`);
}
