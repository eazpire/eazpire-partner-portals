import { describe, it, expect, vi } from "vitest";
import { forceTodifyPublishMapToMorocco } from "../../src/features/manufacturers/adapters/todify/todifyDogfoodSetup.js";

describe("forceTodifyPublishMapToMorocco", () => {
  it("updates country_codes_json to MA-only and clears region expansion", async () => {
    const binds = [];
    const catalogDb = {
      prepare(sql) {
        return {
          bind(...args) {
            binds.push({ sql, args });
            return {
              async run() {
                return { meta: { changes: 2 } };
              },
            };
          },
        };
      },
    };

    const result = await forceTodifyPublishMapToMorocco(catalogDb, "todify-todify-hooded-tank");
    expect(result.ok).toBe(true);
    expect(result.updated).toBe(2);
    expect(binds).toHaveLength(1);
    expect(binds[0].args[0]).toBe('["MA"]');
    expect(binds[0].args[1]).toBe("[]");
    expect(binds[0].args[4]).toBe("todify-todify-hooded-tank");
  });
});
