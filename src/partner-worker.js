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
import { rewritePartnerApiV1Request } from "./features/manufacturers/partnerApiV1.js";

export default {
  async fetch(request, env, ctx) {
    const cors = getCorsHeaders(request);
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cors });
      }

      const apiRequest = rewritePartnerApiV1Request(request) || request;
      const mfgResp = await handleManufacturerRouter(apiRequest, env, ctx);
      if (mfgResp) return mfgResp;

      const portalResp = await handlePartnerPortalRequest(request, env);
      if (portalResp) return portalResp;

      return json({ ok: false, error: "not_found" }, 404, cors);
    } catch (e) {
      console.error("[partner-worker] unhandled:", e?.message || e, e?.stack);
      return json(
        {
          ok: false,
          error: "internal_error",
          message: e?.message || String(e) || "Internal server error",
        },
        500,
        cors
      );
    }
  },
};
