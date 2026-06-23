export const MOCKUP_SET_CLEAN = "clean";
export const MOCKUP_SET_SHOP_PREVIEW = "shop_preview";

export function normalizeMockupSet(value) {
  const raw = String(value || "").trim().toLowerCase();
  return raw === MOCKUP_SET_SHOP_PREVIEW ? MOCKUP_SET_SHOP_PREVIEW : MOCKUP_SET_CLEAN;
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
  return { clause: "(mockup_set IS NULL OR mockup_set = '' OR mockup_set = ?)", bind: MOCKUP_SET_CLEAN };
}
