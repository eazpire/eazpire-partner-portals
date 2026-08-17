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
});
