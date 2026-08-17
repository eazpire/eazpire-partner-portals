/**
 * Durable admin queue for bulk Fix alt texts (Shopify + Amazon if listed).
 * Uses admin-jobs-publish-repair so the browser can close; status lives in D1.
 */
import { getAuthUser, isAdminOwner } from "../../utils/auth.js";
import { getCorsHeaders, json } from "../../utils/response.js";
import { getJobControls, isQueueEnabled } from "../admin/jobControls.js";
import { runFixAltTextsForShopifyProduct } from "./adminCreationsFixAltTexts.js";

export const ADMIN_FIX_ALT_TEXTS_MSG = "admin-fix-alt-texts";
export const ADMIN_FIX_ALT_TEXTS_QUEUE = "admin-jobs-publish-repair";

const OPEN_STATUSES = new Set(["queued", "running"]);

function nowMs() {
  return Date.now();
}

function newBatchId() {
  return `alt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normSid(raw) {
  return String(raw || "")
    .replace("gid://shopify/Product/", "")
    .replace(/\.0$/, "")
    .trim();
}

export async function ensureAdminAltTextJobsTable(env) {
  if (!env?.CREATOR_DB) return;
  await env.CREATOR_DB.prepare(
    `CREATE TABLE IF NOT EXISTS admin_alt_text_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL,
      shopify_product_id TEXT NOT NULL,
      published_design_id INTEGER,
      printify_product_id TEXT,
      product_key TEXT,
      design_id INTEGER,
      title TEXT,
      preview_url TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      message TEXT,
      shopify_ok INTEGER,
      amazon_status TEXT,
      amazon_detail TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`
  ).run();
  await env.CREATOR_DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_admin_alt_text_jobs_batch ON admin_alt_text_jobs (batch_id, status)`
  ).run();
}

function mapJobRow(row) {
  return {
    id: row.id,
    batch_id: row.batch_id,
    shopify_product_id: row.shopify_product_id,
    published_design_id: row.published_design_id,
    printify_product_id: row.printify_product_id,
    product_key: row.product_key,
    design_id: row.design_id,
    title: row.title,
    preview_url: row.preview_url,
    status: row.status,
    message: row.message || "",
    shopify_ok: row.shopify_ok == null ? null : Number(row.shopify_ok) === 1,
    amazon_status: row.amazon_status || null,
    amazon_detail: row.amazon_detail || null,
  };
}

async function requireAdmin(request, env) {
  const cors = getCorsHeaders(request);
  const { owner_id } = await getAuthUser(request, env);
  if (!isAdminOwner(owner_id, env)) {
    return { ok: false, response: json({ ok: false, error: "forbidden" }, 403, cors), cors };
  }
  if (!env.CREATOR_DB) {
    return { ok: false, response: json({ ok: false, error: "database_unavailable" }, 500, cors), cors };
  }
  return { ok: true, ownerId: String(owner_id || ""), cors };
}

export async function handleAdminCreationsEnqueueFixAltTexts(request, env) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  const { cors } = auth;

  const controls = await getJobControls(env);
  const queueEnabled = isQueueEnabled(controls, ADMIN_FIX_ALT_TEXTS_QUEUE);
  if (!queueEnabled) {
    return json(
      {
        ok: false,
        error: "queue_disabled",
        message: "Enable admin-jobs-publish-repair in job controls so alt-text fixes can run after you close the page.",
        queue_enabled: false,
      },
      409,
      cors
    );
  }
  if (!env.JOB_QUEUE_ADMIN_PUBLISH_REPAIR?.send) {
    return json({ ok: false, error: "queue_unavailable", queue_enabled: false }, 500, cors);
  }

  const body = await request.json().catch(() => ({}));
  const items = Array.isArray(body.items) ? body.items : [];
  const prepared = [];
  const seen = new Set();
  for (const item of items) {
    const sid = normSid(item?.shopify_product_id || item?.id);
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    prepared.push({
      shopify_product_id: sid,
      published_design_id: Number(item.published_design_id || 0) || null,
      printify_product_id: String(item.printify_product_id || "").trim() || null,
      product_key: String(item.product_key || "").trim() || null,
      design_id: Number(item.design_id || 0) || null,
      title: String(item.title || "").slice(0, 240) || sid,
      preview_url: String(item.preview_url || "").trim() || null,
    });
  }
  if (!prepared.length) {
    return json({ ok: false, error: "no_shopify_listings" }, 400, cors);
  }

  await ensureAdminAltTextJobsTable(env);
  const batchId = newBatchId();
  const createdAt = nowMs();
  const entries = [];

  for (const item of prepared) {
    const ins = await env.CREATOR_DB.prepare(
      `INSERT INTO admin_alt_text_jobs (
         batch_id, shopify_product_id, published_design_id, printify_product_id,
         product_key, design_id, title, preview_url, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`
    )
      .bind(
        batchId,
        item.shopify_product_id,
        item.published_design_id,
        item.printify_product_id,
        item.product_key,
        item.design_id,
        item.title,
        item.preview_url,
        createdAt,
        createdAt
      )
      .run();
    const jobId = Number(ins?.meta?.last_row_id || 0);
    await env.JOB_QUEUE_ADMIN_PUBLISH_REPAIR.send({
      type: ADMIN_FIX_ALT_TEXTS_MSG,
      batch_id: batchId,
      job_id: jobId,
      shopify_product_id: item.shopify_product_id,
      published_design_id: item.published_design_id,
      printify_product_id: item.printify_product_id,
      product_key: item.product_key,
      design_id: item.design_id,
    });
    entries.push({
      id: jobId,
      shopify_product_id: item.shopify_product_id,
      published_design_id: item.published_design_id,
      product_key: item.product_key,
      title: item.title,
      preview_url: item.preview_url,
      status: "queued",
      message: "",
    });
  }

  return json(
    {
      ok: true,
      batch_id: batchId,
      queue_enabled: true,
      queued: entries.length,
      entries,
    },
    200,
    cors
  );
}

