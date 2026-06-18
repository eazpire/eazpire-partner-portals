import { describe, it, expect } from "vitest";
import partnerWorker from "../../src/partner-worker.js";

describe("partner-worker entry", () => {
  it("exports fetch handler", () => {
    expect(partnerWorker).toBeTruthy();
    expect(typeof partnerWorker.fetch).toBe("function");
  });

  it("serves partner SPA shell for client routes", async () => {
    const req = new Request("https://partner.eazpire.com/company");
    const res = await partnerWorker.fetch(req, {}, {});
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/Partner sign in|app-shell|Become a Partner/i);
  });

  it("serves partner login HTML at /", async () => {
    const req = new Request("https://partner.eazpire.com/");
    const res = await partnerWorker.fetch(req, {}, {});
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/Partner sign in|Become a Partner/i);
  });
});
