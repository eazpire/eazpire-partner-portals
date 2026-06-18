/**
 * Manufacturer network API router (?op=...)
 */

import { json, getCorsHeaders } from "../../utils/response.js";
import { getManufacturerDb, manufacturerDbUnavailable } from "./db.js";
import { ensureManufacturerSchema } from "./ensureManufacturerSchema.js";
import {
  requirePartnerSession,
  requireFullPartnerSession,
  requireAdminPartnerSession,
  canManageCatalog,
  canManageOrders,
  writeAuditLog,
} from "./rbac.js";
import {
  handlePartnerAuthRequest,
  handlePartnerAuthVerify,
  handlePartnerAuthLogout,
  handlePartnerAuthMe,
  handlePartnerApplicationVerify,
  handlePartnerAuthPoll,
  handlePartnerAuthExchange,
} from "./partnerAuth.js";
import {
  handleAdminAuthRequest,
  handleAdminAuthVerify,
  handleAdminAuthLogout,
  handleAdminAuthMe,
  handleAdminPartnerIssueExchangeToken,
  handleAdminPartnerSessionExchange,
  handleAdminPartnerSessionLogout,
  handleAdminPartnerSessionMe,
} from "./adminPartnerAuth.js";
import {
  getManufacturerById,
  updateManufacturer,
  listLocations,
  createLocation,
  getDashboard,
  adminCreateManufacturer,
  adminListManufacturers,
  adminUpdateManufacturerStatus,
  adminRemoveManufacturer,
  adminSuspendManufacturer,
  adminNetworkOverview,
} from "./manufacturerService.js";
import { adminGetPartnerNetworkBoard } from "./partnerNetworkBoard.js";
import {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  submitProductForReview,
  listVariants,
  createVariant,
  listPrintAreas,
  upsertPrintArea,
  adminListProducts,
  adminReviewProduct,
} from "./catalogService.js";
import {
  listOrders,
  getOrder,
  updateOrderStatus,
  createTestOrder,
  adminListOrdersByStatus,
  buildSignedPrintFileResponse,
} from "./orderService.js";
import {
  listCertifications,
  requestCertification,
  adminReviewCertification,
  certificationProgress,
} from "./certificationService.js";
import { validatePrintArea } from "./printAreaValidation.js";
import {
  submitPartnerApplication,
  getPartnerApplicationById,
  adminListPartnerApplications,
  adminApprovePartnerApplication,
  adminRejectPartnerApplication,
} from "./partnerApplicationService.js";
import {
  listPartnerBlueprints,
  getPartnerBlueprintDetail,
  saveWizardBlueprint,
  uploadPartnerBlueprintJson,
  uploadPartnerBlueprintCsv,
  validatePartnerBlueprint,
  submitBlueprintForReview,
  runConversion,
  adminListBlueprints,
  adminGetBlueprintReview,
  adminReviewBlueprint,
  adminRerunConversion,
} from "./blueprints/blueprintService.js";

const PARTNER_OPS = new Set([
  "partner-auth-request",
  "partner-auth-poll",
  "partner-auth-exchange",
  "partner-auth-verify",
  "partner-auth-logout",
  "partner-auth-me",
  "partner-application-submit",
  "partner-application-verify",
  "partner-application-status",
  "manufacturer-get",
  "manufacturer-update",
  "manufacturer-dashboard",
  "manufacturer-location-list",
  "manufacturer-location-create",
  "manufacturer-product-list",
  "manufacturer-product-get",
  "manufacturer-product-create",
  "manufacturer-product-update",
  "manufacturer-product-submit-review",
  "manufacturer-variant-list",
  "manufacturer-variant-create",
  "manufacturer-print-area-list",
  "manufacturer-print-area-upsert",
  "manufacturer-order-list",
  "manufacturer-order-get",
  "manufacturer-order-accept",
  "manufacturer-order-reject",
  "manufacturer-order-status-update",
  "manufacturer-order-tracking-update",
  "manufacturer-order-download-print-file",
  "manufacturer-certification-list",
  "manufacturer-certification-request",
  "partner-blueprint-list",
  "partner-blueprint-get",
  "partner-blueprint-create",
  "partner-blueprint-update",
  "partner-blueprint-upload-json",
  "partner-blueprint-upload-csv",
  "partner-blueprint-validate",
  "partner-blueprint-submit-review",
  "partner-blueprint-convert",
]);

