/**
 * Certification checklist (V1)
 */

import { getManufacturerDb, newId, parseJson } from "./db.js";
import { writeAuditLog } from "./rbac.js";

export const CERTIFICATION_KEYS = [
  "verified_manufacturer",
  "artifact_ready",
  "fast_fulfillment",
  "premium_quality",
  "vegan_friendly",
  "sustainable_materials",
  "api_partner",
  "low_defect_rate",
  "eu_local_production",
];

export async function listCertifications(db, manufacturerId) {
  const res = await db
    .prepare(`SELECT * FROM manufacturer_certifications WHERE manufacturer_id = ? ORDER BY certification_key`)
    .bind(manufacturerId)
    .all();
  const existing = new Map((res.results || []).map((r) => [r.certification_key, r]));
  return CERTIFICATION_KEYS.map((key) => {
    const row = existing.get(key);
    return {
      certification_key: key,
      status: row?.status || "not_started",
      issued_at: row?.issued_at || null,
      expires_at: row?.expires_at || null,
      evidence: row ? parseJson(row.evidence_json, {}) : {},
    };
  });
}

export async function requestCertification(db, manufacturerId, certificationKey) {
  const id = newId("mcert");
  const now = Date.now();
  const existing = await db
    .prepare(`SELECT id FROM manufacturer_certifications WHERE manufacturer_id = ? AND certification_key = ?`)
    .bind(manufacturerId, certificationKey)
    .first();
  if (existing) {
    await db
      .prepare(`UPDATE manufacturer_certifications SET status = 'evidence_uploaded', updated_at = ? WHERE id = ?`)
      .bind(now, existing.id)
      .run();
    return existing.id;
  }
  await db
    .prepare(
      `INSERT INTO manufacturer_certifications
        (id, manufacturer_id, certification_key, status, evidence_json, created_at, updated_at)
       VALUES (?, ?, ?, 'evidence_uploaded', '{}', ?, ?)`
    )
    .bind(id, manufacturerId, certificationKey, now, now)
    .run();
  return id;
}

export async function adminReviewCertification(env, manufacturerId, certificationKey, { approve, adminOwnerId }) {
  const db = getManufacturerDb(env);
  const now = Date.now();
  const status = approve ? "approved" : "rejected";
  const row = await db
    .prepare(`SELECT * FROM manufacturer_certifications WHERE manufacturer_id = ? AND certification_key = ?`)
    .bind(manufacturerId, certificationKey)
    .first();
  if (!row) {
    const id = newId("mcert");
    await db
      .prepare(
        `INSERT INTO manufacturer_certifications
          (id, manufacturer_id, certification_key, status, issued_at, reviewed_by, evidence_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?)`
      )
      .bind(id, manufacturerId, certificationKey, status, approve ? now : null, adminOwnerId, now, now)
      .run();
  } else {
    await db
      .prepare(
        `UPDATE manufacturer_certifications SET status = ?, issued_at = ?, reviewed_by = ?, updated_at = ? WHERE id = ?`
      )
      .bind(status, approve ? now : null, adminOwnerId, now, row.id)
      .run();
  }
  await writeAuditLog(env, {
    manufacturer_id: manufacturerId,
    user_id: adminOwnerId,
    action: approve ? "certification_approved" : "certification_rejected",
    entity_type: "manufacturer_certification",
    entity_id: certificationKey,
  });
  return listCertifications(db, manufacturerId);
}

export async function certificationProgress(db, manufacturerId) {
  const certs = await listCertifications(db, manufacturerId);
  const approved = certs.filter((c) => c.status === "approved").length;
  const total = certs.length || 1;
  return {
    percent: Math.round((approved / total) * 100),
    certifications: certs,
  };
}
