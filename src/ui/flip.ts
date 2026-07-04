// FLIP (First-Last-Invert-Play) reorder animation.
// Call `captureFlip(container)` BEFORE a reorder re-render, then
// `playFlip(container, snapshot)` after (in a layout effect / rAF): children
// glide to their new positions using transform only.

const FLIP_MS = 200;
const FLIP_EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

export type FlipSnapshot = Map<string, DOMRect>;

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function captureFlip(container: HTMLElement | null): FlipSnapshot {
  const snap: FlipSnapshot = new Map();
  if (!container || reducedMotion()) return snap;
  for (const el of container.querySelectorAll<HTMLElement>("[data-flip-key]")) {
    snap.set(el.dataset.flipKey!, el.getBoundingClientRect());
  }
  return snap;
}

export function playFlip(container: HTMLElement | null, first: FlipSnapshot) {
  if (!container || first.size === 0 || reducedMotion()) return;
  for (const el of container.querySelectorAll<HTMLElement>("[data-flip-key]")) {
    const prev = first.get(el.dataset.flipKey!);
    if (!prev) continue;
    const now = el.getBoundingClientRect();
    const dx = prev.left - now.left;
    const dy = prev.top - now.top;
    if (dx === 0 && dy === 0) continue;
    el.classList.add("flip-moving");
    el.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      { duration: FLIP_MS, easing: FLIP_EASE },
    ).onfinish = () => el.classList.remove("flip-moving");
  }
}
