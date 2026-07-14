import { partnerFetch, partnerUpload } from "/shared/js/partner-api.js";

export async function fetchEditorBundle(productId) {
  return partnerFetch("manufacturer-product-editor-bundle", {
    query: { product_id: productId },
  });
}

export async function saveHeader(body) {
  return partnerFetch("manufacturer-product-editor-save-header", { method: "POST", body });
}

export async function saveViews(productId, views) {
  return partnerFetch("manufacturer-product-editor-save-views", {
    method: "POST",
    body: { product_id: productId, views },
  });
}

export async function saveVariants(productId, payload) {
  return partnerFetch("manufacturer-product-editor-save-variants", {
    method: "POST",
    body: { product_id: productId, ...payload },
  });
}

export async function saveMockups(productId, slots) {
  return partnerFetch("manufacturer-product-editor-save-mockups", {
    method: "POST",
    body: { product_id: productId, slots },
  });
}

export async function savePrintAreas(productId, print_areas) {
  return partnerFetch("manufacturer-product-editor-save-print-areas", {
    method: "POST",
    body: { product_id: productId, print_areas },
  });
}

export async function saveMeta(productId, meta) {
  return partnerFetch("manufacturer-product-editor-save-meta", {
    method: "POST",
    body: { product_id: productId, meta },
  });
}

export async function submitForReview(productId) {
  return partnerFetch("manufacturer-product-editor-submit", {
    method: "POST",
    body: { product_id: productId },
  });
}

export async function uploadImage(productId, file) {
  return partnerUpload("manufacturer-product-editor-upload", file, {
    query: { product_id: productId },
    formFields: { product_id: productId },
  });
}
