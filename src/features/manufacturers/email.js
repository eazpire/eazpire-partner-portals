/**
 * Resend email helper for partner magic links
 */

export async function sendAdminMagicLinkEmail(env, { to, verifyUrl }) {
  const key = String(env.RESEND_API_KEY || "").trim();
  if (!key) return { ok: false, skipped: true, error: "resend_not_configured" };

  const from =
    String(env.PARTNER_FROM_EMAIL || env.ACCOUNT_DELETION_FROM_EMAIL || "").trim() ||
    "Eazpire <noreply@eazpire.com>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Sign in to Eazpire Admin — Partner Ops",
      html: `<p>Click to sign in to the Eazpire admin partner portal:</p><p><a href="${verifyUrl}">Open admin.eazpire.com/partner</a></p><p>This link expires in 15 minutes. If you did not request this, you can ignore this email.</p>`,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: "resend_error", detail: text.slice(0, 300) };
  }
  return { ok: true };
}

export async function sendPartnerMagicLinkEmail(env, { to, verifyUrl }) {
  const key = String(env.RESEND_API_KEY || "").trim();
  if (!key) return { ok: false, skipped: true, error: "resend_not_configured" };

  const from =
    String(env.PARTNER_FROM_EMAIL || env.ACCOUNT_DELETION_FROM_EMAIL || "").trim() ||
    "Eazpire <noreply@eazpire.com>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Sign in to Eazpire Partner Portal",
      html: `<p>Click to sign in to your manufacturer workspace:</p><p><a href="${verifyUrl}">Sign in to partner.eazpire.com</a></p><p>This link expires in 15 minutes.</p>`,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: "resend_error", detail: text.slice(0, 300) };
  }
  return { ok: true };
}

export async function sendPartnerApplicationConfirmEmail(env, { to, verifyUrl, companyName }) {
  const key = String(env.RESEND_API_KEY || "").trim();
  if (!key) return { ok: false, skipped: true, error: "resend_not_configured" };

  const from =
    String(env.PARTNER_FROM_EMAIL || env.ACCOUNT_DELETION_FROM_EMAIL || "").trim() ||
    "Eazpire <noreply@eazpire.com>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Confirm your Eazpire partner application",
      html: `<p>Thank you for applying to become an Eazpire manufacturing partner${companyName ? ` (${companyName})` : ""}.</p>
<p>Please confirm your email address to continue:</p>
<p><a href="${verifyUrl}">Verify email address</a></p>
<p>This link expires in 15 minutes. If you did not apply, you can ignore this email.</p>`,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: "resend_error", detail: text.slice(0, 300) };
  }
  return { ok: true };
}

export async function sendPartnerApplicantMagicLinkEmail(env, { to, verifyUrl, companyName, status }) {
  const key = String(env.RESEND_API_KEY || "").trim();
  if (!key) return { ok: false, skipped: true, error: "resend_not_configured" };

  const from =
    String(env.PARTNER_FROM_EMAIL || env.ACCOUNT_DELETION_FROM_EMAIL || "").trim() ||
    "Eazpire <noreply@eazpire.com>";

  const needsVerify = status === "pending_email_verification";
  const lead = needsVerify
    ? "Confirm your email or view your application status using the link below."
    : "Use the link below to view your partner application status.";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Sign in to view your Eazpire partner application",
      html: `<p>Hello${companyName ? ` from ${companyName}` : ""},</p>
<p>${lead}</p>
<p><a href="${verifyUrl}">View application status</a></p>
<p>This link expires in 15 minutes. If you did not request this, you can ignore this email.</p>`,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: "resend_error", detail: text.slice(0, 300) };
  }
  return { ok: true };
}

export async function sendPartnerApplicationApprovedEmail(env, { to, verifyUrl, companyName }) {
  const key = String(env.RESEND_API_KEY || "").trim();
  if (!key) return { ok: false, skipped: true, error: "resend_not_configured" };

  const from =
    String(env.PARTNER_FROM_EMAIL || env.ACCOUNT_DELETION_FROM_EMAIL || "").trim() ||
    "Eazpire <noreply@eazpire.com>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Your Eazpire partner application was approved",
      html: `<p>Great news${companyName ? ` for ${companyName}` : ""} — your partner application has been approved.</p>
<p>Click below to sign in to the full Eazpire Partner Portal:</p>
<p><a href="${verifyUrl}">Sign in to partner.eazpire.com</a></p>
<p>This link expires in 15 minutes. You can also request a new sign-in link anytime from the partner login page.</p>`,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: "resend_error", detail: text.slice(0, 300) };
  }
  return { ok: true };
}

