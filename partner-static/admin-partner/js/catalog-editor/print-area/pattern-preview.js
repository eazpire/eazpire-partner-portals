/** Pattern tile preview rects (ported from theme/assets/admin-print-area-panel.js). */

export function getPatternPreviewRects(baseRect, patternCfg, clipRect) {
  const cfg = {
    enabled: false,
    style: "grid",
    spacingH: 0,
    spacingV: 0,
    angle: 0,
    offsetH: 0,
    rotH: 0,
    rotV: 0,
    ...(patternCfg || {}),
  };
  const rects = [{ rect: { ...baseRect }, isMain: true, i: 0, j: 0 }];
  if (!cfg.enabled) return rects;

  let style = cfg.style || "grid";
  if (style === "brick") style = "brick-horizontal";

  const stepX = Math.max(0.001, baseRect.w * (1 + Math.max(0, Number(cfg.spacingH) || 0) / 100));
  const stepY = Math.max(0.001, baseRect.h * (1 + Math.max(0, Number(cfg.spacingV) || 0) / 100));
  const shiftFactor = (Number(cfg.offsetH) || 0) / 100;
  const shiftX = style === "brick-horizontal" ? stepX * (0.5 + shiftFactor) : 0;
  const shiftY = style === "brick-vertical" ? stepY * (0.5 + shiftFactor) : 0;

  const padX = baseRect.w * 2;
  const padY = baseRect.h * 2;
  const maxI = Math.min(18, Math.ceil((1 + padX * 2) / stepX) + 1);
  const maxJ = Math.min(18, Math.ceil((1 + padY * 2) / stepY) + 1);

  for (let j = -maxJ; j <= maxJ; j++) {
    for (let i = -maxI; i <= maxI; i++) {
      if (i === 0 && j === 0) continue;
      let x = baseRect.x + i * stepX;
      let y = baseRect.y + j * stepY;

      if (style === "brick-horizontal" && Math.abs(j % 2) === 1) x += shiftX;
      else if (style === "brick-vertical" && Math.abs(i % 2) === 1) y += shiftY;

      if (x + baseRect.w < -padX || x > 1 + padX || y + baseRect.h < -padY || y > 1 + padY) continue;
      if (clipRect) {
        const noOverlap =
          x + baseRect.w < clipRect.x ||
          x > clipRect.x + clipRect.w ||
          y + baseRect.h < clipRect.y ||
          y > clipRect.y + clipRect.h;
        if (noOverlap) continue;
      }

      rects.push({
        rect: {
          x,
          y,
          w: baseRect.w,
          h: baseRect.h,
          angle: (baseRect.angle || 0) + (Number(cfg.angle) || 0) + i * (Number(cfg.rotH) || 0) + j * (Number(cfg.rotV) || 0),
        },
        isMain: false,
        i,
        j,
      });
    }
  }
  return rects;
}

export function renderPatternOverlayHtml(st) {
  if (!st.patternConfig?.enabled) return "";
  const tiles = getPatternPreviewRects(st.greenRect, st.patternConfig, st.redRect);
  return tiles
    .map((item) => {
      const r = item.rect;
      const cls = item.isMain ? "ce-pa-pattern-tile ce-pa-pattern-tile--main" : "ce-pa-pattern-tile";
      return `<div class="${cls}" style="left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%;transform:rotate(${r.angle || 0}deg)"></div>`;
    })
    .join("");
}
