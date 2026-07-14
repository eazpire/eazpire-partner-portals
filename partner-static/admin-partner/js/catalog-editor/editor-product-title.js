/** Product title shown in editor chrome — first active version display_name, else legacy product.title. */
export function editorProductTitle(bundle, productKey = "") {
  const versions = (bundle?.versions || [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));
  const activeIds = new Set(
    (bundle?.active_providers || []).map((r) => String(r.print_provider_id))
  );
  const activeVersions = versions.filter((v) => activeIds.has(String(v.external_provider_id)));
  const pool = activeVersions.length ? activeVersions : versions;
  for (const v of pool) {
    const name = String(v.display_name || "").trim();
    if (name) return name;
  }
  return String(bundle?.product?.title || productKey || "").trim() || productKey;
}

export function publishProfileForProvider(bundle, printProviderId) {
  const pid = Number(printProviderId);
  return (
    (bundle?.publish_profiles || []).find((r) => Number(r.print_provider_id) === pid) ||
    (bundle?.publish_profiles || [])[0] ||
    null
  );
}

export function publishPlanForProvider(bundle, printProviderId) {
  const raw = printProviderId == null ? "" : String(printProviderId).trim();
  const pidNum = Number(raw);
  const plans = bundle?.publish_plans || [];
  if (Number.isFinite(pidNum) && String(pidNum) === raw) {
    const byNumeric = plans.find((r) => {
      const pp = Number(r?.profile?.print_provider_id ?? r?.print_provider_id);
      return pp === pidNum;
    });
    if (byNumeric) return byNumeric;
  }
  // Opaque partner ids (Todify ma-1) or plans seeded without print_provider_id:
  // match external id on profile / plan, else first enabled plan for this product.
  const byOpaque = plans.find((r) => {
    const ext = String(
      r?.profile?.print_provider_id ?? r?.print_provider_id ?? r?.external_provider_id ?? ""
    ).trim();
    return ext && ext === raw;
  });
  if (byOpaque) return byOpaque;
  if (raw && !Number.isFinite(pidNum)) {
    return plans.find((r) => r?.is_enabled !== 0 && r?.is_enabled !== false) || plans[0] || null;
  }
  return null;
}