export async function handleAdminCreationsFixAltTextsStatus(request, env) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  const { cors } = auth;
  const url = new URL(request.url);
  const batchId = String(url.searchParams.get("batch_id") || "").trim();
  if (!batchId) return json({ ok: false, error: "missing_batch_id" }, 400, cors);

  await ensureAdminAltTextJobsTable(env);
  const rows =
    (
      await env.CREATOR_DB.prepare(
        `SELECT * FROM admin_alt_text_jobs WHERE batch_id = ? ORDER BY id ASC`
      )
        .bind(batchId)
        .all()
    )?.results || [];

  const entries = rows.map(mapJobRow);
  const open = entries.filter((e) => OPEN_STATUSES.has(e.status)).length;
  const done = entries.filter((e) => e.status === "done").length;
  const errored = entries.filter((e) => e.status === "error").length;
  return json(
    {
      ok: true,
      batch_id: batchId,
      entries,
      open,
      done,
      errored,
      settled: entries.length > 0 && open === 0,
    },
    200,
    cors
  );
}

export async function handleAdminCreationsFixAltTextsOpenBatches(request, env) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  const { cors } = auth;
  await ensureAdminAltTextJobsTable(env);
  const since = nowMs() - 36 * 60 * 60 * 1000;
  const rows =
    (
      await env.CREATOR_DB.prepare(
        `SELECT DISTINCT batch_id FROM admin_alt_text_jobs
         WHERE status IN ('queued', 'running') AND created_at >= ?
         ORDER BY created_at DESC LIMIT 20`
      )
        .bind(since)
        .all()
    )?.results || [];

  const batches = [];
  for (const row of rows) {
    const jobs =
      (
        await env.CREATOR_DB.prepare(
          `SELECT * FROM admin_alt_text_jobs WHERE batch_id = ? ORDER BY id ASC`
        )
          .bind(row.batch_id)
          .all()
      )?.results || [];
    batches.push({
      batch_id: row.batch_id,
      entries: jobs.map(mapJobRow),
    });
  }
  return json({ ok: true, batches }, 200, cors);
}

export async function processAdminFixAltTextsQueueBody(env, body) {
  const jobId = Number(body?.job_id || 0);
  const sid = normSid(body?.shopify_product_id);
  if (!jobId || !sid) throw new Error("admin_fix_alt_texts_missing_job");

  await ensureAdminAltTextJobsTable(env);
  const updatedAt = nowMs();
  await env.CREATOR_DB.prepare(
    `UPDATE admin_alt_text_jobs SET status = 'running', updated_at = ? WHERE id = ?`
  )
    .bind(updatedAt, jobId)
    .run();

  try {
    const shopify = await runFixAltTextsForShopifyProduct(env, {
      shopify_product_id: sid,
      printify_product_id: body.printify_product_id,
      product_key: body.product_key,
      design_id: body.design_id,
      published_design_id: body.published_design_id,
    });
    if (shopify.error) throw new Error(shopify.error);

    let amazon = { skipped: true, reason: "not_listed" };
    try {
      const { syncAmazonListingImagesFromShopify } = await import(
        "../../amazon/syncAmazonListingImagesFromShopify.js"
      );
      amazon = await syncAmazonListingImagesFromShopify(env, {
        publishedDesignId: shopify.published_design_id || body.published_design_id,
        productKey: shopify.product_key || body.product_key,
        images: shopify.after_images,
      });
    } catch (e) {
      amazon = { ok: false, skipped: false, error: e?.message || String(e) };
    }

    const amazonStatus = amazon.skipped
      ? amazon.reason === "not_listed"
        ? "skipped"
        : amazon.reason || "skipped"
      : amazon.ok
        ? amazon.reason || "patched"
        : "error";
    const amazonDetail = amazon.skipped
      ? amazon.reason || "skipped"
      : amazon.errors?.length
        ? amazon.errors.slice(0, 3).join(" · ")
        : `${amazon.patched || 0} patched`;

    const messageParts = [shopify.message];
    if (!amazon.skipped) {
      messageParts.push(
        amazon.ok
          ? `Amazon images ${amazonStatus}`
          : `Amazon images failed (${amazonDetail})`
      );
    }

    await env.CREATOR_DB.prepare(
      `UPDATE admin_alt_text_jobs
       SET status = ?, message = ?, shopify_ok = ?, amazon_status = ?, amazon_detail = ?,
           published_design_id = COALESCE(published_design_id, ?), updated_at = ?
       WHERE id = ?`
    )
      .bind(
        shopify.ok && amazon.ok !== false ? "done" : shopify.ok ? "done" : "error",
        messageParts.filter(Boolean).join(" · ").slice(0, 500),
        shopify.ok ? 1 : 0,
        amazonStatus,
        String(amazonDetail || "").slice(0, 500),
        shopify.published_design_id || null,
        nowMs(),
        jobId
      )
      .run();

    return { ok: true, shopify_ok: shopify.ok, amazon };
  } catch (e) {
    await env.CREATOR_DB.prepare(
      `UPDATE admin_alt_text_jobs
       SET status = 'error', message = ?, shopify_ok = 0, updated_at = ?
       WHERE id = ?`
    )
      .bind(String(e?.message || e).slice(0, 500), nowMs(), jobId)
      .run();
    throw e;
  }
}
