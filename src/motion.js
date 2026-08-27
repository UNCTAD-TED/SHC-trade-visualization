// ─────────────────────────────────────────────────────────────────────────────
// Reduced-motion support.
//
// Users who ask their OS to reduce motion still get every state change — the
// year advances, arcs appear and disappear, the camera reaches the same place —
// but without the parts that exist purely as movement:
//
//   • flowing particles along corridors (SVG <animateMotion> / dashed overlays)
//   • pulsing halo rings
//   • the tweens between two states (D3 transitions collapse to 0 ms)
//
// CSS-driven animations are switched off in src/styles/reduced-motion.less;
// this module covers the JavaScript-driven half.
//
// The query is evaluated live rather than cached, so toggling the OS setting
// takes effect on the next render without a page reload.
// ─────────────────────────────────────────────────────────────────────────────

const _mq = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

export function prefersReducedMotion() {
    return !!_mq?.matches;
}

// D3 transition duration. Returns 0 under reduced motion so the transition still
// runs (end-state styles, .remove() callbacks and text tweens all still fire)
// but lands immediately instead of animating.
export function motionDuration(ms) {
    return prefersReducedMotion() ? 0 : ms;
}
