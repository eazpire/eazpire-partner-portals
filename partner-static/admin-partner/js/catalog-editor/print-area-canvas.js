import { savePrintAreaRect } from "./api.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function mountPrintAreaCanvas(root, ctx, options = {}) {
  const el = root.querySelector("#ce-print-area-canvas");
  if (!el) return { destroy() {} };

  const productKey = options.productKey || ctx.productKey;
  const printAreaKey = options.printAreaKey || "front";
  const imageUrl = options.imageUrl || "";
  const rect0 = options.rect || { x: 0.2, y: 0.2, w: 0.45, h: 0.45 };
  const mockupRect0 = options.mockupRect || null;
  const universalRect0 = options.universalRect || null;
  const placement0 = options.placement || null;

  el.innerHTML = `
    <div class="ce-pac-wrap">
      <div class="ce-pac-stage">
        <img id="ce-pac-image" class="ce-pac-image" alt="Mockup" ${imageUrl ? `src="${imageUrl}"` : ""}>
        <div id="ce-pac-rect" class="ce-pac-rect"></div>
      </div>
      <div class="ce-pac-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="ce-pac-reset">Reset</button>
        <button type="button" class="btn btn-primary btn-sm" id="ce-pac-save">Save rect</button>
      </div>
    </div>`;

  const stage = el.querySelector(".ce-pac-stage");
  const rectEl = el.querySelector("#ce-pac-rect");
  const resetBtn = el.querySelector("#ce-pac-reset");
  const saveBtn = el.querySelector("#ce-pac-save");

  let rect = { ...rect0 };
  let drag = null;

  const draw = () => {
    rectEl.style.left = `${rect.x * 100}%`;
    rectEl.style.top = `${rect.y * 100}%`;
    rectEl.style.width = `${rect.w * 100}%`;
    rectEl.style.height = `${rect.h * 100}%`;
  };

  draw();

  const onMouseDown = (ev) => {
    const box = stage.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const sx = (ev.clientX - box.left) / box.width;
    const sy = (ev.clientY - box.top) / box.height;
    const inRect = sx >= rect.x && sx <= rect.x + rect.w && sy >= rect.y && sy <= rect.y + rect.h;
    drag = { type: inRect ? "move" : "draw", sx, sy, rect: { ...rect } };
    if (drag.type === "draw") {
      rect = { x: sx, y: sy, w: 0.01, h: 0.01 };
      draw();
    }
    ev.preventDefault();
  };

  const onMouseMove = (ev) => {
    if (!drag) return;
    const box = stage.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const x = clamp((ev.clientX - box.left) / box.width, 0, 1);
    const y = clamp((ev.clientY - box.top) / box.height, 0, 1);

    if (drag.type === "move") {
      const dx = x - drag.sx;
      const dy = y - drag.sy;
      rect.x = clamp(drag.rect.x + dx, 0, 1 - rect.w);
      rect.y = clamp(drag.rect.y + dy, 0, 1 - rect.h);
    } else {
      const x1 = Math.min(drag.sx, x);
      const y1 = Math.min(drag.sy, y);
      const x2 = Math.max(drag.sx, x);
      const y2 = Math.max(drag.sy, y);
      rect.x = x1;
      rect.y = y1;
      rect.w = clamp(x2 - x1, 0.02, 1);
      rect.h = clamp(y2 - y1, 0.02, 1);
    }
    draw();
  };

  const onMouseUp = () => {
    drag = null;
  };

  stage.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);

  resetBtn?.addEventListener("click", () => {
    rect = { ...rect0 };
    draw();
  });

  saveBtn?.addEventListener("click", async () => {
    saveBtn.disabled = true;
    try {
      await savePrintAreaRect({
        product_key: productKey,
        print_area_key: printAreaKey,
        print_area_rect: rect,
        mockup_rect: mockupRect0 || rect,
        universal_rect: universalRect0 || rect,
        placement:
          placement0 || {
            x: Number((rect.x + rect.w / 2).toFixed(4)),
            y: Number((rect.y + rect.h / 2).toFixed(4)),
            scale: Number(Math.max(rect.w, rect.h).toFixed(4)),
          },
        auto_mirror: false,
      });
    } finally {
      saveBtn.disabled = false;
    }
  });

  return {
    getRect: () => ({ ...rect }),
    destroy() {
      stage.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    },
  };
}
