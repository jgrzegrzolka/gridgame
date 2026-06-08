/**
 * Confetti + fireworks bursts for win moments. Pure DOM + CSS — the
 * keyframes live in common.css and read per-particle CSS custom
 * properties for randomized drift, rotation, color, and duration.
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
 *   encore?: boolean,
 *   encoreCount?: number,
 *   encoreDelay?: number,
 *   encoreDuration?: number,
 * }} [options]
 * @returns {{ container: HTMLElement, cancel: () => void } | null}
 */
export function launchConfetti(options = {}) {
  const {
    doc = document,
    // Thin main wave + encore. Confetti marks "you found something" — the
    // recognition tier — and must visually rank BELOW fireworks (the
    // big-moment tier). A dense confetti shower competes with fireworks
    // for attention; a sparser one reads as a quiet "nice" instead.
    count = 140,
    duration = 14000,
    rng = Math.random,
    prefersReducedMotion = detectPrefersReducedMotion(doc),
    encore = true,
    encoreCount = 60,
    encoreDelay = 1200,
    encoreDuration = 8000,
  } = options;
  if (prefersReducedMotion) return null;

  const container = buildConfettiContainer(doc, count, rng);
  doc.body.appendChild(container);
  const timer = setTimeout(() => container.remove(), duration);

  /** @type {{ cancel: () => void } | null} */
  let encoreHandle = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let encoreTimer = null;
  if (encore) {
    // The encore wave is a smaller, shorter follow-up that fires while
    // the first wave is still falling — visually reads as "and one
    // more!" without scheduling overlapping containers manually at
    // each call site. `encore: false` on the inner call breaks the
    // recursion so we don't get encores-of-encores.
    encoreTimer = setTimeout(() => {
      encoreHandle = launchConfetti({
        doc,
        count: encoreCount,
        duration: encoreDuration,
        rng,
        encore: false,
      });
    }, encoreDelay);
  }

  return {
    container,
    cancel: () => {
      clearTimeout(timer);
      container.remove();
      if (encoreTimer !== null) clearTimeout(encoreTimer);
      if (encoreHandle) encoreHandle.cancel();
    },
  };
}

/**
 * Radial firework bursts for the "you got everything / new record" moment.
 * Fires several explosions at random screen positions, with each burst
 * radiating particles outward from its center. Fireworks is now the
 * standalone celebration tier — confetti is NOT layered underneath, so
 * the visual has to carry the moment on its own. The spectacle settings
 * (denser particle count, multi-colour rings, bigger spread, central
 * white flash, punchier cadence) reflect that: fireworks needs to feel
 * like the rare event it is.
 *
 * Reduced-motion respects the same gate as confetti.
 *
 * @param {{
 *   doc?: Document,
 *   bursts?: number,
 *   particlesPerBurst?: number,
 *   burstInterval?: number,
 *   particleDuration?: number,
 *   distanceMin?: number,
 *   distanceMax?: number,
 *   rng?: () => number,
 *   prefersReducedMotion?: boolean,
 * }} [options]
 * @returns {{ container: HTMLElement, cancel: () => void } | null}
 */
export function launchFireworks(options = {}) {
  const {
    doc = document,
    // More bursts than the previous pass — fireworks is now the sole
    // visual for the "big moment" tier, so extending the show duration
    // lets the climax breathe instead of ending right as it lands.
    // Particle counts and spread stay the same; longer is the right
    // dial here, not denser.
    bursts = 36,
    particlesPerBurst = 80,
    burstInterval = 450,
    particleDuration = 1900,
    distanceMin = 150,
    distanceMax = 280,
    rng = Math.random,
    prefersReducedMotion = detectPrefersReducedMotion(doc),
  } = options;
  if (prefersReducedMotion) return null;

  const container = doc.createElement('div');
  container.className = 'fireworks-container';
  container.setAttribute('aria-hidden', 'true');
  doc.body.appendChild(container);

  let cancelled = false;
  /** @type {ReturnType<typeof setTimeout>[]} */
  const timers = [];

  for (let b = 0; b < bursts; b++) {
    timers.push(setTimeout(() => {
      if (cancelled) return;
      spawnBurst(doc, container, particlesPerBurst, particleDuration, distanceMin, distanceMax, rng);
    }, b * burstInterval));
  }

  const totalDuration = (bursts - 1) * burstInterval + particleDuration + 400;
  const cleanupTimer = setTimeout(() => container.remove(), totalDuration);
  timers.push(cleanupTimer);

  return {
    container,
    cancel: () => {
      cancelled = true;
      for (const tt of timers) clearTimeout(tt);
      container.remove();
    },
  };
}

/**
 * @param {Document} doc
 * @param {number} count
 * @param {() => number} rng
 */
function buildConfettiContainer(doc, count, rng) {
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
  return container;
}

/**
 * @param {Document} doc
 * @param {HTMLElement} container
 * @param {number} count
 * @param {number} duration
 * @param {number} distanceMin
 * @param {number} distanceMax
 * @param {() => number} rng
 */
function spawnBurst(doc, container, count, duration, distanceMin, distanceMax, rng) {
  // Center the burst in the upper-middle of the viewport so the
  // particles spread outward without clipping the top edge or
  // disappearing below the fold.
  const cx = 20 + rng() * 60; // 20-80vw
  const cy = 20 + rng() * 40; // 20-60vh

  // Central "ignition" flash — quick white circle that scales out and
  // fades. Reads as the explosion's point of origin and lifts the burst
  // from "ring of particles" to "thing that just went off".
  const flash = doc.createElement('span');
  flash.className = 'firework-flash';
  flash.style.setProperty('--cx', `${cx}vw`);
  flash.style.setProperty('--cy', `${cy}vh`);
  container.appendChild(flash);

  // Multi-colour rings — each particle picks its own colour from the
  // palette rather than the whole burst being a single hue. Visually
  // reads as a richer explosion at the same DOM cost.
  const distSpread = Math.max(0, distanceMax - distanceMin);
  for (let i = 0; i < count; i++) {
    const particle = doc.createElement('span');
    particle.className = 'firework-particle';
    // Even angular distribution with a touch of jitter so the ring
    // doesn't look mechanically perfect.
    const angle = (i / count) * 360 + (rng() - 0.5) * (360 / count);
    const distance = distanceMin + rng() * distSpread;
    particle.style.setProperty('--cx', `${cx}vw`);
    particle.style.setProperty('--cy', `${cy}vh`);
    particle.style.setProperty('--angle', `${angle}deg`);
    particle.style.setProperty('--distance', `${distance}px`);
    particle.style.setProperty('--dur', `${duration}ms`);
    particle.style.background = COLORS[Math.floor(rng() * COLORS.length)];
    container.appendChild(particle);
  }
}

/** @param {Document} doc */
function detectPrefersReducedMotion(doc) {
  const view = doc.defaultView;
  if (!view || typeof view.matchMedia !== 'function') return false;
  return view.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
