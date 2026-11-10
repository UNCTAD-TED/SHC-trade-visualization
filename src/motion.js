// ─────────────────────────────────────────────────────────────────────────────
// Reduced-motion support for JS animations (CSS side: reduced-motion.css).
// Particles, halo pulses and tweens are dropped; every state change still happens.
// The query is read live, so changing the OS setting applies on the next render.
// ─────────────────────────────────────────────────────────────────────────────

const _mq = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

export function prefersReducedMotion() {
    return !!_mq?.matches;
}

// D3 transition duration: 0 under reduced motion, so end callbacks still fire.
export function motionDuration(ms) {
    return prefersReducedMotion() ? 0 : ms;
}
