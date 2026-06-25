import { partnerFetch, partnerApiBase } from "/partner/shared/js/partner-api.js";

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

export async function setTemplatePrintArea(productKey, printProviderId, section, printifyProductId) {
  return partnerFetch("admin-eazpire-template-set-print-area", {
    method: "POST",
    body: {
      product_key: productKey,
      print_provider_id: printProviderId,
      section,
      printify_product_id: printifyProductId,
      auto_mirror: false,
    },
  });
}

export async function uploadPrintAreaImage(productKey, printAreaKey, file) {
  const url = new URL(partnerApiBase());
  url.searchParams.set("op", "admin-eazpire-print-area-image-upload");
  const form = new FormData();
  form.append("image", file);
  form.append("product_key", productKey);
  form.append("print_area_key", printAreaKey);
  const res = await fetch(url.toString(), { method: "POST", credentials: "include", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const err = new Error(data.message || data.detail || data.error || `http_${res.status}`);
    err.data = data;
    throw err;
  }
  return data;
}

export async function clearPrintAreaImage(productKey, printAreaKey) {
  return partnerFetch("admin-eazpire-print-area-image-clear", {
    method: "POST",
    body: { product_key: productKey, print_area_key: printAreaKey, auto_mirror: false },
  });
}

export async function saveVariantPrintAreaRect(body) {
  return partnerFetch("admin-eazpire-variant-print-area-rect-save", { method: "POST", body });
}

export async function fetchBrandAssetsBundle() {
  return partnerFetch("admin-eazpire-brand-assets-bundle");
}

export async function uploadBrandAsset(assetType, assetColor, file) {
  const url = new URL(partnerApiBase());
  url.searchParams.set("op", "admin-eazpire-brand-asset-upload");
  const form = new FormData();
  form.append("image", file);
  form.append("asset_type", assetType);
  form.append("asset_color", assetColor);
  const res = await fetch(url.toString(), { method: "POST", credentials: "include", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const err = new Error(data.message || data.detail || data.error || `http_${res.status}`);
    err.data = data;
    throw err;
  }
  return data;
}

export async function uploadProductBrandAsset(productKey, printProviderId, assetType, assetColor, file) {
  const url = new URL(partnerApiBase());
  url.searchParams.set("op", "admin-eazpire-product-brand-asset-upload");
  const form = new FormData();
  form.append("image", file);
  form.append("asset_type", assetType);
  form.append("asset_color", assetColor);
  form.append("product_key", productKey);
  form.append("print_provider_id", String(printProviderId));
  const res = await fetch(url.toString(), { method: "POST", credentials: "include", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const err = new Error(data.message || data.detail || data.error || `http_${res.status}`);
    err.data = data;
    throw err;
  }
  return data;
}

export async function updatePublishedAll(body) {
  return partnerFetch("admin-eazpire-published-update-all", { method: "POST", body });
}

export async function saveTemplateSectionProductId(productKey, printProviderId, section, printifyProductId) {
  return partnerFetch("admin-eazpire-template-section-id-save", {
    method: "POST",
    body: {
      product_key: productKey,
      print_provider_id: printProviderId,
      section,
      printify_product_id: printifyProductId,
      auto_mirror: false,
    },
  });
}

/** Persist section Printify ID, then run the section-specific sync API. */
export async function syncTemplateSection(productKey, printProviderId, section, printifyProductId, extra = {}) {
  const pid = String(printifyProductId || "").trim();
  if (!pid) throw new Error("Printify product ID required.");

  await saveTemplateSectionProductId(productKey, printProviderId, section, pid);
  if (section === "variants") {
    await saveTemplateSectionProductId(productKey, printProviderId, "print_areas", pid);
  }

  const base = {
    product_key: productKey,
    print_provider_id: printProviderId,
    printify_product_id: pid,
    auto_mirror: false,
    ...extra,
  };

  if (section === "mockups") {
    return fetchPrintifyMockups({ ...base, mockup_set: "clean" });
  }
  if (section === "shop_preview_mockups") {
    return fetchPrintifyMockups({ ...base, mockup_set: "shop_preview" });
  }
  if (section === "calibration_mockup") {
    return fetchPrintifyMockups({ ...base, mockup_set: "calibration" });
  }
  if (section === "variants") return refreshVariantsFromTemplate(base);
  if (section === "print_areas") return loadPrintifySettings(base);
  throw new Error(`Unknown template section: ${section}`);
}

export async function createTestPrintifyProduct(body) {
  return partnerFetch("admin-eazpire-test-printify-create", { method: "POST", body });
}

export async function fetchTestPrintifyCreations({ design_type, cursor, limit } = {}) {
  return partnerFetch("admin-eazpire-test-printify-creations", {
    method: "POST",
    body: {
      design_type: design_type || "classic",
      cursor: cursor || undefined,
      limit: limit || 40,
    },
  });
}

export async function fetchTestPrintifyProducts(productKey, printProviderId) {
  return partnerFetch("admin-eazpire-test-printify-list", {
    method: "POST",
    body: {
      product_key: productKey,
      print_provider_id: printProviderId ? Number(printProviderId) : undefined,
    },
  });
}

export async function deleteTestPrintifyProducts(ids) {
  return partnerFetch("admin-eazpire-test-printify-delete", {
    method: "POST",
    body: { ids: Array.isArray(ids) ? ids : [ids] },
  });
}

export async function fetchTestPrintifyProductPreview(id) {
  return partnerFetch("admin-eazpire-test-printify-preview", {
    method: "POST",
    body: { id },
  });
}
