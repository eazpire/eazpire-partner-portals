/**
 * Shared PAT field mapping between studio/auto config and catalog-db columns.
 */

export function studioConfigToPatFields(studioConfig) {
  const sc = studioConfig || {};
  return {
    print_areas_snapshot_json:
      sc.print_areas_snapshot != null ? JSON.stringify(sc.print_areas_snapshot) : null,
    printify_print_area_groups_json:
      sc.printify_print_area_groups != null ? JSON.stringify(sc.printify_print_area_groups) : null,
    shopify_design_placement: sc.shopify_design_placement || null,
    print_provider_id: sc.print_provider_id,
  };
}

export function autoPublishConfigToPatFields(autoConfig) {
  const ac = autoConfig || {};
  return {
    auto_publish_enabled: ac.auto_publish_enabled ? 1 : 0,
    automation_shopify_sync_enabled: ac.automation_shopify_sync_enabled ? 1 : 0,
    automation_amazon_publish_enabled: ac.automation_amazon_publish_enabled ? 1 : 0,
    automation_social_json: ac.automation_social != null ? JSON.stringify(ac.automation_social) : null,
  };
}

export function mergeStudioIntoPatPatch(studioConfig, existingPat = {}) {
  const fields = studioConfigToPatFields(studioConfig);
  return {
    print_areas_snapshot_json: fields.print_areas_snapshot_json ?? existingPat.print_areas_snapshot_json,
    printify_print_area_groups_json:
      fields.printify_print_area_groups_json ?? existingPat.printify_print_area_groups_json,
    shopify_design_placement: fields.shopify_design_placement ?? existingPat.shopify_design_placement,
    print_provider_id:
      fields.print_provider_id != null ? fields.print_provider_id : existingPat.print_provider_id,
  };
}
