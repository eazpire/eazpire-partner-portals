/**
 * eazpire-partner-portals — dedicated Worker for partner + admin portals.
 * Routes: partner.eazpire.com/*, admin.eazpire.com/*
 *
 * Deploy: npm run deploy:partner (wrangler-partner.toml)
 * Rebuild when shared admin/publish/printify modules change (bundled via manufacturerRouter).
 */

import { json, getCorsHeaders } from "./utils/response.js";
import { handleManufacturerRouter } from "./features/manufacturers/manufacturerRouter.js";
import { handlePartnerPortalRequest } from "./features/manufacturers/partnerPortalHost.js";

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      const cors = getCorsHeaders(request);
      return new Response(null, { status: 204, headers: cors });
    }

    const mfgResp = await handleManufacturerRouter(request, env);
    if (mfgResp) return mfgResp;

    const portalResp = await handlePartnerPortalRequest(request, env);
    if (portalResp) return portalResp;

    const cors = getCorsHeaders(request);
    return json({ ok: false, error: "not_found" }, 404, cors);
  },
};
