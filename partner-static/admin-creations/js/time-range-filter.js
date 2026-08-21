/**
 * Shared Time range facet (same buckets as Admin Logs).
 * Keep in sync with src/features/admin/adminTimeRangeFilter.js
 */

export const TIME_RANGE_KEYS = ["today", "7d", "30d", "90d", "all"];

export const TIME_RANGE_LABELS = {
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  all: "All",
};

export function toEpochMs(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return 0;
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  const raw = String(value).trim();
  if (!raw) return 0;
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function itemRecencyMs(item) {
  if (!item || typeof item !== "object") return 0;
  return Math.max(
    toEpochMs(item.sort_ts),
    toEpochMs(item.updated_at),
    toEpochMs(item.published_at),
    toEpochMs(item.created_at)
  );
}

export function timeRangeToSince(range, now = Date.now(), todaySince = 0) {
  const key = String(range || "");
  if (key === "all") return 0;
  if (key === "today") {
    const client = Number(todaySince);
    if (Number.isFinite(client) && client > 0) return client;
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  const days = key === "7d" ? 7 : key === "90d" ? 90 : key === "30d" ? 30 : 0;
  if (!days) return 0;
  return now - days * 24 * 60 * 60 * 1000;
}

export function timeRangeKeysForMs(ms, now = Date.now(), todaySince = 0) {
  const keys = ["all"];
  const ts = Number(ms) || 0;
  if (ts <= 0) return keys;
  for (const key of ["today", "7d", "30d", "90d"]) {
    if (ts >= timeRangeToSince(key, now, todaySince)) keys.push(key);
  }
  return keys;
}

export function timeRangeKeysForItem(item, now = Date.now(), todaySince = 0) {
  return timeRangeKeysForMs(itemRecencyMs(item), now, todaySince);
}

export function localTodaySince(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function emptyTimeRangeFacets() {
  return TIME_RANGE_KEYS.map((key) => ({
    key,
    label: TIME_RANGE_LABELS[key],
    count: 0,
  }));
}
