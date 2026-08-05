/**
 * Early browser console ring buffer for Admin Cursor Agent (IDEA-066).
 * Load as a blocking inline/sync script BEFORE the deferred shell so page
 * console / errors are captured from first paint onward.
 *
 * Global: window.__EAZ_CA_CONSOLE__ = { buf, max, hooked, installedAt, noiseOmitted }
 */
(function (global) {
  "use strict";
  var MAX = 200;
  var NOISE_RE =
    /Tracking Prevention|ERR_BLOCKED_BY_CLIENT|net::ERR_BLOCKED|Failed to load resource: net::ERR_BLOCKED|preload.*was preloaded but not used|was preloaded using link preload but not used|Access to (XMLHttpRequest|fetch).*has been blocked by CORS policy.*monorail|privacy-banner|connect\.facebook\.net|google-analytics\.com|googletagmanager\.com|doubleclick\.net|merchant.?center/i;

  var store = global.__EAZ_CA_CONSOLE__;
  if (!store || typeof store !== "object") {
    store = { buf: [], max: MAX, hooked: false, installedAt: null, noiseOmitted: 0 };
    global.__EAZ_CA_CONSOLE__ = store;
  }
  if (!Array.isArray(store.buf)) store.buf = [];
  store.max = store.max || MAX;
  if (typeof store.noiseOmitted !== "number") store.noiseOmitted = 0;
  if (store.hooked) return;

  function serialize(a) {
    try {
      if (a instanceof Error) return a.stack || a.message || String(a);
      if (typeof a === "string") return a;
      return JSON.stringify(a);
    } catch (e) {
      try {
        return String(a);
      } catch (e2) {
        return "[unserializable]";
      }
    }
  }

  function isNoise(message) {
    var msg = String(message || "");
    if (!msg) return false;
    if (msg.indexOf("[eaz-ca]") !== -1) return false;
    if (NOISE_RE.test(msg)) return true;
    if (/blocked access to (storage|script|xhr|fetch)/i.test(msg)) return true;
    return false;
  }

  function push(level, args) {
    var parts = [];
    for (var i = 0; i < args.length; i++) parts.push(serialize(args[i]));
    var message = parts.join(" ").slice(0, 4000);
    if (isNoise(message)) {
      store.noiseOmitted = (store.noiseOmitted || 0) + 1;
      return;
    }
    store.buf.push({
      t: new Date().toISOString(),
      level: level,
      message: message,
      href: (global.location && global.location.href) || "",
    });
    while (store.buf.length > store.max) store.buf.shift();
  }

  var levels = ["log", "info", "warn", "error", "debug"];
  for (var i = 0; i < levels.length; i++) {
    (function (level) {
      var orig = global.console && global.console[level] ? global.console[level].bind(global.console) : null;
      global.console[level] = function () {
        try {
          push(level, arguments);
        } catch (e) {}
        if (orig) return orig.apply(global.console, arguments);
      };
    })(levels[i]);
  }

  global.addEventListener("error", function (ev) {
    push("error", [
      (ev.message || "Error") +
        (ev.filename ? " @" + ev.filename + ":" + (ev.lineno || "?") : ""),
    ]);
  });
  global.addEventListener("unhandledrejection", function (ev) {
    push("error", ["UnhandledRejection:", ev.reason]);
  });

  store.hooked = true;
  store.installedAt = new Date().toISOString();
  push("info", ["[eaz-ca] browser console capture started"]);
})(typeof window !== "undefined" ? window : globalThis);
