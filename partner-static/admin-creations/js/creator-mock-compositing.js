/**
 * Shared mock + design compositing math (Design Studio viewer + catalog product cards).
 * Keeps contain-fit seed scale, zone fractions, and stage sizing in sync.
 */
(function (global) {
  'use strict';

  var DEFAULT_TRANSFORM = { x: 0.5, y: 0.5, scale: 0.95, rotate: 0, flipX: false, flipY: false };
  var UI_SCALE_MAX = 4;

  function parseZoneFrac(f) {
    var def = { l: 0.28, t: 0.22, w: 0.44, h: 0.48 };
    if (!f || typeof f !== 'object') return def;
    var l = Number(f.l != null ? f.l : f.left != null ? f.left : f.x);
    var t = Number(f.t != null ? f.t : f.top != null ? f.top : f.y);
    var w = Number(f.w != null ? f.w : f.width);
    var h = Number(f.h != null ? f.h : f.height);
    if (
      ![l, t, w, h].every(function (x) {
        return Number.isFinite(x);
      })
    ) {
      return def;
    }
    return { l: l, t: t, w: w, h: h };
  }

  function clampScale(raw, uiMax) {
    var cap = Number.isFinite(uiMax) && uiMax > 0 ? uiMax : UI_SCALE_MAX;
    var v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) v = DEFAULT_TRANSFORM.scale;
    return Math.min(Math.max(v, 0.08), cap);
  }

  function isDefaultishTransform(tr) {
    if (!tr) return true;
    return (
      Math.abs(Number(tr.x) - 0.5) < 1e-6 &&
      Math.abs(Number(tr.y) - 0.5) < 1e-6 &&
      Math.abs(Number(tr.scale) - 0.95) < 1e-6 &&
      Math.abs(Number(tr.rotate) || 0) < 1e-6 &&
      !tr.flipX &&
      !tr.flipY
    );
  }

  function looksLikeLegacyPlacementScale(scale) {
    var s = Number(scale);
    if (!Number.isFinite(s) || s <= 0) return true;
    return s < 0.7;
  }

  /** Legacy API kept mockup bbox y (e.g. Softstyle ~0.47) while normalizing scale to 0.95. */
  function looksLikeMisMappedLegacyPlacement(tr) {
    if (!tr) return false;
    var scale = Number(tr.scale);
    var x = Number(tr.x);
    var y = Number(tr.y);
    var rot = Number(tr.rotate) || 0;
    if (!Number.isFinite(scale) || scale < 0.7 || scale > 1.0 + 1e-6) return false;
    if (!Number.isFinite(x) || Math.abs(x - 0.5) > 0.02) return false;
    if (Math.abs(rot) > 1e-3) return false;
    if (!Number.isFinite(y)) return false;
    var dy = Math.abs(y - 0.5);
    return dy > 0.01 && dy < 0.15;
  }

  /** Match Design Studio open seed: contain-clamp only for admin/default transforms, not custom work. */
  function shouldContainClampPlacement(tr) {
    if (!tr) return true;
    if (isDefaultishTransform(tr)) return true;
    if (looksLikeMisMappedLegacyPlacement(tr)) return true;
    if (looksLikeLegacyPlacementScale(tr.scale)) return true;
    var scale = Number(tr.scale);
    var x = Number(tr.x);
    var y = Number(tr.y);
    var rot = Number(tr.rotate) || 0;
    if (Math.abs(Number(x) - 0.5) > 0.02) return false;
    if (Math.abs(Number(y) - 0.5) > 0.02) return false;
    if (Math.abs(rot) > 1e-3) return false;
    if (tr.flipX || tr.flipY) return false;
    if (!Number.isFinite(scale) || scale <= 0) return true;
    if (Math.abs(scale - 0.95) < 0.02) return true;
    return false;
  }

  /** Center + UI scale before contain clamp (Shop / Studio open parity). */
  function normalizeOpenSeedPlacement(tr) {
    var out = {
      x: Number(tr && tr.x),
      y: Number(tr && tr.y),
      scale: Number(tr && tr.scale),
      rotate: Number(tr && tr.rotate != null ? tr.rotate : tr && tr.angle),
      flipX: !!(tr && tr.flipX),
      flipY: !!(tr && tr.flipY),
    };
    if (!Number.isFinite(out.x)) out.x = DEFAULT_TRANSFORM.x;
    if (!Number.isFinite(out.y)) out.y = DEFAULT_TRANSFORM.y;
    if (!Number.isFinite(out.scale) || out.scale <= 0) out.scale = DEFAULT_TRANSFORM.scale;
    if (!Number.isFinite(out.rotate)) out.rotate = 0;

    if (
      looksLikeMisMappedLegacyPlacement(out) ||
      looksLikeLegacyPlacementScale(out.scale) ||
      isDefaultishTransform(out)
    ) {
      out.x = DEFAULT_TRANSFORM.x;
      out.y = DEFAULT_TRANSFORM.y;
      out.scale = DEFAULT_TRANSFORM.scale;
      out.rotate = 0;
      out.flipX = false;
      out.flipY = false;
    }
    return out;
  }

  function maxContainScaleInZone(zoneW, zoneH, designW, designH, uiMax) {
    var zw = Number(zoneW);
    var zh = Number(zoneH);
    var nw = Number(designW);
    var nh = Number(designH);
    var cap = Number.isFinite(uiMax) && uiMax > 0 ? uiMax : UI_SCALE_MAX;
    if (!(nw > 0 && nh > 0 && zw > 0 && zh > 0)) return cap;
    return Math.min(1, (zh * nw) / (zw * nh), cap);
  }

  function resolveVisualScale(tr, zoneW, zoneH, designW, designH, opts) {
    opts = opts || {};
    var uiMax = opts.uiScaleMax || UI_SCALE_MAX;
    var displayTr = normalizeOpenSeedPlacement(tr);
    var base = clampScale(displayTr.scale, uiMax);
    if (!shouldContainClampPlacement(tr)) return base;
    var maxContain = maxContainScaleInZone(zoneW, zoneH, designW, designH, uiMax);
    if (!(maxContain > 0) || !Number.isFinite(maxContain)) return base;
    return Math.round(Math.min(base, maxContain) * 100) / 100;
  }

  function fitMockStage(stageEl, mockImg, frameEl) {
    if (!stageEl || !mockImg || !frameEl) return false;
    var nw = mockImg.naturalWidth;
    var nh = mockImg.naturalHeight;
    if (!nw || !nh) return false;
    var boxW = Math.max(1, frameEl.clientWidth);
    var boxH = Math.max(1, frameEl.clientHeight);
    if (boxW < 4 || boxH < 4) return false;
    var fit = Math.min(boxW / nw, boxH / nh);
    var w = Math.max(1, nw * fit);
    var h = Math.max(1, nh * fit);
    stageEl.style.width = w + 'px';
    stageEl.style.height = h + 'px';
    stageEl.style.aspectRatio = 'auto';
    mockImg.style.width = '100%';
    mockImg.style.height = '100%';
    mockImg.style.objectFit = 'fill';
    return true;
  }

  function applyDesignTransformInZone(designEl, zoneEl, tr, opts) {
    if (!designEl || !zoneEl) return;
    opts = opts || {};
    var uiMax = opts.uiScaleMax || UI_SCALE_MAX;
    var minWidth = typeof opts.minDesignWidth === 'number' ? opts.minDesignWidth : 8;
    var displayTr = normalizeOpenSeedPlacement(tr);
    var x = displayTr.x;
    var y = displayTr.y;
    var rot = displayTr.rotate;
    var zoneW = zoneEl.offsetWidth || 1;
    var zoneH = zoneEl.offsetHeight || 1;
    var designW = designEl.naturalWidth || 0;
    var designH = designEl.naturalHeight || 0;
    var visualScale = resolveVisualScale(tr, zoneW, zoneH, designW, designH, { uiScaleMax: uiMax });
    var flipSx = displayTr.flipX ? -1 : 1;
    var flipSy = displayTr.flipY ? -1 : 1;

    designEl.style.width = Math.max(minWidth, zoneW * visualScale) + 'px';
    designEl.style.height = 'auto';
    designEl.style.maxWidth = 'none';
    designEl.style.maxHeight = 'none';
    designEl.style.left = '50%';
    designEl.style.top = '50%';
    var dx = (x - 0.5) * zoneW;
    var dy = (y - 0.5) * zoneH;
    designEl.style.transform =
      'translate(-50%, -50%) translate(' +
      dx +
      'px,' +
      dy +
      'px) rotate(' +
      rot +
      'deg) scale(' +
      flipSx +
      ',' +
      flipSy +
      ')';
    designEl.classList.add('is-laid-out');
  }

  global.CreatorMockCompositing = {
    DEFAULT_TRANSFORM: DEFAULT_TRANSFORM,
    UI_SCALE_MAX: UI_SCALE_MAX,
    parseZoneFrac: parseZoneFrac,
    clampScale: clampScale,
    isDefaultishTransform: isDefaultishTransform,
    looksLikeLegacyPlacementScale: looksLikeLegacyPlacementScale,
    looksLikeMisMappedLegacyPlacement: looksLikeMisMappedLegacyPlacement,
    shouldContainClampPlacement: shouldContainClampPlacement,
    normalizeOpenSeedPlacement: normalizeOpenSeedPlacement,
    maxContainScaleInZone: maxContainScaleInZone,
    resolveVisualScale: resolveVisualScale,
    fitMockStage: fitMockStage,
    applyDesignTransformInZone: applyDesignTransformInZone,
  };
})(typeof window !== 'undefined' ? window : globalThis);