export async function sendPartnerApplicationRejectedEmail(env, { to, companyName, reason, statusUrl, blocked }) {
  const key = String(env.RESEND_API_KEY || "").trim();
  if (!key) return { ok: false, skipped: true, error: "resend_not_configured" };

  const from =
    String(env.PARTNER_FROM_EMAIL || env.ACCOUNT_DELETION_FROM_EMAIL || "").trim() ||
    "Eazpire <noreply@eazpire.com>";

  const reasonBlock = reason
    ? `<p><strong>Note from our team:</strong> ${reason}</p>`
    : "";

  const blockBlock = blocked
    ? `<p>Your email address has been blocked from submitting new partner applications.</p>`
    : "";

  const statusBlock = statusUrl
    ? `<p>You can view the decision details here: <a href="${statusUrl}">View application status</a></p>`
    : "";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Update on your Eazpire partner application",
      html: `<p>Thank you for your interest in partnering with Eazpire${companyName ? ` as ${companyName}` : ""}.</p>
<p>After review, we are unable to approve your application at this time.</p>
${reasonBlock}
${blockBlock}
${statusBlock}
<p>If you believe this was a mistake, please contact us at support@eazpire.com.</p>`,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: "resend_error", detail: text.slice(0, 300) };
  }
  return { ok: true };
}

export async function sendPartnerManufacturerSuspendedEmail(env, { to, companyName, reason, blocked }) {
  const key = String(env.RESEND_API_KEY || "").trim();
  if (!key) return { ok: false, skipped: true, error: "resend_not_configured" };

  const from =
    String(env.PARTNER_FROM_EMAIL || env.ACCOUNT_DELETION_FROM_EMAIL || "").trim() ||
    "Eazpire <noreply@eazpire.com>";

  const reasonBlock = reason
    ? `<p><strong>Note from our team:</strong> ${reason}</p>`
    : "";

  const blockBlock = blocked
    ? `<p>Your email address has also been blocked from submitting new partner applications.</p>`
    : "";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Your Eazpire partner account has been suspended",
      html: `<p>Hello${companyName ? ` from ${companyName}` : ""},</p>
<p>Your Eazpire manufacturer partner account has been suspended and partner portal access is currently disabled.</p>
${reasonBlock}
${blockBlock}
<p>If you believe this was a mistake, please contact us at support@eazpire.com.</p>`,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: "resend_error", detail: text.slice(0, 300) };
  }
  return { ok: true };
}

export async function sendPartnerProductReviewDecisionEmail(
  env,
  { to, companyName, productTitle, decision, note, productKey, portalUrl }
) {
  const key = String(env.RESEND_API_KEY || "").trim();
  if (!key) return { ok: false, skipped: true, error: "resend_not_configured" };

  const from =
    String(env.PARTNER_FROM_EMAIL || env.ACCOUNT_DELETION_FROM_EMAIL || "").trim() ||
    "Eazpire <noreply@eazpire.com>";

  const escape = (s) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const decisionKey = String(decision || "").toLowerCase();
  const approved = decisionKey === "approved";
  const rejected = decisionKey === "rejected";
  const subject = approved
    ? "Your product was approved for the Eazpire catalog"
    : rejected
      ? "Your product was rejected"
      : "Changes requested for your product submission";

  const safeTitle = escape(productTitle || "your product");
  const decisionLine = approved
    ? `<p>Good news${companyName ? ` for ${escape(companyName)}` : ""} — <strong>${safeTitle}</strong> was approved and added as a catalog draft.</p>`
    : rejected
      ? `<p>After review, we are unable to approve <strong>${safeTitle}</strong> at this time.</p>`
      : `<p>We need changes before we can approve <strong>${safeTitle}</strong>.</p>`;

  const noteBlock = note ? `<p><strong>Note from our team:</strong> ${escape(note)}</p>` : "";
  const keyBlock =
    approved && productKey
      ? `<p>Catalog key: <code>${escape(productKey)}</code> (set to Preview — you can review details in the Partner Portal).</p>`
      : "";
  const portalBlock = portalUrl
    ? `<p><a href="${escape(portalUrl)}">Open the Partner Portal</a> to view the decision under Overview.</p>`
    : "";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html: `${decisionLine}${noteBlock}${keyBlock}${portalBlock}
<p>If you have questions, contact us at support@eazpire.com.</p>`,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: "resend_error", detail: text.slice(0, 300) };
  }
  return { ok: true };
}
