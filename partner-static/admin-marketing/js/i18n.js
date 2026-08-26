/** English source strings for Admin Marketing Hub. Keys are stable for later translation. */
export const ADMIN_MARKETING_I18N = {
  "admin.marketing.title": "Marketing",
  "admin.marketing.brand_sub": "Paid ads · Social · Internal",
  "admin.marketing.sign_in_title": "Sign in to Marketing",
  "admin.marketing.sign_in_body":
    "Enter your authorized admin email. We will send a secure magic link — no Shopify login required.",
  "admin.marketing.email": "Email",
  "admin.marketing.send_link": "Send magic link",
  "admin.marketing.sign_out": "Sign out",
  "admin.marketing.checking_session": "Checking admin session…",
  "admin.marketing.first_link_hint":
    "First-time magic links open Partner Ops; then use the app drawer → Marketing. Existing sessions work immediately.",
  "admin.marketing.sidebar_title": "Marketing Ops",
  "admin.marketing.sidebar_body":
    "Cockpit for paid ads. Pause, enable, and set daily budget. No autopilot spending.",
  "admin.marketing.nav.hub": "Hub",
  "admin.marketing.nav.amazon": "Amazon Ads",
  "admin.marketing.nav.social": "Social",
  "admin.marketing.nav.internal": "Internal tools",
  "admin.marketing.hub.lead":
    "Internal marketing tools. Amazon Ads is live for the DE Seller account only.",
  "admin.marketing.hub.amazon_title": "Amazon Ads",
  "admin.marketing.hub.amazon_body": "Sponsored Products for DE Seller. List, pause, daily budget.",
  "admin.marketing.hub.amazon_meta": "DE Seller · cockpit",
  "admin.marketing.hub.social_title": "Social",
  "admin.marketing.hub.social_body": "Facebook, Instagram, and other paid social — not wired yet.",
  "admin.marketing.hub.social_meta": "Coming later",
  "admin.marketing.hub.internal_title": "Internal tools",
  "admin.marketing.hub.internal_body": "Hero and other in-house creatives stay in Creator for now.",
  "admin.marketing.hub.internal_meta": "Placeholder",
  "admin.marketing.amazon.lead":
    "DE Seller Sponsored Products only. Vendor book campaigns are never changed from this page.",
  "admin.marketing.amazon.refresh": "Refresh",
  "admin.marketing.amazon.loading": "Loading campaigns…",
  "admin.marketing.amazon.empty":
    "No Sponsored Products campaigns on the DE Seller account yet. This cockpit does not create ads automatically.",
  "admin.marketing.amazon.col.name": "Name",
  "admin.marketing.amazon.col.state": "State",
  "admin.marketing.amazon.col.budget": "Daily budget",
  "admin.marketing.amazon.col.type": "Type",
  "admin.marketing.amazon.col.actions": "Actions",
  "admin.marketing.amazon.pause": "Pause",
  "admin.marketing.amazon.enable": "Enable",
  "admin.marketing.amazon.save_budget": "Save budget",
  "admin.marketing.amazon.confirm_pause": "Pause this campaign? It will stop spending until you enable it again.",
  "admin.marketing.amazon.confirm_enable": "Enable this campaign? It can start spending up to the daily budget.",
  "admin.marketing.amazon.confirm_budget": "Save this daily budget? Max allowed here is a safety cap, not Amazon’s limit.",
  "admin.marketing.amazon.profile": "Profile",
  "admin.marketing.amazon.safety_cap": "Safety cap (EUR / day)",
  "admin.marketing.amazon.metrics_note": "Spend metrics are not loaded here (Amazon reporting is async).",
  "admin.marketing.amazon.paused": "Campaign paused",
  "admin.marketing.amazon.enabled": "Campaign enabled",
  "admin.marketing.amazon.budget_saved": "Daily budget saved",
  "admin.marketing.placeholder.title": "Not available yet",
  "admin.marketing.placeholder.social":
    "Social ads are listed here so the hub stays complete. Nothing on this tile talks to Facebook or Instagram yet.",
  "admin.marketing.placeholder.internal":
    "Hero and other internal creative tools stay in Creator. They are not moved into this admin page in this slice.",
  "admin.marketing.error": "Error",
  "admin.marketing.saved": "Saved",
  "admin.marketing.failed": "Failed",
  "admin.marketing.collapse": "Collapse",
  "admin.marketing.menu": "Menu",
  "admin.marketing.open_menu": "Open menu",
  "admin.marketing.close": "Close",
  "admin.marketing.login_invalid": "This sign-in link is invalid or has expired. Request a new link below.",
  "admin.marketing.login_used": "This sign-in link was already used. Request a new link below.",
  "admin.marketing.login_missing": "Sign-in link is missing. Request a new link below.",
  "admin.marketing.login_failed": "Sign-in failed. Request a new link below.",
  "admin.marketing.login_sent":
    "If this email is authorized, you will receive a sign-in link within a few minutes. Check spam.",
};

export function t(key) {
  return ADMIN_MARKETING_I18N[key] || key;
}
