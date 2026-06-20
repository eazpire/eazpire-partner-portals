/** Full-screen image viewer for catalog mockups (studio list + editor mockups tab). */

let mockViewerState = null;
let keyListenerBound = false;

function normalizeItems(items) {
  return (items || [])
    .map((item) => {
      if (typeof item === "string") {
        const url = item.trim();
        return url ? { url, label: "" } : null;
      }
      if (item && typeof item.url === "string" && item.url.trim()) {
        return { url: item.url.trim(), label: String(item.label || "").trim() };
      }
      return null;
    })
    .filter(Boolean);
}

function ensureMockViewer() {
  let el = document.getElementById("cs-mock-viewer");
  if (el) return el;
  el = document.createElement("div");
  el.id = "cs-mock-viewer";
  el.className = "cs-mock-viewer";
  el.hidden = true;
  el.innerHTML = `<div class="cs-mock-viewer__backdrop" data-close="1"></div>
    <div class="cs-mock-viewer__panel" role="dialog" aria-modal="true" aria-label="Mockup viewer">
      <button type="button" class="cs-mock-viewer__close" aria-label="Close">&times;</button>
      <button type="button" class="cs-mock-viewer__arrow cs-mock-viewer__arrow--prev" aria-label="Previous">&#8249;</button>
      <div class="cs-mock-viewer__stage">
        <img src="" alt="" />
        <div class="cs-mock-viewer__caption" hidden></div>
      </div>
      <button type="button" class="cs-mock-viewer__arrow cs-mock-viewer__arrow--next" aria-label="Next">&#8250;</button>
      <div class="cs-mock-viewer__counter"></div>
    </div>`;
  document.body.appendChild(el);

  const close = () => closeMockViewer();
  el.querySelector(".cs-mock-viewer__close").onclick = close;
  el.querySelector(".cs-mock-viewer__backdrop").onclick = close;
  el.querySelector(".cs-mock-viewer__arrow--prev").onclick = () => stepMockViewer(-1);
  el.querySelector(".cs-mock-viewer__arrow--next").onclick = () => stepMockViewer(1);

  if (!keyListenerBound) {
    keyListenerBound = true;
    document.addEventListener("keydown", (e) => {
      if (!mockViewerState) return;
      if (e.key === "Escape") closeMockViewer();
      if (e.key === "ArrowLeft") stepMockViewer(-1);
      if (e.key === "ArrowRight") stepMockViewer(1);
    });
  }

  return el;
}

function renderMockViewer() {
  if (!mockViewerState) return;
  const viewer = ensureMockViewer();
  const { items, index } = mockViewerState;
  const current = items[index] || items[0];
  const img = viewer.querySelector(".cs-mock-viewer__stage img");
  const caption = viewer.querySelector(".cs-mock-viewer__caption");
  const counter = viewer.querySelector(".cs-mock-viewer__counter");
  img.src = current?.url || "";
  img.alt = current?.label || "Mockup";
  if (caption) {
    const text = current?.label || "";
    caption.textContent = text;
    caption.hidden = !text;
  }
  counter.textContent = items.length > 1 ? `${index + 1} / ${items.length}` : "";
  viewer.querySelector(".cs-mock-viewer__arrow--prev").style.display = items.length > 1 ? "" : "none";
  viewer.querySelector(".cs-mock-viewer__arrow--next").style.display = items.length > 1 ? "" : "none";
}

/** @param {Array<string|{url:string,label?:string}>} items */
export function openMockViewer(items, startIndex = 0) {
  const normalized = normalizeItems(items);
  if (!normalized.length) return;
  mockViewerState = {
    items: normalized,
    index: Math.max(0, Math.min(startIndex, normalized.length - 1)),
  };
  const viewer = ensureMockViewer();
  viewer.hidden = false;
  viewer.classList.add("is-open");
  renderMockViewer();
}

export function closeMockViewer() {
  mockViewerState = null;
  const viewer = document.getElementById("cs-mock-viewer");
  if (viewer) {
    viewer.classList.remove("is-open");
    viewer.hidden = true;
  }
}

function stepMockViewer(delta) {
  if (!mockViewerState) return;
  const { items, index } = mockViewerState;
  mockViewerState.index = (index + delta + items.length) % items.length;
  renderMockViewer();
}
