import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  authTokenStatus,
  partnerVerifyFailureResponse,
  readVerifyToken,
  wantsJsonVerifyResponse,
} from "../../src/features/manufacturers/partnerAuthVerifyUi.js";

describe("partnerAuthVerifyUi", () => {
  it("detects JSON verify clients", () => {
    const url = new URL("https://partner.eazpire.com/auth/verify?token=abc");
    const req = new Request(url, { headers: { accept: "application/json" } });
    expect(wantsJsonVerifyResponse(req, url)).toBe(true);
    expect(wantsJsonVerifyResponse(new Request(url), url)).toBe(false);
    const jsonUrl = new URL("https://partner.eazpire.com/auth/verify?token=abc&format=json");
    expect(wantsJsonVerifyResponse(new Request(jsonUrl), jsonUrl)).toBe(true);
  });

  it("classifies token status", () => {
    const now = Date.now();
    expect(authTokenStatus(null)).toBe("invalid_or_expired_token");
    expect(authTokenStatus({ used_at: now, expires_at: now + 1000 })).toBe("token_already_used");
    expect(authTokenStatus({ used_at: null, expires_at: now - 1 })).toBe("invalid_or_expired_token");
    expect(authTokenStatus({ used_at: null, expires_at: now + 60_000 })).toBe("valid");
  });

  it("redirects browser verify failures to login", () => {
    const env = { PARTNER_PORTAL_URL: "https://partner.eazpire.com" };
    const url = new URL("https://partner.eazpire.com/auth/verify");
    const req = new Request(url, { headers: { accept: "text/html" } });
    const failure = partnerVerifyFailureResponse(env, req, url, {}, "token_already_used");
    expect(failure.kind).toBe("redirect");
    expect(failure.location).toContain("auth_error=token_already_used");
  });
});

describe("handlePartnerAuthVerify", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function mockDb(row) {
    return {
      prepare: (sql) => {
        const chain = {
          bind: () => chain,
          first: async () => {
            if (sql.includes("partner_application_tokens") && sql.includes("magic_link")) return null;
            if (sql.includes("manufacturer_auth_tokens") && sql.includes("token_hash")) return row;
            if (sql.trim() === "SELECT 1 FROM manufacturers LIMIT 1") return { ok: 1 };
            return null;
          },
          run: async () => ({}),
        };
        return chain;
      },
    };
  }

  const env = {
    PARTNER_PORTAL_URL: "https://partner.eazpire.com",
    MANUFACTURER_DB: null,
    PARTNER_JWT_SECRET: "test-secret-test-secret-test-secret",
  };

  it("GET with valid token returns confirmation HTML without consuming", async () => {
    const row = {
      id: "pat_1",
      manufacturer_id: "mfr_1",
      user_id: "musr_1",
      role: "owner",
      email: "a@b.com",
      used_at: null,
      expires_at: Date.now() + 60_000,
    };
    env.MANUFACTURER_DB = mockDb(row);
    const { handlePartnerAuthVerify } = await import("../../src/features/manufacturers/partnerAuth.js");
    const token = "a".repeat(64);
    const req = new Request(`https://partner.eazpire.com/auth/verify?token=${token}`, {
      headers: { accept: "text/html" },
    });
    const res = await handlePartnerAuthVerify(req, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Confirm sign-in");
    expect(html).toContain('method="POST"');
    expect(row.used_at).toBeNull();
  }, 30000);

  it("POST with valid token redirects to portal", async () => {
    const row = {
      id: "pat_1",
      manufacturer_id: "mfr_1",
      user_id: "musr_1",
      role: "owner",
      email: "a@b.com",
      used_at: null,
      expires_at: Date.now() + 60_000,
    };
    env.MANUFACTURER_DB = mockDb(row);
    const { handlePartnerAuthVerify } = await import("../../src/features/manufacturers/partnerAuth.js");
    const token = "b".repeat(64);
    const req = new Request("https://partner.eazpire.com/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
      body: new URLSearchParams({ token }),
    });
    const res = await handlePartnerAuthVerify(req, env);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://partner.eazpire.com/");
    expect(res.headers.get("set-cookie")).toContain("partner_session=");
  });

  it("GET with used token redirects with auth_error for browsers", async () => {
    const row = {
      id: "pat_1",
      manufacturer_id: "mfr_1",
      user_id: "musr_1",
      role: "owner",
      email: "a@b.com",
      used_at: Date.now() - 1000,
      expires_at: Date.now() + 60_000,
    };
    env.MANUFACTURER_DB = mockDb(row);
    const { handlePartnerAuthVerify } = await import("../../src/features/manufacturers/partnerAuth.js");
    const req = new Request("https://partner.eazpire.com/auth/verify?token=used", {
      headers: { accept: "text/html" },
    });
    const res = await handlePartnerAuthVerify(req, env);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("auth_error=token_already_used");
  });

  it("POST with applicant magic link redirects to application status", async () => {
    const applicantRow = {
      id: "patok_1",
      application_id: "papp_1",
      email: "applicant@example.com",
      application_status: "pending_review",
      used_at: null,
      expires_at: Date.now() + 60_000,
    };
    const db = {
      prepare: (sql) => {
        const chain = {
          bind: () => chain,
          first: async () => {
            if (sql.includes("partner_application_tokens") && sql.includes("magic_link")) return applicantRow;
            if (sql.includes("manufacturer_auth_tokens")) return null;
            return { ok: 1 };
          },
          run: async () => ({}),
        };
        return chain;
      },
    };
    env.MANUFACTURER_DB = db;
    const { handlePartnerAuthVerify } = await import("../../src/features/manufacturers/partnerAuth.js");
    const token = "c".repeat(64);
    const req = new Request("https://partner.eazpire.com/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
      body: new URLSearchParams({ token }),
    });
    const res = await handlePartnerAuthVerify(req, env);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://partner.eazpire.com/application-status");
    expect(res.headers.get("set-cookie")).toContain("partner_session=");
  });
});

