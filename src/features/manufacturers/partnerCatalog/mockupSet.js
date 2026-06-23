export const MOCKUP_SET_CLEAN = "clean";
export const MOCKUP_SET_SHOP_PREVIEW = "shop_preview";
/** Internal placement-guide mocks for print-area detection (red rectangle) and try-on AI. */
export const MOCKUP_SET_CALIBRATION = "calibration";

export function normalizeMockupSet(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === MOCKUP_SET_SHOP_PREVIEW) return MOCKUP_SET_SHOP_PREVIEW;
  if (raw === MOCKUP_SET_CALIBRATION) return MOCKUP_SET_CALIBRATION;
  return MOCKUP_SET_CLEAN;
}

/** Templates tab section id → template_products Printify ID column. */
export function templatePrintifyColumnForMockupSet(mockupSet) {
  const set = normalizeMockupSet(mockupSet);
  if (set === MOCKUP_SET_SHOP_PREVIEW) return "printify_shop_preview_mockups_product_id";
  if (set === MOCKUP_SET_CALIBRATION) return "printify_calibration_mockups_product_id";
  return "printify_mockups_product_id";
}

export function missingPrintifyIdMessageForMockupSet(mockupSet) {
  const set = normalizeMockupSet(mockupSet);
  if (set === MOCKUP_SET_SHOP_PREVIEW) {
    return "Save a Shop Preview Mockups Printify product ID on the Templates tab first.";
  }
  if (set === MOCKUP_SET_CALIBRATION) {
    return "Save a Calibration Mockup Printify product ID on the Templates tab first.";
  }
  return "Save a Clean Mockups Printify product ID on the Templates tab first.";
}

/** @param {{ mockup_set?: string | null }} row */
export function rowMockupSet(row) {
  return normalizeMockupSet(row?.mockup_set);
}

export function filterImagesByMockupSet(images, mockupSet) {
  const want = normalizeMockupSet(mockupSet);
  return (images || []).filter((row) => rowMockupSet(row) === want);
}

export function mockupSetSqlMatch(mockupSet) {
  const want = normalizeMockupSet(mockupSet);
  if (want === MOCKUP_SET_SHOP_PREVIEW) {
    return { clause: "mockup_set = ?", bind: MOCKUP_SET_SHOP_PREVIEW };
  }
  if (want === MOCKUP_SET_CALIBRATION) {
    return { clause: "mockup_set = ?", bind: MOCKUP_SET_CALIBRATION };
  }
  return { clause: "(mockup_set IS NULL OR mockup_set = '' OR mockup_set = ?)", bind: MOCKUP_SET_CLEAN };
}
