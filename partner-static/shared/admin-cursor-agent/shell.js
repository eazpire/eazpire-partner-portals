/**
 * Admin Cursor Agent Shell (IDEA-066)
 * Floating Cursor-like UI for admins on all web portals.
 *
 * Config (optional): window.__EAZ_CURSOR_AGENT__ = {
 *   apiBase, customerId, portal, partnerAuthBase, cssUrl
 * }
 */
(function (global) {
  "use strict";

  if (global.__EAZ_CURSOR_AGENT_BOOTED__) return;
  global.__EAZ_CURSOR_AGENT_BOOTED__ = true;

  var CFG = Object.assign(
    {
      apiBase: "https://creator-engine.eazpire.workers.dev/apps/creator-dispatch",
      customerId: null,
      portal: "web",
      partnerAuthBase: null,
      cssUrl: null,
    },
    global.__EAZ_CURSOR_AGENT__ || {}
  );

  var state = {
    admin: false,
    actorId: null,
    open: false,
    chats: [],
    chatId: null,
    messages: [],
    models: [],
    modelId: "composer-2.5",
    mode: "agent",
    tab: "chat",
    viewerMode: "desktop",
    assets: [],
    streaming: false,
    attachOpen: false,
    functionsOpen: false,
    optScreenshot: false,
    optConsole: false,
    recognition: null,
    listening: false,
    syncBannerVisible: false,
  };

  var SYNC_BANNER_TEXT =
    "Synced to GitHub main. On your PC: git pull origin main";

  var CONSOLE_MAX = 200;
  /** Prefer recent useful lines when attaching to a prompt (size-safe for Cursor API). */
  var CONSOLE_DUMP_MAX_LINES = 80;
  var CONSOLE_DUMP_MAX_CHARS = 20 * 1024;
  var CONSOLE_NOISE_RE =
    /Tracking Prevention|ERR_BLOCKED_BY_CLIENT|net::ERR_BLOCKED|Failed to load resource: net::ERR_BLOCKED|preload.*was preloaded but not used|was preloaded using link preload but not used|Access to (XMLHttpRequest|fetch).*has been blocked by CORS policy.*monorail|privacy-banner|connect\.facebook\.net|google-analytics\.com|googletagmanager\.com|doubleclick\.net|merchant.?center/i;

  function ensureConsoleStore() {
    var store = global.__EAZ_CA_CONSOLE__;
    if (!store || typeof store !== "object") {
      store = { buf: [], max: CONSOLE_MAX, hooked: false, installedAt: null, noiseOmitted: 0 };
      global.__EAZ_CA_CONSOLE__ = store;
    }
    if (!Array.isArray(store.buf)) store.buf = [];
    store.max = store.max || CONSOLE_MAX;
    if (typeof store.noiseOmitted !== "number") store.noiseOmitted = 0;
    return store;
  }

  function serializeConsoleArg(a) {
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

  function isConsoleNoise(level, message) {
    var msg = String(message || "");
    if (!msg) return false;
    // Keep our own capture markers even if they match loosely.
    if (msg.indexOf("[eaz-ca]") !== -1) return false;
    if (CONSOLE_NOISE_RE.test(msg)) return true;
    // Edge "Tracking Prevention blocked access to storage for …" often arrives as info/log.
    if (/blocked access to (storage|script|xhr|fetch)/i.test(msg)) return true;
    return false;
  }

  function pushConsole(level, args) {
    var store = ensureConsoleStore();
    var parts = [];
    for (var i = 0; i < args.length; i++) parts.push(serializeConsoleArg(args[i]));
    var message = parts.join(" ").slice(0, 4000);
    if (isConsoleNoise(level, message)) {
      store.noiseOmitted = (store.noiseOmitted || 0) + 1;
      return;
    }
    store.buf.push({
      t: new Date().toISOString(),
      level: level,
      message: message,
      href: location.href || "",
    });
    while (store.buf.length > store.max) store.buf.shift();
  }

  /**
   * Install console hooks ASAP (top of shell parse). Prefer early sniffer
   * (console-early.js / head inject) — this is a fallback if that was missing.
   */
  function installConsoleCapture() {
    var store = ensureConsoleStore();
    if (store.hooked) return;
    store.hooked = true;
    store.installedAt = store.installedAt || new Date().toISOString();
    var levels = ["log", "info", "warn", "error", "debug"];
    levels.forEach(function (level) {
      var orig = console[level] ? console[level].bind(console) : null;
      console[level] = function () {
        try {
          pushConsole(level, arguments);
        } catch (e) {}
        if (orig) return orig.apply(console, arguments);
      };
    });
    global.addEventListener("error", function (ev) {
      pushConsole("error", [
        (ev.message || "Error") +
          (ev.filename ? " @" + ev.filename + ":" + (ev.lineno || "?") : ""),
      ]);
    });
    global.addEventListener("unhandledrejection", function (ev) {
      pushConsole("error", ["UnhandledRejection:", ev.reason]);
    });
    pushConsole("info", ["[eaz-ca] browser console capture started (shell fallback)"]);
  }

  // Run immediately when this file is evaluated (even with defer — before boot()).
  installConsoleCapture();

  function formatResourceFailures() {
    try {
      if (!global.performance || !performance.getEntriesByType) return "";
      var entries = performance.getEntriesByType("resource") || [];
      var bad = [];
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var status = typeof e.responseStatus === "number" ? e.responseStatus : 0;
        if (status >= 400) {
          bad.push(status + " " + (e.initiatorType || "resource") + " " + e.name);
        }
      }
      if (!bad.length) return "";
      return (
        "\n## Failed / HTTP-error resources (performance timeline, last " +
        Math.min(bad.length, 25) +
        ")\n" +
        bad.slice(-25).join("\n")
      );
    } catch (err) {
      return "";
    }
  }

  function formatConsoleDump() {
    var store = ensureConsoleStore();
    var buf = store.buf || [];
    var pageUrl = location.href || "";
    var installedAt = store.installedAt || "(unknown)";
    var noiseOmitted = store.noiseOmitted || 0;
    var header =
      "Page URL: " +
      pageUrl +
      "\nCapture installed at: " +
      installedAt +
      "\nEntries in buffer: " +
      buf.length +
      " (max " +
      (store.max || CONSOLE_MAX) +
      ")\n";
    if (noiseOmitted > 0) {
      header +=
        noiseOmitted +
        " tracking/analytics noise lines omitted (Tracking Prevention, adblock, pixels).\n";
    }
    if (!buf.length) {
      return (
        header +
        "\n(no console entries captured since hook install — buffer empty)\n" +
        "Note: only console/error events AFTER capture install are available." +
        formatResourceFailures()
      );
    }

    // Prefer warn/error/exception; fill remaining slots with recent info/log.
    var priority = [];
    var rest = [];
    for (var i = 0; i < buf.length; i++) {
      var lv = String(buf[i].level || "").toLowerCase();
      if (lv === "error" || lv === "warn" || lv === "exception") priority.push(buf[i]);
      else rest.push(buf[i]);
    }
    var selected = priority.concat(rest);
    if (selected.length > CONSOLE_DUMP_MAX_LINES) {
      selected = selected.slice(selected.length - CONSOLE_DUMP_MAX_LINES);
    }

    var lines = selected.map(function (e) {
      var hrefNote = e.href && e.href !== pageUrl ? " {" + e.href + "}" : "";
      return "[" + e.t + "] " + String(e.level || "?").toUpperCase() + ": " + e.message + hrefNote;
    });
    var body = lines.join("\n");
    if (body.length > CONSOLE_DUMP_MAX_CHARS) {
      body =
        body.slice(body.length - CONSOLE_DUMP_MAX_CHARS) +
        "\n…[console dump truncated to last " +
        CONSOLE_DUMP_MAX_CHARS +
        " chars]";
    }
    var note =
      selected.length < buf.length
        ? "\n(Showing " + selected.length + " of " + buf.length + " buffered lines; prefer warn/error.)\n"
        : "\n";
    return header + note + body + formatResourceFailures();
  }

  function buildConsolePromptBlock() {
    return (
      "## Browser console logs (LIVE dump from admin browser — analyze these)\n" +
      "IMPORTANT:\n" +
      "- These ARE the real browser console entries from the admin's current shop/portal page.\n" +
      "- Do NOT open Playwright, a browser, or Cloudflare dashboards to \"get logs\".\n" +
      "- Do NOT claim you lack access to the browser console — the dump below is attached for you.\n" +
      "- If the buffer is empty, say so and ask the admin to reproduce the issue with Functions → Include browser console enabled.\n" +
      "```\n" +
      formatConsoleDump() +
      "\n```"
    );
  }

  var els = {};

  function portalId() {
    if (CFG.portal && CFG.portal !== "web") return CFG.portal;
    var h = (location.hostname || "").toLowerCase();
    if (h.indexOf("admin.") === 0) {
      if (location.pathname.indexOf("/creations") === 0) return "admin-creations";
      if (location.pathname.indexOf("/partner") === 0) return "admin-partner";
      if (location.pathname.indexOf("/brands") === 0) return "admin-brands";
      if (location.pathname.indexOf("/audience") === 0) return "admin-audience";
      return "admin";
    }
    if (h.indexOf("creator.") === 0) return "creator";
    if (h.indexOf("matrix.") === 0) return "matrix";
    if (h.indexOf("map.") === 0) return "map";
    if (h.indexOf("brand.") === 0) return "brand";
    if (h.indexOf("universe.") === 0) return "universe";
    if (h.indexOf("roadmap.") === 0) return "roadmap";
    if (h.indexOf("ads.") === 0) return "ads";
    if (h.indexOf("play.") === 0) return "play";
    if (h.indexOf("wear.") === 0) return "wear";
    if (h.indexOf("partner.") === 0) return "partner";
    if (h.indexOf("www.") === 0 || h === "eazpire.com") return "shop";
    return "web";
  }

  function pageContext() {
    var store = ensureConsoleStore();
    return {
      portal: portalId(),
      href: location.href,
      hostname: location.hostname,
      pathname: location.pathname,
      title: document.title || "",
      viewport: { w: window.innerWidth, h: window.innerHeight },
      started_at: new Date().toISOString(),
      console_capture: {
        installed_at: store.installedAt || null,
        entry_count: (store.buf && store.buf.length) || 0,
        hooked: !!store.hooked,
      },
    };
  }

  function apiUrl(op, query) {
    var u = new URL(CFG.apiBase);
    u.searchParams.set("op", op);
    if (state.actorId || CFG.customerId) {
      u.searchParams.set("logged_in_customer_id", String(state.actorId || CFG.customerId));
    }
    if (query) {
      Object.keys(query).forEach(function (k) {
        if (query[k] != null && query[k] !== "") u.searchParams.set(k, query[k]);
      });
    }
    return u.toString();
  }

  function formatApiError(err, fallback) {
    var data = (err && err.data) || {};
    var detail = data.detail;
    var detailMsg = "";
    if (detail && typeof detail === "object") {
      if (detail.error && typeof detail.error === "object") {
        detailMsg = detail.error.message || detail.error.code || "";
      } else if (typeof detail.message === "string") {
        detailMsg = detail.message;
      } else if (typeof detail.error === "string") {
        detailMsg = detail.error;
      }
    } else if (typeof detail === "string") {
      detailMsg = detail;
    }
    var parts = [];
    if (data.message) parts.push(String(data.message));
    else if (detailMsg) parts.push(String(detailMsg));
    else if (err && err.message) parts.push(String(err.message));
    else if (data.error) parts.push(String(data.error));
    else parts.push(fallback || "Request failed");
    var status = err && err.status ? err.status : data.status;
    if (status && String(parts[0]).indexOf(String(status)) === -1) {
      parts[0] = "[" + status + "] " + parts[0];
    }
    if (data.error && parts[0].indexOf(String(data.error)) === -1 && data.error !== "cursor_send_failed") {
      parts.push("(" + data.error + ")");
    }
    if (detailMsg && parts[0].indexOf(detailMsg) === -1) {
      parts.push(detailMsg);
    }
    return parts.filter(Boolean).join(" — ").slice(0, 500);
  }

  async function api(op, opts) {
    opts = opts || {};
    var method = opts.method || "GET";
    var url = apiUrl(op, opts.query);
    var init = {
      method: method,
      credentials: "include",
      headers: {},
    };
    if (opts.body) {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    var res = await fetch(url, init);
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || data.ok === false) {
      var err = new Error(data.message || data.error || "http_" + res.status);
      err.status = res.status;
      err.data = data;
      err.displayMessage = formatApiError(err, "http_" + res.status);
      throw err;
    }
    return data;
  }

  /* ---- Draggable floating icons (Agent + Publish FABs), server-persisted ---- */
  var FAB_DRAG_THRESHOLD = 6;
  var fabPrefsCache = null;
  var fabPrefsLoading = null;
  var fabSaveTimers = {};
  var fabBoundEls = typeof WeakSet !== "undefined" ? new WeakSet() : null;

  function fabActorId() {
    return String(state.actorId || CFG.customerId || localStorage.getItem("eaz_admin_owner_id") || "");
  }

  function fabApiUrl(op) {
    var u = new URL(CFG.apiBase);
    u.searchParams.set("op", op);
    var actor = fabActorId();
    if (actor) u.searchParams.set("logged_in_customer_id", actor);
    return u.toString();
  }

  async function loadFabPrefs(force) {
    if (!force && fabPrefsCache) return fabPrefsCache;
    if (!force && fabPrefsLoading) return fabPrefsLoading;
    fabPrefsLoading = (async function () {
      try {
        var res = await fetch(fabApiUrl("admin-floating-icon-prefs"), { credentials: "include" });
        var data = await res.json().catch(function () {
          return {};
        });
        if (res.ok && data && data.ok) {
          fabPrefsCache = data.prefs && typeof data.prefs === "object" ? data.prefs : {};
        } else {
          fabPrefsCache = fabPrefsCache || {};
        }
      } catch (e) {
        fabPrefsCache = fabPrefsCache || {};
      } finally {
        fabPrefsLoading = null;
      }
      return fabPrefsCache;
    })();
    return fabPrefsLoading;
  }

  function clearCustomFabPos(el) {
    if (!el) return;
    el.classList.remove("eaz-fab--custom-pos", "eaz-fab--dragging");
    el.style.left = "";
    el.style.top = "";
    el.style.right = "";
    el.style.bottom = "";
  }

  function applyFabPct(el, pos) {
    if (!el) return;
    if (!pos || pos.x_pct == null || pos.y_pct == null) {
      clearCustomFabPos(el);
      return;
    }
    var xPct = Number(pos.x_pct);
    var yPct = Number(pos.y_pct);
    if (!isFinite(xPct) || !isFinite(yPct)) {
      clearCustomFabPos(el);
      return;
    }
    xPct = Math.min(100, Math.max(0, xPct));
    yPct = Math.min(100, Math.max(0, yPct));
    var w = el.offsetWidth || 52;
    var h = el.offsetHeight || 52;
    var maxX = Math.max(0, window.innerWidth - w);
    var maxY = Math.max(0, window.innerHeight - h);
    var left = (xPct / 100) * maxX;
    var top = (yPct / 100) * maxY;
    el.classList.add("eaz-fab--custom-pos");
    el.style.left = Math.round(left) + "px";
    el.style.top = Math.round(top) + "px";
    el.style.right = "auto";
    el.style.bottom = "auto";
  }

  function pctFromElement(el) {
    var w = el.offsetWidth || 52;
    var h = el.offsetHeight || 52;
    var maxX = Math.max(1, window.innerWidth - w);
    var maxY = Math.max(1, window.innerHeight - h);
    var rect = el.getBoundingClientRect();
    return {
      x_pct: Math.min(100, Math.max(0, (rect.left / maxX) * 100)),
      y_pct: Math.min(100, Math.max(0, (rect.top / maxY) * 100)),
    };
  }

  function scheduleFabSave(key, pos) {
    if (fabSaveTimers[key]) clearTimeout(fabSaveTimers[key]);
    fabSaveTimers[key] = setTimeout(function () {
      fabSaveTimers[key] = null;
      var body = JSON.stringify({ key: key, x_pct: pos.x_pct, y_pct: pos.y_pct });
      fetch(fabApiUrl("admin-floating-icon-prefs-save"), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: body,
      })
        .then(function (res) {
          return res.json().catch(function () {
            return {};
          });
        })
        .then(function (data) {
          if (data && data.ok) {
            fabPrefsCache = fabPrefsCache || {};
            fabPrefsCache[key] = { x_pct: pos.x_pct, y_pct: pos.y_pct };
          }
        })
        .catch(function () {});
    }, 280);
  }

  function scheduleFabClear(key) {
    if (fabSaveTimers[key]) clearTimeout(fabSaveTimers[key]);
    fabSaveTimers[key] = setTimeout(function () {
      fabSaveTimers[key] = null;
      fetch(fabApiUrl("admin-floating-icon-prefs-save"), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: key, clear: true }),
      })
        .then(function (res) {
          return res.json().catch(function () {
            return {};
          });
        })
        .then(function (data) {
          if (data && data.ok && fabPrefsCache) delete fabPrefsCache[key];
        })
        .catch(function () {});
    }, 120);
  }

  /**
   * @param {HTMLElement} moveEl element whose position is stored (rail or fab)
   * @param {string} key agent_fab | publish_fab
   * @param {{ handleEl?: HTMLElement }} [opts]
   */
  function bindFloatingIcon(moveEl, key, opts) {
    opts = opts || {};
    if (!moveEl || !key) return;
    if (fabBoundEls) {
      if (fabBoundEls.has(moveEl)) return;
      fabBoundEls.add(moveEl);
    } else if (moveEl.getAttribute("data-eaz-fab-bound") === "1") {
      return;
    } else {
      moveEl.setAttribute("data-eaz-fab-bound", "1");
    }

    var handleEl = opts.handleEl || moveEl;
    handleEl.classList.add("eaz-fab--draggable");
    handleEl.title = (handleEl.getAttribute("aria-label") || handleEl.title || "Icon") + " — drag to move, double-click to reset";

    loadFabPrefs(false).then(function (prefs) {
      applyFabPct(moveEl, prefs && prefs[key]);
    });

    var dragging = false;
    var moved = false;
    var startX = 0;
    var startY = 0;
    var origLeft = 0;
    var origTop = 0;
    var pointerId = null;

    function onPointerDown(ev) {
      if (ev.button != null && ev.button !== 0) return;
      var rect = moveEl.getBoundingClientRect();
      dragging = true;
      moved = false;
      startX = ev.clientX;
      startY = ev.clientY;
      origLeft = rect.left;
      origTop = rect.top;
      pointerId = ev.pointerId;
      try {
        handleEl.setPointerCapture(ev.pointerId);
      } catch (e) {}
    }

    function onPointerMove(ev) {
      if (!dragging) return;
      var dx = ev.clientX - startX;
      var dy = ev.clientY - startY;
      if (!moved && Math.abs(dx) < FAB_DRAG_THRESHOLD && Math.abs(dy) < FAB_DRAG_THRESHOLD) return;
      moved = true;
      moveEl.classList.add("eaz-fab--dragging", "eaz-fab--custom-pos");
      var w = moveEl.offsetWidth || 52;
      var h = moveEl.offsetHeight || 52;
      var left = Math.min(Math.max(0, origLeft + dx), Math.max(0, window.innerWidth - w));
      var top = Math.min(Math.max(0, origTop + dy), Math.max(0, window.innerHeight - h));
      moveEl.style.left = Math.round(left) + "px";
      moveEl.style.top = Math.round(top) + "px";
      moveEl.style.right = "auto";
      moveEl.style.bottom = "auto";
      ev.preventDefault();
    }

    function onPointerUp(ev) {
      if (!dragging) return;
      dragging = false;
      moveEl.classList.remove("eaz-fab--dragging");
      try {
        if (pointerId != null) handleEl.releasePointerCapture(pointerId);
      } catch (e2) {}
      pointerId = null;
      if (moved) {
        var pos = pctFromElement(moveEl);
        scheduleFabSave(key, pos);
        moveEl.setAttribute("data-eaz-fab-suppress-click", "1");
        handleEl.setAttribute("data-eaz-fab-suppress-click", "1");
        setTimeout(function () {
          moveEl.removeAttribute("data-eaz-fab-suppress-click");
          handleEl.removeAttribute("data-eaz-fab-suppress-click");
        }, 0);
      }
    }

    function onClickCapture(ev) {
      if (
        moveEl.getAttribute("data-eaz-fab-suppress-click") === "1" ||
        handleEl.getAttribute("data-eaz-fab-suppress-click") === "1" ||
        moved
      ) {
        ev.preventDefault();
        ev.stopPropagation();
        moved = false;
      }
    }

    function onDblClick(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      clearCustomFabPos(moveEl);
      scheduleFabClear(key);
    }

    function onResize() {
      if (!moveEl.classList.contains("eaz-fab--custom-pos")) return;
      var prefs = fabPrefsCache && fabPrefsCache[key];
      if (prefs) applyFabPct(moveEl, prefs);
      else applyFabPct(moveEl, pctFromElement(moveEl));
    }

    handleEl.addEventListener("pointerdown", onPointerDown);
    handleEl.addEventListener("pointermove", onPointerMove);
    handleEl.addEventListener("pointerup", onPointerUp);
    handleEl.addEventListener("pointercancel", onPointerUp);
    handleEl.addEventListener("click", onClickCapture, true);
    handleEl.addEventListener("dblclick", onDblClick);
    window.addEventListener("resize", onResize);
  }

  global.EazAdminFabPosition = {
    bind: bindFloatingIcon,
    apply: applyFabPct,
    clear: clearCustomFabPos,
    loadPrefs: loadFabPrefs,
    keys: { agent: "agent_fab", publish: "publish_fab" },
  };

  async function resolveActorId() {
    if (CFG.customerId) {
      state.actorId = String(CFG.customerId);
      try {
        localStorage.setItem("eaz_admin_owner_id", state.actorId);
      } catch (e) {}
      return state.actorId;
    }
    var bases = [];
    if (CFG.partnerAuthBase) bases.push(CFG.partnerAuthBase.replace(/\/$/, ""));
    if (location.hostname.indexOf("admin.") === 0 || location.hostname.indexOf("matrix.") === 0 || location.hostname.indexOf("map.") === 0) {
      bases.push(location.origin);
    }
    bases.push("https://admin.eazpire.com");
    for (var i = 0; i < bases.length; i++) {
      try {
        var u = new URL(bases[i]);
        u.searchParams.set("op", "admin-auth-me");
        var res = await fetch(u.toString(), { credentials: "include" });
        var data = await res.json().catch(function () {
          return {};
        });
        if (data && data.ok && data.session && data.session.owner_id) {
          state.actorId = String(data.session.owner_id);
          try {
            localStorage.setItem("eaz_admin_owner_id", state.actorId);
          } catch (e2) {}
          return state.actorId;
        }
      } catch (e3) {}
    }
    try {
      var stored = localStorage.getItem("eaz_admin_owner_id");
      if (stored) {
        state.actorId = stored;
        return stored;
      }
    } catch (e4) {}
    if (global.__EAZ_OWNER_ID) {
      state.actorId = String(global.__EAZ_OWNER_ID);
      return state.actorId;
    }
    return null;
  }

  function ensureCss() {
    if (document.getElementById("eaz-ca-shell-css")) return;
    if (CFG.cssUrl) {
      var link = document.createElement("link");
      link.id = "eaz-ca-shell-css";
      link.rel = "stylesheet";
      link.href = CFG.cssUrl;
      document.head.appendChild(link);
      return;
    }
    /* CSS expected to be loaded by host; if missing, inject minimal fallback later via inline if needed */
  }

  function setStatus(msg) {
    if (els.status) els.status.textContent = msg || "";
  }

  function showSyncBanner() {
    state.syncBannerVisible = true;
    if (els.syncBanner) els.syncBanner.hidden = false;
    setStatus(SYNC_BANNER_TEXT);
  }

  function hideSyncBanner() {
    state.syncBannerVisible = false;
    if (els.syncBanner) els.syncBanner.hidden = true;
  }

  /** Heuristic: agent result mentions deploy/push success, or always after FINISHED code runs. */
  function shouldShowSyncHint(poll) {
    if (!poll || poll.status !== "FINISHED") return false;
    var text = String((poll && poll.text) || "");
    if (/NOT DEPLOYED|push failed|deploy failed|not pushed/i.test(text)) return false;
    // Prefer show when deploy/push mentioned; otherwise still show after successful Done
    // (web agent runs are code/deploy oriented).
    return true;
  }

  function renderChatList() {
    if (!els.chatList) return;
    els.chatList.innerHTML = "";
    state.chats.forEach(function (c) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "eaz-ca-chat-item" + (c.id === state.chatId ? " is-active" : "");
      btn.innerHTML =
        '<span class="eaz-ca-chat-item-title"></span><span class="eaz-ca-chat-item-meta"></span>';
      btn.querySelector(".eaz-ca-chat-item-title").textContent = c.title || "Chat";
      btn.querySelector(".eaz-ca-chat-item-meta").textContent =
        (c.portal || "") + (c.status === "running" ? " · running" : "");
      btn.addEventListener("click", function () {
        openChat(c.id);
      });
      els.chatList.appendChild(btn);
    });
  }

  function renderMessages() {
    if (!els.transcript) return;
    els.transcript.innerHTML = "";
    if (!state.messages.length) {
      var empty = document.createElement("div");
      empty.className = "eaz-ca-msg system";
      empty.textContent = "Describe a change for this page. The agent will edit the repo and deploy to main.";
      els.transcript.appendChild(empty);
    }
    state.messages.forEach(function (m) {
      var div = document.createElement("div");
      div.className = "eaz-ca-msg " + (m.role || "assistant");
      div.textContent = m.content || "";
      if (m.images && m.images.length) {
        var wrap = document.createElement("div");
        wrap.className = "eaz-ca-msg-images";
        m.images.forEach(function (img) {
          var im = document.createElement("img");
          im.src = img.url || img.preview || "";
          im.alt = "";
          wrap.appendChild(im);
        });
        div.appendChild(wrap);
      }
      els.transcript.appendChild(div);
    });
    els.transcript.scrollTop = els.transcript.scrollHeight;
  }

  function renderAssets() {
    if (!els.assets) return;
    els.assets.innerHTML = "";
    state.assets.forEach(function (a, idx) {
      var chip = document.createElement("div");
      chip.className = "eaz-ca-asset";
      var img = document.createElement("img");
      img.src = a.preview || a.url;
      img.alt = "";
      var x = document.createElement("button");
      x.type = "button";
      x.className = "eaz-ca-asset-x";
      x.textContent = "×";
      x.addEventListener("click", function () {
        removeAsset(idx);
      });
      chip.appendChild(img);
      chip.appendChild(x);
      els.assets.appendChild(chip);
    });
  }

  function updateContextChip() {
    if (!els.contextChip) return;
    var ctx = pageContext();
    els.contextChip.textContent = ctx.portal + " · " + ctx.pathname;
    els.contextChip.title = ctx.href;
  }

  function setTab(tab) {
    state.tab = tab;
    if (els.tabChat) els.tabChat.classList.toggle("is-active", tab === "chat");
    if (els.tabViewer) els.tabViewer.classList.toggle("is-active", tab === "viewer");
    if (els.transcript) els.transcript.classList.toggle("is-hidden", tab !== "chat");
    if (els.viewer) els.viewer.classList.toggle("is-active", tab === "viewer");
    if (tab === "viewer") refreshViewer(false);
  }

  function refreshViewer(bust) {
    if (!els.iframe) return;
    var href = location.href;
    if (state.chatId) {
      var chat = state.chats.find(function (c) {
        return c.id === state.chatId;
      });
      if (chat && chat.context_href) href = chat.context_href;
    }
    try {
      var u = new URL(href, location.origin);
      if (bust) u.searchParams.set("eaz_ca_preview", String(Date.now()));
      els.iframe.src = u.toString();
    } catch (e) {
      els.iframe.src = href;
    }
    els.iframe.classList.toggle("is-mobile", state.viewerMode === "mobile");
  }

  async function loadModels() {
    try {
      var data = await api("admin-cursor-models");
      state.models = data.items || [];
      if (els.modelSelect) {
        els.modelSelect.innerHTML = "";
        if (!state.models.length) {
          state.models = [{ id: "composer-2.5", displayName: "Composer 2.5" }];
        }
        state.models.forEach(function (m) {
          var opt = document.createElement("option");
          opt.value = m.id;
          opt.textContent = m.displayName || m.id;
          if (m.id === state.modelId) opt.selected = true;
          els.modelSelect.appendChild(opt);
        });
      }
    } catch (e) {
      setStatus("Models unavailable");
    }
  }

  async function loadChats() {
    var data = await api("admin-cursor-chats");
    state.chats = data.chats || [];
    renderChatList();
  }

  async function openChat(id, opts) {
    opts = opts || {};
    state.chatId = id;
    var data = await api("admin-cursor-chat-get", { query: { chat_id: id } });
    state.messages = data.messages || [];
    if (data.chat && data.chat.model_id) state.modelId = data.chat.model_id;
    renderChatList();
    renderMessages();
    if (els.modelSelect && state.modelId) els.modelSelect.value = state.modelId;
    // Resume a stuck/active run when opening the chat (poll + optional stream).
    if (!opts.skipResume && data.chat && data.chat.status === "running") {
      followRun(id, data.chat.active_run_id || "", { force: true });
    }
  }

  async function newChat() {
    var data = await api("admin-cursor-chat-create", {
      method: "POST",
      body: { model_id: state.modelId, mode: state.mode, context: pageContext() },
    });
    state.chatId = data.chat.id;
    state.messages = [];
    await loadChats();
    renderMessages();
  }

  async function removeAsset(idx) {
    var a = state.assets[idx];
    if (!a) return;
    state.assets.splice(idx, 1);
    renderAssets();
    if (a.key) {
      try {
        await api("admin-cursor-asset-delete", { method: "POST", body: { key: a.key } });
      } catch (e) {}
    }
  }

  async function uploadBlob(blob, mime) {
    if (state.assets.length >= 5) {
      setStatus("Max 5 images per prompt");
      return;
    }
    var form = new FormData();
    form.append("image", blob, "capture." + ((mime || "image/png").split("/")[1] || "png"));
    var url = apiUrl("admin-cursor-upload");
    var res = await fetch(url, { method: "POST", credentials: "include", body: form });
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || data.ok === false) throw new Error(data.error || "upload_failed");
    var preview = URL.createObjectURL(blob);
    state.assets.push({ url: data.url, key: data.key, mimeType: data.mimeType || mime, preview: preview });
    renderAssets();
  }

  function fileToBlob(file) {
    return file;
  }

  async function captureViewport() {
    setStatus("Capturing viewport…");
    try {
      if (global.html2canvas) {
        var canvas = await global.html2canvas(document.documentElement, {
          useCORS: true,
          allowTaint: true,
          logging: false,
          scale: Math.min(2, global.devicePixelRatio || 1),
        });
        var blob = await new Promise(function (resolve) {
          canvas.toBlob(resolve, "image/png");
        });
        if (blob) await uploadBlob(blob, "image/png");
        setStatus("Viewport captured");
        return;
      }
    } catch (e) {}
    /* Fallback: display media (this tab) without crop */
    await captureDisplay(false);
  }

  /** Hide agent UI so the request screenshot shows the page underneath. */
  async function capturePageForRequest() {
    var rootWasHidden = els.root ? els.root.hidden : true;
    var fabWasHidden = els.fab ? els.fab.hidden : true;
    try {
      if (els.root) els.root.hidden = true;
      if (els.fab) els.fab.hidden = true;
      await new Promise(function (r) {
        requestAnimationFrame(function () {
          requestAnimationFrame(r);
        });
      });
      await captureViewport();
    } finally {
      if (els.root) els.root.hidden = rootWasHidden;
      if (els.fab) els.fab.hidden = fabWasHidden;
    }
  }

  async function captureDisplay(withCrop) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      setStatus("Screen capture not supported in this browser");
      return;
    }
    setStatus(withCrop ? "Select region…" : "Select screen/tab…");
    var stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    try {
      var track = stream.getVideoTracks()[0];
      var video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      await new Promise(function (r) {
        setTimeout(r, 200);
      });
      var canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0);
      track.stop();
      stream.getTracks().forEach(function (t) {
        t.stop();
      });

      if (!withCrop) {
        var blob = await new Promise(function (resolve) {
          canvas.toBlob(resolve, "image/png");
        });
        if (blob) await uploadBlob(blob, "image/png");
        setStatus("Screenshot added");
        return;
      }

      var region = await pickRegion();
      if (!region) {
        setStatus("Capture cancelled");
        return;
      }
      var scaleX = canvas.width / window.innerWidth;
      var scaleY = canvas.height / window.innerHeight;
      var sx = Math.round(region.x * scaleX);
      var sy = Math.round(region.y * scaleY);
      var sw = Math.round(region.w * scaleX);
      var sh = Math.round(region.h * scaleY);
      var out = document.createElement("canvas");
      out.width = Math.max(1, sw);
      out.height = Math.max(1, sh);
      out.getContext("2d").drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
      var cropped = await new Promise(function (resolve) {
        out.toBlob(resolve, "image/png");
      });
      if (cropped) await uploadBlob(cropped, "image/png");
      setStatus("Region captured");
    } catch (e) {
      stream.getTracks().forEach(function (t) {
        t.stop();
      });
      setStatus(e.message || "Capture failed");
    }
  }

  function pickRegion() {
    return new Promise(function (resolve) {
      var overlay = document.createElement("div");
      overlay.className = "eaz-ca-crop-overlay";
      var rect = document.createElement("div");
      rect.className = "eaz-ca-crop-rect";
      overlay.appendChild(rect);
      document.body.appendChild(overlay);
      var start = null;
      function onDown(e) {
        start = { x: e.clientX, y: e.clientY };
        rect.style.left = start.x + "px";
        rect.style.top = start.y + "px";
        rect.style.width = "0px";
        rect.style.height = "0px";
      }
      function onMove(e) {
        if (!start) return;
        var x = Math.min(start.x, e.clientX);
        var y = Math.min(start.y, e.clientY);
        var w = Math.abs(e.clientX - start.x);
        var h = Math.abs(e.clientY - start.y);
        rect.style.left = x + "px";
        rect.style.top = y + "px";
        rect.style.width = w + "px";
        rect.style.height = h + "px";
      }
      function cleanup(result) {
        overlay.removeEventListener("mousedown", onDown);
        overlay.removeEventListener("mousemove", onMove);
        overlay.removeEventListener("mouseup", onUp);
        overlay.removeEventListener("keydown", onKey);
        overlay.remove();
        resolve(result);
      }
      function onUp(e) {
        if (!start) return cleanup(null);
        var x = Math.min(start.x, e.clientX);
        var y = Math.min(start.y, e.clientY);
        var w = Math.abs(e.clientX - start.x);
        var h = Math.abs(e.clientY - start.y);
        if (w < 8 || h < 8) return cleanup(null);
        cleanup({ x: x, y: y, w: w, h: h });
      }
      function onKey(e) {
        if (e.key === "Escape") cleanup(null);
      }
      overlay.tabIndex = 0;
      overlay.addEventListener("mousedown", onDown);
      overlay.addEventListener("mousemove", onMove);
      overlay.addEventListener("mouseup", onUp);
      overlay.addEventListener("keydown", onKey);
      overlay.focus();
    });
  }

  async function handleUploadFile(file) {
    if (!file || !String(file.type || "").startsWith("image/")) {
      setStatus("Please choose an image file");
      return;
    }
    await uploadBlob(fileToBlob(file), file.type);
    setStatus("Image uploaded");
  }

  async function handlePaste(e) {
    if (!state.open) return;
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf("image/") === 0) {
        e.preventDefault();
        var file = items[i].getAsFile();
        if (file) await handleUploadFile(file);
        return;
      }
    }
  }

  function toggleVoice() {
    var SR = global.SpeechRecognition || global.webkitSpeechRecognition;
    if (!SR) {
      setStatus("Voice input not supported in this browser");
      return;
    }
    if (state.listening && state.recognition) {
      state.recognition.stop();
      state.listening = false;
      if (els.micBtn) els.micBtn.classList.remove("is-active");
      setStatus("");
      return;
    }
    var rec = new SR();
    rec.lang = (document.documentElement.lang || "en").slice(0, 2) === "de" ? "de-DE" : "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = function (ev) {
      var text = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        text += ev.results[i][0].transcript;
      }
      if (els.input) {
        els.input.value = (els.input.value ? els.input.value + " " : "") + text.trim();
      }
    };
    rec.onerror = function () {
      state.listening = false;
      if (els.micBtn) els.micBtn.classList.remove("is-active");
      setStatus("Voice error");
    };
    rec.onend = function () {
      state.listening = false;
      if (els.micBtn) els.micBtn.classList.remove("is-active");
    };
    state.recognition = rec;
    state.listening = true;
    if (els.micBtn) els.micBtn.classList.add("is-active");
    setStatus("Listening…");
    rec.start();
  }

  function applyLiveText(liveEls, text) {
    if (!liveEls || !liveEls.body || text == null) return;
    var next = String(text);
    if (!next) return;
    // Prefer growing delta append; if server sends full snapshot, replace when longer.
    if (next.indexOf(liveEls.body.textContent) === 0) {
      liveEls.body.textContent = next;
    } else if (liveEls.body.textContent.indexOf(next) === 0) {
      /* ignore older/shorter snapshot */
    } else if (next.length >= liveEls.body.textContent.length) {
      liveEls.body.textContent = next;
    } else {
      liveEls.body.textContent += next;
    }
    els.transcript.scrollTop = els.transcript.scrollHeight;
  }

  async function pollRunOnce(chatId, runId) {
    return api("admin-cursor-run-get", {
      query: { chat_id: chatId, run_id: runId || "" },
    });
  }

  /**
   * Follow a Cursor run: poll for reliable completion + optional SSE for live text.
   * Cloudflare Workers often stall long SSE; polling is the source of truth.
   */
  async function followRun(chatId, runId, opts) {
    opts = opts || {};
    if (state.streaming && !opts.force) return;
    // Force-resume: tear down a stuck follow loop marker so UI can recover.
    if (opts.force && state.streaming) {
      state.streaming = false;
    }
    state.streaming = true;
    if (els.sendBtn) els.sendBtn.disabled = true;
    setStatus("Agent running…");

    var live = document.createElement("div");
    live.className = "eaz-ca-msg assistant eaz-ca-live";
    live.innerHTML = '<div class="eaz-ca-live-meta"></div><div class="eaz-ca-live-body"></div>';
    var liveEls = {
      root: live,
      meta: live.querySelector(".eaz-ca-live-meta"),
      body: live.querySelector(".eaz-ca-live-body"),
    };
    liveEls.meta.textContent = "Starting…";
    if (!liveEls.body.textContent) {
      liveEls.body.textContent = "Waiting for agent status / tools / reply…";
    }
    els.transcript.appendChild(live);

    var finished = false;
    var abortStream = null;
    var pollTimer = null;
    var streamFailed = false;
    var lastToolLabel = "";

    function finishUi(statusMsg) {
      if (finished) return;
      finished = true;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (abortStream) {
        try {
          abortStream.abort();
        } catch (eAbort) {}
        abortStream = null;
      }
      state.streaming = false;
      if (els.sendBtn) els.sendBtn.disabled = false;
      setStatus(statusMsg || "Ready");
    }

    async function onTerminal(poll) {
      var text = (poll && poll.text) || "";
      // Prefer server result text; drop the placeholder waiting line.
      if (text) applyLiveText(liveEls, text);
      else if (
        !liveEls.body.textContent ||
        liveEls.body.textContent.indexOf("Waiting for agent") === 0
      ) {
        liveEls.body.textContent =
          poll && poll.status ? "Run ended (" + poll.status + ")." : "Run finished (no text).";
      }
      liveEls.meta.textContent = (poll && poll.status) || "FINISHED";
      // Clear "Agent running…" immediately when poll reports FINISHED + result.
      var doneOk = poll && poll.status === "FINISHED";
      finishUi(
        doneOk
          ? shouldShowSyncHint(poll)
            ? SYNC_BANNER_TEXT
            : "Done — refreshing live view…"
          : "Ended: " + ((poll && poll.status) || "unknown")
      );
      if (doneOk) {
        refreshViewer(true);
        if (shouldShowSyncHint(poll)) showSyncBanner();
      }
      await loadChats();
      if (state.chatId) {
        try {
          await openChat(state.chatId, { skipResume: true });
        } catch (eOpen) {}
      }
      // Re-assert banner after openChat may refresh status to "Ready".
      if (doneOk && shouldShowSyncHint(poll) && state.syncBannerVisible) {
        setStatus(SYNC_BANNER_TEXT);
      }
    }

    async function tickPoll() {
      if (finished) return;
      try {
        var poll = await pollRunOnce(chatId, runId);
        if (poll.run_id && !runId) runId = poll.run_id;
        if (poll.status) {
          var meta = "Status: " + poll.status;
          if (lastToolLabel) meta += " · " + lastToolLabel;
          liveEls.meta.textContent = meta;
          setStatus(
            poll.terminal
              ? poll.status === "FINISHED"
                ? "Done"
                : "Ended: " + poll.status
              : "Agent " + String(poll.status).toLowerCase() + "…"
          );
        }
        if (poll.text) {
          applyLiveText(liveEls, poll.text);
          if (
            !poll.terminal &&
            liveEls.body.textContent &&
            liveEls.body.textContent.indexOf("Waiting for agent") !== 0
          ) {
            // Partial result arrived via Get A Run — show progress before final.
            liveEls.meta.textContent =
              "Status: " + (poll.status || "RUNNING") + " · partial result";
          }
        }
        if (poll.terminal) {
          await onTerminal(poll);
        }
      } catch (ePoll) {
        // Keep trying; stream may still deliver. Surface after stream also fails.
        if (streamFailed) {
          liveEls.meta.textContent = ePoll.message || "poll_failed";
        }
      }
    }

    // Poll immediately, then every 1.5s (primary completion path; SSE often stalls).
    await tickPoll();
    pollTimer = setInterval(function () {
      tickPoll();
    }, 1500);

    // Best-effort SSE for live assistant deltas (may stall on Worker).
    try {
      abortStream = typeof AbortController !== "undefined" ? new AbortController() : null;
      var url = apiUrl("admin-cursor-stream", { chat_id: chatId, run_id: runId || "" });
      var res = await fetch(url, {
        credentials: "include",
        headers: { Accept: "text/event-stream" },
        signal: abortStream ? abortStream.signal : undefined,
      });
      if (!res.ok || !res.body) {
        streamFailed = true;
        var errData = await res.json().catch(function () {
          return {};
        });
        liveEls.meta.textContent = "Live stream unavailable — polling…";
        if (errData.error) setStatus("Polling (stream: " + errData.error + ")");
      } else {
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buf = "";
        var eventType = "message";
        while (!finished) {
          var chunk = await reader.read();
          if (chunk.done) break;
          buf += decoder.decode(chunk.value, { stream: true });
          var lines = buf.split("\n");
          buf = lines.pop() || "";
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (line.indexOf("event:") === 0) {
              eventType = line.slice(6).trim();
            } else if (line.indexOf("data:") === 0) {
              var raw = line.slice(5).trim();
              if (!raw) continue;
              try {
                var parsed = JSON.parse(raw);
                if (eventType === "status" || parsed.status) {
                  var st = parsed.status || "";
                  if (st) {
                    liveEls.meta.textContent = "Status: " + st;
                    setStatus("Agent " + String(st).toLowerCase() + "…");
                  }
                }
                if (eventType === "tool_call" || parsed.type === "tool_call" || parsed.callId) {
                  var toolName = parsed.name || parsed.toolName || "tool";
                  var toolSt = parsed.status || "";
                  lastToolLabel = "Tool: " + toolName + (toolSt ? " (" + toolSt + ")" : "");
                  liveEls.meta.textContent = lastToolLabel;
                  setStatus(lastToolLabel);
                }
                var t =
                  parsed.text ||
                  (parsed.message &&
                    parsed.message.content &&
                    parsed.message.content
                      .filter(function (b) {
                        return b.type === "text";
                      })
                      .map(function (b) {
                        return b.text;
                      })
                      .join("")) ||
                  "";
                if ((eventType === "assistant" || parsed.type === "assistant") && t) {
                  // Deltas: append
                  liveEls.body.textContent += t;
                  els.transcript.scrollTop = els.transcript.scrollHeight;
                }
                if (eventType === "result" || parsed.type === "result") {
                  var finalText = parsed.text || parsed.result || "";
                  if (finalText) applyLiveText(liveEls, finalText);
                  liveEls.meta.textContent = parsed.status || "FINISHED";
                  // Let poll persist + finalize (Worker may also persist from stream).
                  await tickPoll();
                }
                if (eventType === "error" || parsed.type === "error") {
                  setStatus(parsed.message || parsed.code || "Agent error");
                  liveEls.meta.textContent = parsed.message || "error";
                }
              } catch (eParse) {}
              eventType = "message";
            } else if (!line) {
              eventType = "message";
            }
          }
        }
      }
    } catch (eStream) {
      if (!finished && (!eStream || eStream.name !== "AbortError")) {
        streamFailed = true;
        liveEls.meta.textContent = "Live stream closed — polling…";
      }
    }

    // If stream ended but poll has not finished yet, wait up to ~10 min via poll.
    var waitStart = Date.now();
    while (!finished && Date.now() - waitStart < 10 * 60 * 1000) {
      await tickPoll();
      if (finished) break;
      await new Promise(function (r) {
        setTimeout(r, 2500);
      });
    }

    if (!finished) {
      finishUi("Still running — reopen chat to resume");
      liveEls.meta.textContent = "Timeout waiting for result — reopen chat to resume";
    }

    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (state.streaming) {
      state.streaming = false;
      if (els.sendBtn) els.sendBtn.disabled = false;
    }
  }

  function syncFunctionsUi() {
    if (els.optScreenshot) els.optScreenshot.checked = !!state.optScreenshot;
    if (els.optConsole) els.optConsole.checked = !!state.optConsole;
    if (els.functionsBtn) {
      els.functionsBtn.classList.toggle(
        "is-active",
        !!(state.optScreenshot || state.optConsole || state.functionsOpen)
      );
    }
  }

  async function sendPrompt() {
    if (state.streaming) return;
    var text = (els.input && els.input.value.trim()) || "";
    var needCapture = state.optScreenshot || state.optConsole;
    if (!text && !state.assets.length && !needCapture) {
      setStatus("Enter a prompt or enable Functions (screenshot / console)");
      return;
    }

    state.functionsOpen = false;
    if (els.functionsMenu) els.functionsMenu.classList.remove("is-open");

    if (state.optScreenshot) {
      setStatus("Capturing screenshot for request…");
      try {
        await capturePageForRequest();
      } catch (eCap) {
        setStatus("Screenshot failed: " + (eCap.message || eCap));
      }
    }

    if (state.optConsole) {
      text = (text ? text + "\n\n" : "") + buildConsolePromptBlock();
    }

    var images = state.assets.map(function (a) {
      return { url: a.url };
    });
    var optimistic = { role: "user", content: text, images: state.assets.slice() };
    state.messages.push(optimistic);
    renderMessages();
    if (els.input) els.input.value = "";
    var sentAssets = state.assets.slice();
    state.assets = [];
    renderAssets();

    try {
      var data = await api("admin-cursor-send", {
        method: "POST",
        body: {
          chat_id: state.chatId,
          text: text,
          images: images,
          model_id: state.modelId,
          mode: state.mode,
          context: pageContext(),
        },
      });
      state.chatId = data.chat_id;
      await loadChats();
      await followRun(data.chat_id, data.run_id || "");
    } catch (e) {
      if (e && e.data && e.data.error === "agent_busy" && e.data.chat_id) {
        state.chatId = e.data.chat_id;
        setStatus("Agent already busy — resuming live updates…");
        await followRun(e.data.chat_id, e.data.run_id || "");
        return;
      }
      setStatus((e && e.displayMessage) || formatApiError(e, "Send failed"));
      state.assets = sentAssets.concat(state.assets).slice(0, 5);
      renderAssets();
    }
  }

  function buildDom() {
    var root = document.createElement("div");
    root.className = "eaz-ca-root";
    root.hidden = true;
    root.innerHTML =
      '<div class="eaz-ca-panel" role="dialog" aria-label="Cursor Agent">' +
      '<aside class="eaz-ca-sidebar">' +
      '<div class="eaz-ca-sidebar-head">' +
      '<button type="button" class="eaz-ca-btn eaz-ca-btn-primary" data-ca="new">New chat</button>' +
      '<button type="button" class="eaz-ca-btn eaz-ca-btn-ghost" data-ca="close">Close</button>' +
      "</div>" +
      '<div class="eaz-ca-chat-list" data-ca="chat-list"></div>' +
      "</aside>" +
      '<section class="eaz-ca-main">' +
      '<div class="eaz-ca-top">' +
      '<div class="eaz-ca-tabs">' +
      '<button type="button" class="eaz-ca-tab is-active" data-ca="tab-chat">Chat</button>' +
      '<button type="button" class="eaz-ca-tab" data-ca="tab-viewer">Live Viewer</button>' +
      "</div>" +
      '<span class="eaz-ca-context-chip" data-ca="context"></span>' +
      '<div class="eaz-ca-top-right">' +
      '<select class="eaz-ca-select" data-ca="model" title="Model"></select>' +
      '<select class="eaz-ca-select" data-ca="mode" title="Mode"><option value="agent">Agent</option></select>' +
      "</div>" +
      "</div>" +
      '<div class="eaz-ca-content">' +
      '<div class="eaz-ca-transcript" data-ca="transcript"></div>' +
      '<div class="eaz-ca-viewer" data-ca="viewer">' +
      '<div class="eaz-ca-viewer-toolbar">' +
      '<button type="button" class="eaz-ca-btn" data-ca="view-desktop">Desktop</button>' +
      '<button type="button" class="eaz-ca-btn" data-ca="view-mobile">Mobile</button>' +
      '<button type="button" class="eaz-ca-btn" data-ca="view-reload">Reload</button>' +
      "</div>" +
      '<div class="eaz-ca-viewer-frame-wrap"><iframe class="eaz-ca-viewer-frame" data-ca="iframe" title="Live preview"></iframe></div>' +
      "</div>" +
      "</div>" +
      '<div class="eaz-ca-footer eaz-ca-footer-wrap">' +
      '<div class="eaz-ca-attach-menu" data-ca="attach-menu">' +
      '<button type="button" data-ca="cap-full">Fullscreen / viewport</button>' +
      '<button type="button" data-ca="cap-rect">Rectangle select</button>' +
      '<button type="button" data-ca="cap-file">Upload image</button>' +
      '<button type="button" data-ca="cap-paste-hint">Paste image (Ctrl+V)</button>' +
      "</div>" +
      '<div class="eaz-ca-assets" data-ca="assets"></div>' +
      '<div class="eaz-ca-compose">' +
      '<button type="button" class="eaz-ca-icon-btn" data-ca="mic" title="Voice">🎤</button>' +
      '<button type="button" class="eaz-ca-icon-btn" data-ca="attach" title="Attach">📎</button>' +
      '<textarea data-ca="input" rows="2" placeholder="Ask Cursor to change this page…"></textarea>' +
      '<div class="eaz-ca-compose-actions">' +
      '<button type="button" class="eaz-ca-btn" data-ca="functions" title="Functions">Functions</button>' +
      '<button type="button" class="eaz-ca-btn eaz-ca-btn-primary" data-ca="send">Send</button>' +
      "</div>" +
      "</div>" +
      '<div class="eaz-ca-functions-menu" data-ca="functions-menu">' +
      '<label class="eaz-ca-check"><input type="checkbox" data-ca="opt-screenshot" /> Take screenshot with request</label>' +
      '<label class="eaz-ca-check"><input type="checkbox" data-ca="opt-console" /> Include browser console</label>' +
      '<p class="eaz-ca-functions-hint">Checked options apply on Send. Console dump = live page logs (not Cloudflare).</p>' +
      "</div>" +
      '<div class="eaz-ca-sync-banner" data-ca="sync-banner" hidden role="status">' +
      '<span class="eaz-ca-sync-banner-text"></span>' +
      '<button type="button" class="eaz-ca-sync-banner-x" data-ca="sync-dismiss" aria-label="Dismiss">×</button>' +
      "</div>" +
      '<div class="eaz-ca-status" data-ca="status"></div>' +
      '<input type="file" accept="image/*" hidden data-ca="file" />' +
      "</div>" +
      "</section>" +
      "</div>";

    var fab = document.createElement("button");
    fab.type = "button";
    fab.className = "eaz-ca-fab";
    fab.title = "Agent";
    fab.setAttribute("aria-label", "Open Agent");
    fab.innerHTML =
      '<svg class="eaz-ca-fab__icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      '<path d="M12 8V4H8"/>' +
      '<rect width="16" height="12" x="4" y="8" rx="2"/>' +
      '<path d="M2 14h2"/>' +
      '<path d="M20 14h2"/>' +
      '<path d="M15 13v2"/>' +
      '<path d="M9 13v2"/>' +
      "</svg>";
    fab.hidden = true;

    document.body.appendChild(fab);
    document.body.appendChild(root);

    els = {
      root: root,
      fab: fab,
      chatList: root.querySelector('[data-ca="chat-list"]'),
      transcript: root.querySelector('[data-ca="transcript"]'),
      viewer: root.querySelector('[data-ca="viewer"]'),
      iframe: root.querySelector('[data-ca="iframe"]'),
      input: root.querySelector('[data-ca="input"]'),
      status: root.querySelector('[data-ca="status"]'),
      assets: root.querySelector('[data-ca="assets"]'),
      modelSelect: root.querySelector('[data-ca="model"]'),
      modeSelect: root.querySelector('[data-ca="mode"]'),
      contextChip: root.querySelector('[data-ca="context"]'),
      attachMenu: root.querySelector('[data-ca="attach-menu"]'),
      functionsMenu: root.querySelector('[data-ca="functions-menu"]'),
      functionsBtn: root.querySelector('[data-ca="functions"]'),
      optScreenshot: root.querySelector('[data-ca="opt-screenshot"]'),
      optConsole: root.querySelector('[data-ca="opt-console"]'),
      file: root.querySelector('[data-ca="file"]'),
      sendBtn: root.querySelector('[data-ca="send"]'),
      micBtn: root.querySelector('[data-ca="mic"]'),
      tabChat: root.querySelector('[data-ca="tab-chat"]'),
      tabViewer: root.querySelector('[data-ca="tab-viewer"]'),
      syncBanner: root.querySelector('[data-ca="sync-banner"]'),
      syncBannerText: root.querySelector(".eaz-ca-sync-banner-text"),
    };
    if (els.syncBannerText) els.syncBannerText.textContent = SYNC_BANNER_TEXT;
    syncFunctionsUi();

    fab.addEventListener("click", function (ev) {
      if (fab.getAttribute("data-eaz-fab-suppress-click") === "1") {
        if (ev) {
          ev.preventDefault();
          ev.stopPropagation();
        }
        return;
      }
      openShell();
    });
    var syncDismiss = root.querySelector('[data-ca="sync-dismiss"]');
    if (syncDismiss) {
      syncDismiss.addEventListener("click", function () {
        hideSyncBanner();
        setStatus("Ready");
      });
    }
    root.querySelector('[data-ca="close"]').addEventListener("click", closeShell);
    root.querySelector('[data-ca="new"]').addEventListener("click", function () {
      newChat().catch(function (e) {
        setStatus(e.message);
      });
    });
    els.tabChat.addEventListener("click", function () {
      setTab("chat");
    });
    els.tabViewer.addEventListener("click", function () {
      setTab("viewer");
    });
    root.querySelector('[data-ca="view-desktop"]').addEventListener("click", function () {
      state.viewerMode = "desktop";
      refreshViewer(false);
    });
    root.querySelector('[data-ca="view-mobile"]').addEventListener("click", function () {
      state.viewerMode = "mobile";
      refreshViewer(false);
    });
    root.querySelector('[data-ca="view-reload"]').addEventListener("click", function () {
      refreshViewer(true);
    });
    els.modelSelect.addEventListener("change", function () {
      var next = els.modelSelect.value;
      if (next !== state.modelId && state.chatId) {
        setStatus("Model change starts a new chat");
        state.modelId = next;
        newChat().catch(function (e) {
          setStatus(e.message);
        });
      } else {
        state.modelId = next;
      }
    });
    els.modeSelect.addEventListener("change", function () {
      state.mode = els.modeSelect.value || "agent";
    });
    els.sendBtn.addEventListener("click", function () {
      sendPrompt();
    });
    els.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendPrompt();
      }
    });
    els.micBtn.addEventListener("click", toggleVoice);
    els.functionsBtn.addEventListener("click", function () {
      state.functionsOpen = !state.functionsOpen;
      state.attachOpen = false;
      if (els.attachMenu) els.attachMenu.classList.remove("is-open");
      els.functionsMenu.classList.toggle("is-open", state.functionsOpen);
      syncFunctionsUi();
    });
    els.optScreenshot.addEventListener("change", function () {
      state.optScreenshot = !!els.optScreenshot.checked;
      syncFunctionsUi();
    });
    els.optConsole.addEventListener("change", function () {
      state.optConsole = !!els.optConsole.checked;
      syncFunctionsUi();
    });
    root.querySelector('[data-ca="attach"]').addEventListener("click", function () {
      state.attachOpen = !state.attachOpen;
      state.functionsOpen = false;
      if (els.functionsMenu) els.functionsMenu.classList.remove("is-open");
      els.attachMenu.classList.toggle("is-open", state.attachOpen);
      syncFunctionsUi();
    });
    root.querySelector('[data-ca="cap-full"]').addEventListener("click", function () {
      state.attachOpen = false;
      els.attachMenu.classList.remove("is-open");
      captureViewport();
    });
    root.querySelector('[data-ca="cap-rect"]').addEventListener("click", function () {
      state.attachOpen = false;
      els.attachMenu.classList.remove("is-open");
      captureDisplay(true);
    });
    root.querySelector('[data-ca="cap-file"]').addEventListener("click", function () {
      state.attachOpen = false;
      els.attachMenu.classList.remove("is-open");
      els.file.click();
    });
    root.querySelector('[data-ca="cap-paste-hint"]').addEventListener("click", function () {
      state.attachOpen = false;
      els.attachMenu.classList.remove("is-open");
      setStatus("Paste an image with Ctrl+V / ⌘V");
    });
    els.file.addEventListener("change", function () {
      var f = els.file.files && els.file.files[0];
      if (f) handleUploadFile(f);
      els.file.value = "";
    });
    document.addEventListener("paste", function (e) {
      handlePaste(e);
    });
  }

  async function openShell() {
    state.open = true;
    els.root.hidden = false;
    updateContextChip();
    setTab("chat");
    try {
      await loadModels();
      await loadChats();
      if (!state.chatId) await newChat();
      else await openChat(state.chatId);
      setStatus(CFG.cursorConfigured === false ? "CURSOR_API_KEY not set on worker" : "Ready");
    } catch (e) {
      setStatus(e.message || "Failed to load");
    }
  }

  function closeShell() {
    state.open = false;
    els.root.hidden = true;
    state.attachOpen = false;
    state.functionsOpen = false;
    if (els.attachMenu) els.attachMenu.classList.remove("is-open");
    if (els.functionsMenu) els.functionsMenu.classList.remove("is-open");
    syncFunctionsUi();
  }

  async function tryBootOnce() {
    await resolveActorId();
    try {
      var me = await api("admin-cursor-me");
      if (!me.admin) return false;
      state.admin = true;
      if (me.actor_id) state.actorId = String(me.actor_id);
      CFG.cursorConfigured = me.cursor_configured;
      if (!els.fab) {
        ensureCss();
        buildDom();
      }
      els.fab.hidden = false;
      try {
        bindFloatingIcon(els.fab, "agent_fab");
      } catch (bindErr) {}
      updateContextChip();
      return true;
    } catch (e) {
      return false;
    }
  }

  async function boot() {
    ensureCss();
    var ok = await tryBootOnce();
    if (ok) return;
    /* Creator hub may set __EAZ_OWNER_ID after auth — retry a few times */
    var tries = 0;
    var timer = setInterval(async function () {
      tries += 1;
      if (global.__EAZ_OWNER_ID && !CFG.customerId) {
        CFG.customerId = String(global.__EAZ_OWNER_ID);
      }
      var done = await tryBootOnce();
      if (done || tries >= 8) clearInterval(timer);
    }, 1500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  global.EazAdminCursorAgent = { boot: boot, open: openShell, close: closeShell };
})(typeof window !== "undefined" ? window : globalThis);