const ADMIN_OPS = new Set([
  "admin-auth-request",
  "admin-auth-verify",
  "admin-auth-logout",
  "admin-auth-me",
  "admin-partner-issue-exchange-token",
  "admin-partner-session-exchange",
  "admin-partner-session-logout",
  "admin-partner-session-me",
  "admin-manufacturer-network-overview",
  "admin-manufacturer-network-board",
  "admin-manufacturer-list",
  "admin-manufacturer-create",
  "admin-manufacturer-approve",
  "admin-manufacturer-suspend",
  "admin-manufacturer-reactivate",
  "admin-manufacturer-remove",
  "admin-manufacturer-product-list",
  "admin-manufacturer-product-review",
  "admin-test-order-create",
  "admin-manufacturer-orders-board",
  "admin-certification-review",
  "admin-partner-application-list",
  "admin-partner-application-approve",
  "admin-partner-application-reject",
  "admin-blueprint-list",
  "admin-blueprint-review-get",
  "admin-blueprint-approve",
  "admin-blueprint-reject",
  "admin-blueprint-request-changes",
  "admin-blueprint-rerun-conversion",
]);

export function isManufacturerOp(op) {
  return PARTNER_OPS.has(op) || ADMIN_OPS.has(op);
}

export async function handleManufacturerRouter(request, env) {
  const cors = getCorsHeaders(request);
  const url = new URL(request.url);
  const op = url.searchParams.get("op") || "";
  if (!isManufacturerOp(op)) return null;

  if (op === "partner-auth-request") return handlePartnerAuthRequest(request, env);
  if (op === "partner-auth-poll") return handlePartnerAuthPoll(request, env);
  if (op === "partner-auth-exchange") return handlePartnerAuthExchange(request, env);
  if (op === "partner-auth-verify") return handlePartnerAuthVerify(request, env);
  if (op === "partner-auth-logout") return handlePartnerAuthLogout(request, env);
  if (op === "partner-auth-me") return handlePartnerAuthMe(request, env);
  if (op === "partner-application-verify") return handlePartnerApplicationVerify(request, env);

  if (op === "partner-application-submit" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const result = await submitPartnerApplication(env, body);
    if (!result.ok) {
      const status =
        result.reason === "invalid_email"
          ? 400
          : result.reason === "email_blocked"
            ? 403
            : result.reason === "manufacturer_db_unavailable"
              ? 503
              : 400;
      return json({ ok: false, error: result.reason, detail: result.detail }, status, cors);
    }
    return json({ ok: true, sent: true }, 200, cors);
  }

  if (op === "admin-auth-request") return handleAdminAuthRequest(request, env);
  if (op === "admin-auth-verify") return handleAdminAuthVerify(request, env);
  if (op === "admin-auth-logout") return handleAdminAuthLogout(request, env);
  if (op === "admin-auth-me") return handleAdminAuthMe(request, env);

  if (op === "admin-partner-issue-exchange-token") return handleAdminPartnerIssueExchangeToken(request, env);
  if (op === "admin-partner-session-exchange") return handleAdminPartnerSessionExchange(request, env);
  if (op === "admin-partner-session-logout") return handleAdminPartnerSessionLogout(request, env);
  if (op === "admin-partner-session-me") return handleAdminPartnerSessionMe(request, env);

  const db = getManufacturerDb(env);
  if (!db) {
    const u = manufacturerDbUnavailable(cors);
    return json(u.body, u.status, cors);
  }
  await ensureManufacturerSchema(env);

  if (op === "partner-application-status" && request.method === "GET") {
    const auth = await requirePartnerSession(request, env);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status, cors);
    if (auth.mode !== "applicant") {
      return json({ ok: false, error: "not_applicant_session" }, 400, cors);
    }
    const { upgradeApprovedApplicantToFullSession } = await import("./partnerApplicationService.js");
    const { partnerCookieName, sessionCookieHeader } = await import("./rbac.js");
    const upgraded = await upgradeApprovedApplicantToFullSession(env, {
      applicationId: auth.application_id,
      email: auth.email,
    });
    if (upgraded) {
      return json(
        { ok: true, upgraded: true, session: upgraded.session },
        200,
        { ...cors, "Set-Cookie": sessionCookieHeader(partnerCookieName(), upgraded.jwt) }
      );
    }
    const application = await getPartnerApplicationById(db, auth.application_id);
    if (!application) return json({ ok: false, error: "not_found" }, 404, cors);
    return json({ ok: true, application }, 200, cors);
  }

  // ----- Admin ops -----
  if (ADMIN_OPS.has(op)) {
    const admin = await requireAdminPartnerSession(request, env);
    if (!admin.ok) return json({ ok: false, error: admin.error }, admin.status, cors);

    if (op === "admin-manufacturer-network-overview" && request.method === "GET") {
      const data = await adminNetworkOverview(db);
      return json({ ok: true, ...data }, 200, cors);
    }
    if (op === "admin-manufacturer-network-board" && request.method === "GET") {
      try {
        const board = await adminGetPartnerNetworkBoard(db);
        return json({ ok: true, board }, 200, cors);
      } catch (err) {
        console.error("[admin-manufacturer-network-board]", err);
        return json({ ok: false, error: "network_board_failed", detail: String(err?.message || err) }, 500, cors);
      }
    }
    if (op === "admin-manufacturer-list" && request.method === "GET") {
      const manufacturers = await adminListManufacturers(db, { status: url.searchParams.get("status") });
      return json({ ok: true, manufacturers }, 200, cors);
    }
    if (op === "admin-manufacturer-create" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const manufacturer = await adminCreateManufacturer(env, body, admin.owner_id);
      return json({ ok: true, manufacturer }, 200, cors);
    }
    if (op === "admin-manufacturer-approve" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const manufacturer = await adminUpdateManufacturerStatus(env, body.manufacturer_id, "verified", admin.owner_id);
      return json({ ok: true, manufacturer }, 200, cors);
    }
    if (op === "admin-manufacturer-suspend" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const result = await adminSuspendManufacturer(env, body.manufacturer_id, admin.owner_id, {
        reason: body.reason,
        block: body.mode === "suspend_block" || !!body.block,
      });
      if (!result.ok) return json({ ok: false, error: result.reason }, result.reason === "not_found" ? 404 : 400, cors);
      return json({ ok: true, ...result }, 200, cors);
    }
    if (op === "admin-manufacturer-reactivate" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const manufacturer = await adminUpdateManufacturerStatus(env, body.manufacturer_id, "verified", admin.owner_id);
      return json({ ok: true, manufacturer }, 200, cors);
    }
    if (op === "admin-manufacturer-remove" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const result = await adminRemoveManufacturer(env, body.manufacturer_id, body.mode, admin.owner_id);
      if (!result.ok) return json({ ok: false, error: result.reason }, result.reason === "not_found" ? 404 : 400, cors);
      return json({ ok: true, ...result }, 200, cors);
    }
    if (op === "admin-manufacturer-product-list" && request.method === "GET") {
      const products = await adminListProducts(db, { status: url.searchParams.get("status") });
      return json({ ok: true, products }, 200, cors);
    }
    if (op === "admin-manufacturer-product-review" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const product = await adminReviewProduct(env, body.product_id, {
        approve: !!body.approve,
        adminOwnerId: admin.owner_id,
      });
      if (!product) return json({ ok: false, error: "not_found" }, 404, cors);
      return json({ ok: true, product }, 200, cors);
    }
    if (op === "admin-test-order-create" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const result = await createTestOrder(env, {
        manufacturerId: body.manufacturer_id,
        productId: body.product_id,
        variantId: body.variant_id,
        adminOwnerId: admin.owner_id,
      });
      if (!result.ok) return json(result, 400, cors);
      return json(result, 200, cors);
    }
    if (op === "admin-manufacturer-orders-board" && request.method === "GET") {
      const board = await adminListOrdersByStatus(db);
      return json({ ok: true, board }, 200, cors);
    }
    if (op === "admin-certification-review" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const certifications = await adminReviewCertification(env, body.manufacturer_id, body.certification_key, {
        approve: !!body.approve,
        adminOwnerId: admin.owner_id,
      });
      return json({ ok: true, certifications }, 200, cors);
    }
    if (op === "admin-partner-application-list" && request.method === "GET") {
      const applications = await adminListPartnerApplications(db, {
        status: url.searchParams.get("status") || undefined,
      });
      return json({ ok: true, applications }, 200, cors);
    }
    if (op === "admin-partner-application-approve" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const result = await adminApprovePartnerApplication(env, body.application_id, admin.owner_id);
      if (!result.ok) return json({ ok: false, error: result.reason }, 400, cors);
      return json({ ok: true, ...result }, 200, cors);
    }
    if (op === "admin-partner-application-reject" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const result = await adminRejectPartnerApplication(env, body.application_id, admin.owner_id, {
        reason: body.reason,
        block: body.mode === "reject_block" || !!body.block,
      });
      if (!result.ok) return json({ ok: false, error: result.reason }, 400, cors);
      return json({ ok: true, application: result.application, blocked: result.blocked }, 200, cors);
    }
    if (op === "admin-blueprint-list" && request.method === "GET") {
      const blueprints = await adminListBlueprints(db, { status: url.searchParams.get("status") });
      return json({ ok: true, blueprints }, 200, cors);
    }
    if (op === "admin-blueprint-review-get" && request.method === "GET") {
      const review = await adminGetBlueprintReview(db, url.searchParams.get("blueprint_id"));
      if (!review) return json({ ok: false, error: "not_found" }, 404, cors);
      return json({ ok: true, ...review }, 200, cors);
    }
    if (op === "admin-blueprint-approve" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const review = await adminReviewBlueprint(env, body.blueprint_id, {
        action: "approve",
        notes: body.notes,
        adminOwnerId: admin.owner_id,
      });
      if (!review) return json({ ok: false, error: "not_found" }, 404, cors);
      return json({ ok: true, ...review }, 200, cors);
    }
    if (op === "admin-blueprint-reject" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const review = await adminReviewBlueprint(env, body.blueprint_id, {
        action: "reject",
        notes: body.notes,
        adminOwnerId: admin.owner_id,
      });
      if (!review) return json({ ok: false, error: "not_found" }, 404, cors);
      return json({ ok: true, ...review }, 200, cors);
    }
    if (op === "admin-blueprint-request-changes" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const review = await adminReviewBlueprint(env, body.blueprint_id, {
        action: "request_changes",
        notes: body.notes,
        adminOwnerId: admin.owner_id,
      });
      if (!review) return json({ ok: false, error: "not_found" }, 404, cors);
      return json({ ok: true, ...review }, 200, cors);
    }
    if (op === "admin-blueprint-rerun-conversion" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const result = await adminRerunConversion(env, body.blueprint_id);
      if (!result.ok) return json(result, 400, cors);
      return json(result, 200, cors);
    }
    return json({ ok: false, error: "unknown_admin_op" }, 404, cors);
  }

  // ----- Partner ops (full session required) -----
  const auth = await requireFullPartnerSession(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status, cors);
  const mfgId = auth.manufacturer_id;

  if (op === "manufacturer-get" && request.method === "GET") {
    const manufacturer = await getManufacturerById(db, mfgId);
    const progress = await certificationProgress(db, mfgId);
    return json({ ok: true, manufacturer, certification_progress: progress }, 200, cors);
  }

  if (op === "manufacturer-update" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const manufacturer = await updateManufacturer(db, mfgId, body);
    await writeAuditLog(env, { manufacturer_id: mfgId, user_id: auth.user_id, action: "manufacturer_update", entity_type: "manufacturer", entity_id: mfgId });
    return json({ ok: true, manufacturer }, 200, cors);
  }

  if (op === "manufacturer-dashboard" && request.method === "GET") {
    const dashboard = await getDashboard(db, mfgId);
    return json({ ok: true, dashboard }, 200, cors);
  }

  if (op === "manufacturer-location-list" && request.method === "GET") {
    return json({ ok: true, locations: await listLocations(db, mfgId) }, 200, cors);
  }

  if (op === "manufacturer-location-create" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const location = await createLocation(db, mfgId, body);
    return json({ ok: true, location }, 200, cors);
  }

  if (op === "manufacturer-product-list" && request.method === "GET") {
    const products = await listProducts(db, mfgId, { status: url.searchParams.get("status") });
    return json({ ok: true, products }, 200, cors);
  }

  if (op === "manufacturer-product-get" && request.method === "GET") {
    const productId = url.searchParams.get("product_id");
    const product = await getProduct(db, mfgId, productId);
    if (!product) return json({ ok: false, error: "not_found" }, 404, cors);
    const variants = await listVariants(db, mfgId, productId);
    const print_areas = await listPrintAreas(db, mfgId, productId);
    return json({ ok: true, product, variants, print_areas }, 200, cors);
  }

  if (op === "manufacturer-product-create" && request.method === "POST") {
    if (!canManageCatalog(auth.role)) return json({ ok: false, error: "forbidden" }, 403, cors);
    const body = await request.json().catch(() => ({}));
    const product = await createProduct(db, mfgId, body);
    return json({ ok: true, product }, 200, cors);
  }

  if (op === "manufacturer-product-update" && request.method === "POST") {
    if (!canManageCatalog(auth.role)) return json({ ok: false, error: "forbidden" }, 403, cors);
    const body = await request.json().catch(() => ({}));
    const product = await updateProduct(db, mfgId, body.product_id, body);
    if (!product) return json({ ok: false, error: "not_found" }, 404, cors);
    return json({ ok: true, product }, 200, cors);
  }

  if (op === "manufacturer-product-submit-review" && request.method === "POST") {
    if (!canManageCatalog(auth.role)) return json({ ok: false, error: "forbidden" }, 403, cors);
    const body = await request.json().catch(() => ({}));
    const result = await submitProductForReview(db, mfgId, body.product_id);
    if (!result.ok) return json({ ok: false, errors: result.errors }, 400, cors);
    return json({ ok: true, product: result.product }, 200, cors);
  }

  if (op === "manufacturer-variant-list" && request.method === "GET") {
    const productId = url.searchParams.get("product_id");
    return json({ ok: true, variants: await listVariants(db, mfgId, productId) }, 200, cors);
  }

  if (op === "manufacturer-variant-create" && request.method === "POST") {
    if (!canManageCatalog(auth.role)) return json({ ok: false, error: "forbidden" }, 403, cors);
    const body = await request.json().catch(() => ({}));
    const variant = await createVariant(db, mfgId, body.product_id, body);
    if (!variant) return json({ ok: false, error: "not_found" }, 404, cors);
    return json({ ok: true, variant }, 200, cors);
  }

  if (op === "manufacturer-print-area-list" && request.method === "GET") {
    const productId = url.searchParams.get("product_id");
    return json({ ok: true, print_areas: await listPrintAreas(db, mfgId, productId) }, 200, cors);
  }

  if (op === "manufacturer-print-area-upsert" && request.method === "POST") {
    if (!canManageCatalog(auth.role)) return json({ ok: false, error: "forbidden" }, 403, cors);
    const body = await request.json().catch(() => ({}));
    const validation = validatePrintArea(body);
    if (!validation.ok) return json({ ok: false, errors: validation.errors }, 400, cors);
    const area = await upsertPrintArea(db, mfgId, body.product_id, body);
    if (!area) return json({ ok: false, error: "not_found" }, 404, cors);
    return json({ ok: true, print_area: area }, 200, cors);
  }

  if (op === "manufacturer-order-list" && request.method === "GET") {
    if (!canManageOrders(auth.role)) return json({ ok: false, error: "forbidden" }, 403, cors);
    const orders = await listOrders(db, mfgId, { status: url.searchParams.get("status") });
    return json({ ok: true, orders }, 200, cors);
  }

  if (op === "manufacturer-order-get" && request.method === "GET") {
    if (!canManageOrders(auth.role)) return json({ ok: false, error: "forbidden" }, 403, cors);
    const order = await getOrder(db, mfgId, url.searchParams.get("order_id"));
    if (!order) return json({ ok: false, error: "not_found" }, 404, cors);
    return json({ ok: true, order }, 200, cors);
  }

  if (op === "manufacturer-order-accept" && request.method === "POST") {
    if (!canManageOrders(auth.role)) return json({ ok: false, error: "forbidden" }, 403, cors);
    const body = await request.json().catch(() => ({}));
    const order = await updateOrderStatus(db, mfgId, body.order_id, "accepted");
    return json({ ok: true, order }, 200, cors);
  }

  if (op === "manufacturer-order-reject" && request.method === "POST") {
    if (!canManageOrders(auth.role)) return json({ ok: false, error: "forbidden" }, 403, cors);
    const body = await request.json().catch(() => ({}));
    const order = await updateOrderStatus(db, mfgId, body.order_id, "rejected");
    return json({ ok: true, order }, 200, cors);
  }

  if (op === "manufacturer-order-status-update" && request.method === "POST") {
    if (!canManageOrders(auth.role)) return json({ ok: false, error: "forbidden" }, 403, cors);
    const body = await request.json().catch(() => ({}));
    const order = await updateOrderStatus(db, mfgId, body.order_id, body.status || "in_production");
    return json({ ok: true, order }, 200, cors);
  }

  if (op === "manufacturer-order-tracking-update" && request.method === "POST") {
    if (!canManageOrders(auth.role)) return json({ ok: false, error: "forbidden" }, 403, cors);
    const body = await request.json().catch(() => ({}));
    const order = await updateOrderStatus(db, mfgId, body.order_id, "shipped", {
      tracking_number: body.tracking_number,
      tracking_url: body.tracking_url,
    });
    return json({ ok: true, order }, 200, cors);
  }

  if (op === "manufacturer-order-download-print-file" && request.method === "GET") {
    if (!canManageOrders(auth.role)) return json({ ok: false, error: "forbidden" }, 403, cors);
    const order = await getOrder(db, mfgId, url.searchParams.get("order_id"));
    if (!order) return json({ ok: false, error: "not_found" }, 404, cors);
    const file = buildSignedPrintFileResponse(order, url.searchParams.get("item_id"));
    if (!file) return json({ ok: false, error: "print_file_missing" }, 404, cors);
    await writeAuditLog(env, {
      manufacturer_id: mfgId,
      user_id: auth.user_id,
      action: "print_file_download",
      entity_type: "manufacturer_order",
      entity_id: order.id,
    });
    return json({ ok: true, file }, 200, cors);
  }

  if (op === "manufacturer-certification-list" && request.method === "GET") {
    const certifications = await listCertifications(db, mfgId);
    const progress = await certificationProgress(db, mfgId);
    return json({ ok: true, certifications, progress }, 200, cors);
  }

  if (op === "manufacturer-certification-request" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    await requestCertification(db, mfgId, body.certification_key);
    return json({ ok: true, certifications: await listCertifications(db, mfgId) }, 200, cors);
  }

  // ----- Blueprint ops -----
  if (op === "partner-blueprint-list" && request.method === "GET") {
    const blueprints = await listPartnerBlueprints(db, mfgId, { status: url.searchParams.get("status") });
    return json({ ok: true, blueprints }, 200, cors);
  }

  if (op === "partner-blueprint-get" && request.method === "GET") {
    const detail = await getPartnerBlueprintDetail(db, mfgId, url.searchParams.get("blueprint_id"));
    if (!detail) return json({ ok: false, error: "not_found" }, 404, cors);
    return json({ ok: true, ...detail }, 200, cors);
  }

  if (op === "partner-blueprint-create" && request.method === "POST") {
    if (!canManageCatalog(auth.role)) return json({ ok: false, error: "forbidden" }, 403, cors);
    const body = await request.json().catch(() => ({}));
    const result = await saveWizardBlueprint(db, mfgId, body, auth.user_id);
    return json(result, 200, cors);
  }

  if (op === "partner-blueprint-update" && request.method === "POST") {
    if (!canManageCatalog(auth.role)) return json({ ok: false, error: "forbidden" }, 403, cors);
    const body = await request.json().catch(() => ({}));
    body.provider_blueprint_id = body.provider_blueprint_id || body.blueprint_id;
    const result = await saveWizardBlueprint(db, mfgId, body, auth.user_id);
    return json(result, 200, cors);
  }

  if (op === "partner-blueprint-upload-json" && request.method === "POST") {
    if (!canManageCatalog(auth.role)) return json({ ok: false, error: "forbidden" }, 403, cors);
    const body = await request.json().catch(() => ({}));
    const result = await uploadPartnerBlueprintJson(db, mfgId, { json: body.json ?? body, uploadedBy: auth.user_id });
    if (!result.ok) return json(result, 400, cors);
    return json(result, 200, cors);
  }

  if (op === "partner-blueprint-upload-csv" && request.method === "POST") {
    if (!canManageCatalog(auth.role)) return json({ ok: false, error: "forbidden" }, 403, cors);
    const body = await request.json().catch(() => ({}));
    const result = await uploadPartnerBlueprintCsv(db, mfgId, {
      csv: body.csv,
      title: body.title,
      wizard: body.wizard,
      uploadedBy: auth.user_id,
    });
    if (!result.ok) return json(result, 400, cors);
    return json(result, 200, cors);
  }

  if (op === "partner-blueprint-validate" && request.method === "GET") {
    const result = await validatePartnerBlueprint(db, mfgId, url.searchParams.get("blueprint_id"));
    if (!result.ok) return json(result, 404, cors);
    return json(result, 200, cors);
  }

  if (op === "partner-blueprint-submit-review" && request.method === "POST") {
    if (!canManageCatalog(auth.role)) return json({ ok: false, error: "forbidden" }, 403, cors);
    const body = await request.json().catch(() => ({}));
    const result = await submitBlueprintForReview(db, mfgId, body.blueprint_id || body.provider_blueprint_id);
    if (!result.ok) return json(result, 400, cors);
    await writeAuditLog(env, {
      manufacturer_id: mfgId,
      user_id: auth.user_id,
      action: "blueprint_submit_review",
      entity_type: "manufacturer_provider_blueprint",
      entity_id: body.blueprint_id || body.provider_blueprint_id,
    });
    return json(result, 200, cors);
  }

  if (op === "partner-blueprint-convert" && request.method === "POST") {
    if (!canManageCatalog(auth.role)) return json({ ok: false, error: "forbidden" }, 403, cors);
    const body = await request.json().catch(() => ({}));
    const result = await runConversion(db, mfgId, body.blueprint_id || body.provider_blueprint_id);
    if (!result.ok) return json(result, 400, cors);
    return json(result, 200, cors);
  }

  return json({ ok: false, error: "unknown_partner_op" }, 404, cors);
}
