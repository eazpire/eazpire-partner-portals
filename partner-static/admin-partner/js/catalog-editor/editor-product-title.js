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
  const pid = Number(printProviderId);
  return (
    (bundle?.publish_plans || []).find((r) => {
      const pp = Number(r?.profile?.print_provider_id ?? r?.print_provider_id);
      return pp === pid;
    }) || null
  );
}
