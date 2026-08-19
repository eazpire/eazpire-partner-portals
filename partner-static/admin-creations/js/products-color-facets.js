/**
 * Color facets for Admin Products Variants mode (IDEA-063).
 * Counts products (not mocks) that have each color label.
 */

const GENERIC_LABELS = new Set(["default", "unassigned", "none", "n/a", "-"]);

const COLOR_HEX = {
  black: "#111827",
  white: "#f8fafc",
  "sport grey": "#b8b8b8",
  "sport gray": "#b8b8b8",
  "athletic heather": "#c5c5c5",
  "heather grey": "#a8a8a8",
  "heather gray": "#a8a8a8",
  grey: "#9ca3af",
  gray: "#9ca3af",
  navy: "#1e3a5f",
  "navy blue": "#1e3a5f",
  royal: "#2563eb",
  "royal blue": "#2563eb",
  blue: "#2563eb",
  red: "#dc2626",
  cardinal: "#9b1c1c",
  maroon: "#7f1d1d",
  burgundy: "#7f1d1d",
  "forest green": "#166534",
  forest: "#166534",
  green: "#16a34a",
  "kelly green": "#16a34a",
  olive: "#4d7c0f",
  yellow: "#eab308",
  gold: "#ca8a04",
  orange: "#ea580c",
  purple: "#7c3aed",
  violet: "#7c3aed",
  pink: "#ec4899",
  "hot pink": "#db2777",
  "light pink": "#f9a8d4",
  "light blue": "#7dd3fc",
  "carolina blue": "#38bdf8",
  "sky blue": "#38bdf8",
  teal: "#0d9488",
  turquoise: "#14b8a6",
  brown: "#7c4a2d",
  chocolate: "#7c4a2d",
  khaki: "#c4b48a",
  sand: "#d6c4a3",
  beige: "#d6c4a3",
  cream: "#f5f0e1",
  ivory: "#fffff0",
  charcoal: "#374151",
  "dark heather": "#4b5563",
  "dark grey": "#4b5563",
  "dark gray": "#4b5563",
  ash: "#d1d5db",
  natural: "#f3e8d4",
  "natural raw": "#f3e8d4",
};

export function normalizeColorLabel(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function isGenericColorLabel(value) {
  return GENERIC_LABELS.has(normalizeColorLabel(value));
}

export function colorHexForName(label) {
  const key = normalizeColorLabel(label);
  if (COLOR_HEX[key]) return COLOR_HEX[key];
  for (const [name, hex] of Object.entries(COLOR_HEX)) {
    if (key.includes(name) || name.includes(key)) return hex;
  }
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue} 42% 52%)`;
}

export function isDarkColor(hexOrCss) {
  const raw = String(hexOrCss || "");
  const hex = raw.startsWith("#") ? raw.slice(1) : "";
  if (hex.length >= 6 && /^[0-9a-f]+$/i.test(hex.slice(0, 6))) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 < 148;
  }
  const hsl = raw.match(/hsl\(\s*(\d+)/i);
  if (hsl) {
    const hue = Number(hsl[1]);
    return hue < 45 || hue > 200;
  }
  return true;
}

export function colorLabelsOf(item) {
  const labels = [];
  const seen = new Set();
  const push = (raw) => {
    const label = String(raw || "").trim();
    if (!label || isGenericColorLabel(label)) return;
    const norm = normalizeColorLabel(label);
    if (seen.has(norm)) return;
    seen.add(norm);
    labels.push(label);
  };
  const live = Array.isArray(item?.live_colors) ? item.live_colors : [];
  if (live.length) {
    for (const label of live) push(label);
    return labels;
  }
  for (const view of Array.isArray(item?.grid_views) ? item.grid_views : []) {
    push(view?.variant_label || view?.variant);
  }
  for (const group of Array.isArray(item?.alt_image_groups) ? item.alt_image_groups : []) {
    push(group?.variant_label);
  }
  return labels;
}

export function productHasColor(item, color) {
  const want = normalizeColorLabel(color);
  if (!want) return false;
  return colorLabelsOf(item).some((label) => normalizeColorLabel(label) === want);
}

export function collectColorFacets(items) {
  const map = new Map();
  for (const item of items || []) {
    const seen = new Set();
    for (const label of colorLabelsOf(item)) {
      const norm = normalizeColorLabel(label);
      if (seen.has(norm)) continue;
      seen.add(norm);
      if (!map.has(norm)) map.set(norm, { label, count: 0 });
      map.get(norm).count += 1;
    }
  }
  return [...map.values()]
    .sort((a, b) => a.label.localeCompare(b.label, "en"))
    .map((row) => {
      const hex = colorHexForName(row.label);
      return { ...row, hex, dark: isDarkColor(hex) };
    });
}

export function findVariantIndexForColor(groups, color) {
  const want = normalizeColorLabel(color);
  if (!want) return -1;
  return (groups || []).findIndex((group) => normalizeColorLabel(group?.label) === want);
}

export function channelLabelForRemove(id) {
  const map = {
    printify: "Printify",
    shopify: "Shopify",
    amazon_europa: "Amazon Europa",
    amazon_amerika: "Amazon USA",
  };
  return map[id] || id;
}

export function channelsForRemoveColorVariant(item) {
  const channels = [];
  if (String(item?.printify_product_id || "").trim()) channels.push("printify");
  if (String(item?.shopify_product_id || item?.id || "").replace(/\D/g, "")) channels.push("shopify");
  if (item?.amazon_eu_listed || item?.amazon_de_listed || (item?.channel_keys || []).includes("amazon_eu")) {
    channels.push("amazon_europa");
  }
  if (item?.amazon_us_listed || (item?.channel_keys || []).includes("amazon_us")) {
    channels.push("amazon_amerika");
  }
  return [...new Set(channels)];
}

export function summarizeRemoveVariantImpact(items, color) {
  const products = [];
  const channelCounts = new Map();
  for (const item of items || []) {
    if (!productHasColor(item, color)) continue;
    const channels = channelsForRemoveColorVariant(item);
    products.push({ item, channels });
    for (const ch of channels) channelCounts.set(ch, (channelCounts.get(ch) || 0) + 1);
  }
  return {
    color,
    products,
    channels: [...channelCounts.entries()].map(([id, count]) => ({
      id,
      label: channelLabelForRemove(id),
      count,
    })),
  };
}
