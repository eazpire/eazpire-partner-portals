import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const portal = join(__dirname, "../../admin-partner-portal/js/catalog-editor");

describe("catalog editor dirty-state UX", () => {
  it("shell disables save unless tab is dirty", () => {
    const shell = readFileSync(join(portal, "shell.js"), "utf8");
    expect(shell).toContain("tabSaveDisabled");
    expect(shell).toContain("hasDirtySnapshot() && dirty");
    expect(shell).toMatch(/saveBtn\.disabled = !enabled/);
  });

  it("shell prompts on close when dirty", () => {
    const shell = readFileSync(join(portal, "shell.js"), "utf8");
    expect(shell).toContain("promptUnsavedCloseDialog");
    expect(shell).toContain('finish("discard")');
    expect(shell).toContain('finish("save")');
    expect(shell).toContain("discardEditorChanges");
  });

  it("print area tab exposes snapshot and notifies on rect changes", () => {
    const tab = readFileSync(join(portal, "tabs/print-area.js"), "utf8");
    expect(tab).toContain("export function snapshotPrintAreaTab");
    expect(tab).toContain("notifyPrintAreaDirty");
    expect(tab).toContain("onPrintAreaStageChange");
  });

  it("editor-tab-dirty snapshots all editable tabs", () => {
    const mod = readFileSync(join(portal, "editor-tab-dirty.js"), "utf8");
    expect(mod).toContain("snapshotProvidersTab");
    expect(mod).toContain("snapshotPrintAreaTab");
    expect(mod).toContain("snapshotMetaTab");
    expect(mod).toContain("snapshotMockupsTab");
    expect(mod).toContain("snapshotVariantsTab");
    expect(mod).toContain("snapshotAutomationsTab");
  });
});
