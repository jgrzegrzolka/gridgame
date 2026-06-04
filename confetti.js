/**
 * Confetti burst for win moments. Pure DOM + CSS — the keyframes live in
 * common.css and read per-particle CSS custom properties for randomized
 * drift, rotation, color, and duration.
 *
 * No-op when the user prefers reduced motion: a win celebration that
 * vibrates the screen is exactly the kind of effect that motion-sensitive
 * users opt out of, and we shouldn't punish them for finishing the game.
 */

const COLORS = [
  '#f44336', '#e91e63', '#9c27b0', '#3f51b5',
  '#03a9f4', '#4caf50', '#ffeb3b', '#ff9800',
];

/**
 * @param {{
 *   doc?: Document,
 *   count?: number,
 *   duration?: number,
 *   rng?: () => number,
 *   prefersReducedMotion?: boolean,
 * }} [options]
 * @returns {{ container: HTMLElement, cancel: () => void } | null}
 */
export function launchConfetti(options = {}) {
  const {
    doc = document,
    count = 240,
    duration = 11000,
    rng = Math.random,
    prefersReducedMotion = detectPrefersReducedMotion(doc),
  } = options;
  if (prefersReducedMotion) return null;

  const container = doc.createElement('div');
  container.className = 'confetti-container';
  container.setAttribute('aria-hidden', 'true');

  for (let i = 0; i < count; i++) {
    const piece = doc.createElement('span');
    piece.className = 'confetti-piece';
    const startLeft = rng() * 100;
    const drift = (rng() - 0.5) * 240;
    const rot = rng() * 720 - 360;
    const dur = 2400 + rng() * 1800;
    const delay = rng() * 6800;
    piece.style.setProperty('--start-left', `${startLeft}vw`);
    piece.style.setProperty('--drift', `${drift}px`);
    piece.style.setProperty('--rot', `${rot}deg`);
    piece.style.setProperty('--dur', `${dur}ms`);
    piece.style.setProperty('--delay', `${delay}ms`);
    piece.style.background = COLORS[i % COLORS.length];
    container.appendChild(piece);
  }

  doc.body.appendChild(container);

  const timer = setTimeout(() => container.remove(), duration);
  return {
    container,
    cancel: () => {
      clearTimeout(timer);
      container.remove();
    },
  };
}

/** @param {Document} doc */
function detectPrefersReducedMotion(doc) {
  const view = doc.defaultView;
  if (!view || typeof view.matchMedia !== 'function') return false;
  return view.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
