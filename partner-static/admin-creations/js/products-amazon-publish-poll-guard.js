/**
 * Pure helpers: stop Amazon publish dock polling when nothing can be processed.
 *
 * Why: when creator-jobs-amazon-publish is OFF, the worker acks/discards queue
 * messages but D1 can stay "queued"/"publishing". The floating dock used to poll
 * admin-amazon-publish-status for up to ~12 minutes. Status now includes
 * queue_enabled; enqueue returns queue_disabled — both must settle the dock.
 */

export const AMAZON_PUBLISH_QUEUE_NAME = "creator-jobs-amazon-publish";

export const AMAZON_PUBLISH_QUEUE_OFF_MESSAGE =
  "Amazon publish queue is off — nothing is being processed. Enable creator-jobs-amazon-publish to continue.";

/**
 * Max identical "idle queued" ticks before abort — only when status omits queue_enabled
 * (legacy deploy). When queue_enabled:true, long queued waits are normal (createFeed ~1/min).
 */
export const AMAZON_PUBLISH_STAGNANT_IDLE_POLLS = 12;

const IDLE_QUEUED = new Set(["queued", "publishing", ""]);

/**
 * @param {unknown} payload status or enqueue JSON
 * @returns {boolean}
 */
export function isAmazonPublishQueueOff(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (payload.queue_enabled === false) return true;
  if (String(payload.error || "").toLowerCase() === "queue_disabled") return true;
  return false;
}

/**
 * @param {unknown} payload
 * @returns {Error}
 */
export function amazonPublishQueueOffError(payload) {
  const msg =
    (payload && typeof payload === "object" && (payload.message || payload.error_message)) ||
    AMAZON_PUBLISH_QUEUE_OFF_MESSAGE;
  const err = new Error(String(msg));
  err.code = "queue_disabled";
  return err;
}

/**
 * Fingerprint of selected market statuses for stagnation detection.
 * @param {string[]} marketCodes
 * @param {object|null|undefined} data admin-amazon-publish-status body
 * @param {string} continent
 */
export function amazonPublishStatusFingerprint(marketCodes, data, continent = "europa") {
  const codes = Array.isArray(marketCodes) ? marketCodes : [];
  const contKey = String(continent || "europa").toLowerCase();
  return codes
    .map((code) => {
      const c = String(code || "").trim().toUpperCase();
      const row = data?.markets?.[c] || data?.continents?.[contKey] || null;
      const st = String(row?.status || "").toLowerCase();
      const feed = row?.feed_id || row?.feedId || "";
      const asin = row?.asin || "";
      return `${c}:${st}:${feed}:${asin}`;
    })
    .join("|");
}

/**
 * True when every selected market looks idle-queued (no feed / processing signal).
 * @param {string[]} marketCodes
 * @param {object|null|undefined} data
 * @param {string} continent
 */
export function amazonPublishStatusLooksIdleQueued(marketCodes, data, continent = "europa") {
  const codes = Array.isArray(marketCodes) ? marketCodes : [];
  if (!codes.length) return false;
  const contKey = String(continent || "europa").toLowerCase();
  for (const code of codes) {
    const c = String(code || "").trim().toUpperCase();
    const row = data?.markets?.[c] || data?.continents?.[contKey] || null;
    const st = String(row?.status || "").toLowerCase();
    if (row?.asin) return false;
    if (row?.feed_id || row?.feedId) return false;
    if (!IDLE_QUEUED.has(st) && st !== "publishing") return false;
    if (st === "feed_pending" || st === "processing" || st === "verifying" || st === "pending_indexing") {
      return false;
    }
  }
  return true;
}

/**
 * Decide whether waitForAmazonContinentLive should stop polling.
 * Prefer queue_enabled:false (piggybacked on status). Idle stagnation only when the
 * status payload has no queue_enabled field (legacy) — never when queue is known ON.
 *
 * @param {{
 *   queueOff?: boolean,
 *   queueEnabledKnown?: boolean,
 *   stagnantIdlePolls?: number,
 *   maxStagnantIdlePolls?: number,
 *   idleQueued?: boolean
 * }} opts
 * @returns {{ abort: boolean, reason: string|null }}
 */
export function shouldAbortAmazonPublishWait(opts = {}) {
  if (opts.queueOff) {
    return { abort: true, reason: "queue_disabled" };
  }
  // Known-on queue: do not abort on idle queued (rate-limited consumer is expected).
  if (opts.queueEnabledKnown) {
    return { abort: false, reason: null };
  }
  const max =
    Number(opts.maxStagnantIdlePolls) > 0
      ? Number(opts.maxStagnantIdlePolls)
      : AMAZON_PUBLISH_STAGNANT_IDLE_POLLS;
  const stagnant = Number(opts.stagnantIdlePolls) || 0;
  if (opts.idleQueued && stagnant >= max) {
    return { abort: true, reason: "stagnant_idle" };
  }
  return { abort: false, reason: null };
}

export function amazonPublishStagnantIdleError() {
  const err = new Error(
    "Amazon publish stuck in queued with no progress (queue may be paused or jobs discarded)."
  );
  err.code = "stagnant_idle";
  return err;
}