describe("readVerifyToken", () => {
  it("reads token from POST form body", async () => {
    const req = new Request("https://partner.eazpire.com/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: "form-token" }),
    });
    const token = await readVerifyToken(req, new URL(req.url));
    expect(token).toBe("form-token");
  });
});

describe("partner login poll + exchange", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  const env = {
    PARTNER_PORTAL_URL: "https://partner.eazpire.com",
    MANUFACTURER_DB: null,
    PARTNER_JWT_SECRET: "test-secret-test-secret-test-secret",
    JOBS: {
      store: new Map(),
      async get(key) {
        return this.store.get(key) ?? null;
      },
      async put(key, value, _opts) {
        this.store.set(key, value);
      },
      async delete(key) {
        this.store.delete(key);
      },
    },
  };

  it("returns poll_token from auth request and verifies via exchange", async () => {
    const { createPartnerLoginPoll, handlePartnerAuthPoll, handlePartnerAuthExchange } = await import(
      "../../src/features/manufacturers/partnerAuth.js"
    );
    const { signPartnerSession } = await import("../../src/features/manufacturers/rbac.js");

    const rawToken = "d".repeat(64);
    const pollToken = await createPartnerLoginPoll(env, {
      email: "user@example.com",
      rawToken,
      mode: "full",
    });
    expect(pollToken).toBeTruthy();

    let pollRes = await handlePartnerAuthPoll(
      new Request(`https://partner.eazpire.com/?op=partner-auth-poll&poll_token=${pollToken}`),
      env
    );
    let pollBody = await pollRes.json();
    expect(pollBody.status).toBe("pending");

    const jwt = await signPartnerSession(env, {
      manufacturer_id: "mfr_1",
      user_id: "musr_1",
      role: "owner",
      email: "user@example.com",
    });
    const { markPartnerLoginPollVerified } = await import("../../src/features/manufacturers/partnerAuth.js");
    await markPartnerLoginPollVerified(env, rawToken, jwt, "full");

    pollRes = await handlePartnerAuthPoll(
      new Request(`https://partner.eazpire.com/?op=partner-auth-poll&poll_token=${pollToken}`),
      env
    );
    pollBody = await pollRes.json();
    expect(pollBody.status).toBe("verified");
    expect(pollBody.exchange_token).toBeTruthy();

    const exchangeRes = await handlePartnerAuthExchange(
      new Request("https://partner.eazpire.com/?op=partner-auth-exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ exchange_token: pollBody.exchange_token }),
      }),
      env
    );
    const exchangeBody = await exchangeRes.json();
    expect(exchangeBody.ok).toBe(true);
    expect(exchangeBody.mode).toBe("full");
    expect(exchangeRes.headers.get("set-cookie")).toContain("partner_session=");
  });

  it("POST verify marks poll verified for cross-device login", async () => {
    const row = {
      id: "pat_1",
      manufacturer_id: "mfr_1",
      user_id: "musr_1",
      role: "owner",
      email: "a@b.com",
      used_at: null,
      expires_at: Date.now() + 60_000,
    };
    const db = {
      prepare: (sql) => {
        const chain = {
          bind: () => chain,
          first: async () => {
            if (sql.includes("partner_application_tokens") && sql.includes("magic_link")) return null;
            if (sql.includes("manufacturer_auth_tokens") && sql.includes("token_hash")) return row;
            if (sql.trim() === "SELECT 1 FROM manufacturers LIMIT 1") return { ok: 1 };
            return null;
          },
          run: async () => ({}),
        };
        return chain;
      },
    };
    env.MANUFACTURER_DB = db;
    env.JOBS.store.clear();

    const { createPartnerLoginPoll, handlePartnerAuthVerify, handlePartnerAuthPoll } = await import(
      "../../src/features/manufacturers/partnerAuth.js"
    );

    const token = "e".repeat(64);
    const pollToken = await createPartnerLoginPoll(env, {
      email: "a@b.com",
      rawToken: token,
      mode: "full",
    });

    const verifyRes = await handlePartnerAuthVerify(
      new Request("https://partner.eazpire.com/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
        body: new URLSearchParams({ token }),
      }),
      env
    );
    expect(verifyRes.status).toBe(302);

    const pollRes = await handlePartnerAuthPoll(
      new Request(`https://partner.eazpire.com/?op=partner-auth-poll&poll_token=${pollToken}`),
      env
    );
    const pollBody = await pollRes.json();
    expect(pollBody.status).toBe("verified");
    expect(pollBody.exchange_token).toBeTruthy();
  });

  it("decoy poll stays pending until expired", async () => {
    const { createPartnerLoginPoll, handlePartnerAuthPoll } = await import(
      "../../src/features/manufacturers/partnerAuth.js"
    );
    env.JOBS.store.clear();
    const pollToken = await createPartnerLoginPoll(env, { email: "unknown@example.com" });
    const pollRes = await handlePartnerAuthPoll(
      new Request(`https://partner.eazpire.com/?op=partner-auth-poll&poll_token=${pollToken}`),
      env
    );
    const pollBody = await pollRes.json();
    expect(pollBody.status).toBe("pending");
  });
});
