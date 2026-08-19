import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_FIX_ALT_TEXTS_MSG,
  ADMIN_FIX_ALT_TEXTS_QUEUE,
} from "../../src/features/manufacturers/adminCreationsFixAltTextsQueue.js";

describe("admin fix-alt-texts queue contract", () => {
  it("uses a typed message on the existing admin repair queue", () => {
    expect(ADMIN_FIX_ALT_TEXTS_MSG).toBe("admin-fix-alt-texts");
    expect(ADMIN_FIX_ALT_TEXTS_QUEUE).toBe("admin-jobs-publish-repair");
  });

  it("wrangler-partner.toml can enqueue onto the creator-engine repair consumer", () => {
    const toml = readFileSync(resolve(process.cwd(), "wrangler-partner.toml"), "utf8");
    expect(toml).toMatch(/queue\s*=\s*"admin-jobs-publish-repair"/);
    expect(toml).toMatch(/binding\s*=\s*"JOB_QUEUE_ADMIN_PUBLISH_REPAIR"/);
  });
});
