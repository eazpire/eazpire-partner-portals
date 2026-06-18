import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  signAdminPartnerSession,
  verifyAdminPartnerSession,
  hashToken,
} from "../../src/features/manufacturers/rbac.js";
import { isAdminEmail, getAdminAllowedEmails } from "../../src/features/manufacturers/adminAllowlist.js";
import {
  issueAdminMagicLink,
  handleAdminAuthRequest,
  handleAdminAuthVerify,
  handleAdminAuthMe,
} from "../../src/features/manufacturers/adminPartnerAuth.js";

const env = {
  PARTNER_JWT_SECRET: "test-partner-jwt-secret-at-least-32-chars-long",
  ADMIN_OWNER_IDS: "9415375946010",
  ADMIN_OWNER_EMAILS: "admin@eazpire.com,tobi.muss@hotmail.com",
  ADMIN_PARTNER_URL: "https://admin.eazpire.com/partner",
  RESEND_API_KEY: "re_test_key",
  JOBS: {
    store: new Map(),
    async put(key, value, opts) {
      this.store.set(key, { value, expires: Date.now() + (opts?.expirationTtl || 900) * 1000 });
    },
    async get(key) {
      const row = this.store.get(key);
      if (!row) return null;
      if (row.expires < Date.now()) {
        this.store.delete(key);
        return null;
      }
      return row.value;
    },
    async delete(key) {
      this.store.delete(key);
    },
  },
};

describe("admin allowlist", () => {
  it("parses ADMIN_OWNER_EMAILS", () => {
    expect(getAdminAllowedEmails(env)).toEqual(["admin@eazpire.com", "tobi.muss@hotmail.com"]);
    expect(isAdminEmail("tobi.muss@hotmail.com", env)).toBe(true);
    expect(isAdminEmail("stranger@example.com", env)).toBe(false);
  });
});

describe("admin partner magic-link auth", () => {
  beforeEach(() => {
    env.JOBS.store.clear();
    vi.resetModules();
  });

  it("sends magic link for allowlisted email", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const result = await issueAdminMagicLink(env, "admin@eazpire.com");
    expect(result.ok).toBe(true);
    expect(env.JOBS.store.size).toBe(1);
    fetchSpy.mockRestore();
  });

  it("does not store token for non-allowlisted email", async () => {
    const result = await issueAdminMagicLink(env, "not-admin@example.com");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_allowed");
    expect(env.JOBS.store.size).toBe(0);
  });

  it("admin-auth-request returns generic success", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const req = new Request("https://admin.eazpire.com/?op=admin-auth-request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "admin@eazpire.com" }),
    });
    const res = await handleAdminAuthRequest(req, env);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.sent).toBe(true);
  });

  it("verify flow issues session cookie", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const issued = await issueAdminMagicLink(env, "admin@eazpire.com");
    expect(issued.ok).toBe(true);

    const entries = [...env.JOBS.store.entries()];
    expect(entries.length).toBe(1);
    const stored = JSON.parse(entries[0][1].value);
    expect(stored.email).toBe("admin@eazpire.com");

    // Recover raw token by brute from KV key (test only)
    const tokenHash = entries[0][0].replace("admin_magic:", "");
    const rawToken = "a".repeat(64);
    const hash = await hashToken(rawToken);
    env.JOBS.store.clear();
    await env.JOBS.put(`admin_magic:${hash}`, JSON.stringify({ email: "admin@eazpire.com", used_at: null }));

    const confirmReq = new Request(`https://admin.eazpire.com/partner/auth/verify?token=${rawToken}`, {
      method: "POST",
      headers: { accept: "text/html" },
    });
    const verifyRes = await handleAdminAuthVerify(confirmReq, env);
    expect(verifyRes.status).toBe(302);
    expect(verifyRes.headers.get("Set-Cookie")).toContain("admin_partner_session=");

    const cookie = verifyRes.headers.get("Set-Cookie");
    const jwt = decodeURIComponent(cookie.match(/admin_partner_session=([^;]+)/)[1]);
    const session = await verifyAdminPartnerSession(jwt, env);
    expect(session.email).toBe("admin@eazpire.com");
  });

  it("admin-auth-me accepts email session", async () => {
    const jwt = await signAdminPartnerSession(env, {
      email: "admin@eazpire.com",
      owner_id: "9415375946010",
    });
    const req = new Request("https://admin.eazpire.com/?op=admin-auth-me", {
      headers: { cookie: `admin_partner_session=${encodeURIComponent(jwt)}` },
    });
    const res = await handleAdminAuthMe(req, env);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.session.email).toBe("admin@eazpire.com");
  });
});
