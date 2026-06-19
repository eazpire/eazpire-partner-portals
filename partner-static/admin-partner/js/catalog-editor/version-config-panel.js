import { escapeHtml } from "/partner/shared/js/partner-api.js";

const DESIGN_TYPES = ["classic", "backprint", "pattern", "photo"];

function normalizePlaceholders(raw) {
  const map = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const type of DESIGN_TYPES) {
    const row = map[type];
    out[type] = {
      qr: row?.qr ?? "front",
      logo: row?.logo ?? "front",
      creator_design: row?.creator_design ?? "front",
    };
  }
  return out;
}

export function renderVersionConfigPanel(version) {
  const config = version?.product_version_config || {};
  const placeholders = normalizePlaceholders(config.placeholders_by_design_type);
  const rows = DESIGN_TYPES.map((type) => {
    const row = placeholders[type];
    return `<tr data-design-type="${escapeHtml(type)}">
      <td>${escapeHtml(type)}</td>
      <td><input class="input input-sm ce-vcfg-cell" data-field="qr" value="${escapeHtml(String(row.qr))}"></td>
      <td><input class="input input-sm ce-vcfg-cell" data-field="logo" value="${escapeHtml(String(row.logo))}"></td>
      <td><input class="input input-sm ce-vcfg-cell" data-field="creator_design" value="${escapeHtml(
        String(row.creator_design)
      )}"></td>
    </tr>`;
  }).join("");

  return `
    <div class="ce-vcfg">
      <p class="ce-hint">Placeholder x design-type mapping for this product version.</p>
      <div class="table-scroll">
        <table class="data-table ce-table">
          <thead><tr><th>Design type</th><th>QR</th><th>Logo</th><th>Creator design</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

export function collectVersionConfigPanel(root, prevConfig = null) {
  const wrap = root || document;
  const byType = {};
  wrap.querySelectorAll("tr[data-design-type]").forEach((row) => {
    const type = row.getAttribute("data-design-type");
    if (!type) return;
    byType[type] = {
      qr: row.querySelector('[data-field="qr"]')?.value?.trim() || "front",
      logo: row.querySelector('[data-field="logo"]')?.value?.trim() || "front",
      creator_design: row.querySelector('[data-field="creator_design"]')?.value?.trim() || "front",
    };
  });
  return {
    ...(prevConfig && typeof prevConfig === "object" ? prevConfig : {}),
    placeholders_by_design_type: byType,
  };
}
