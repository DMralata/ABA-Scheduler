// ─── Post-save navigation ────────────────────────────────────────────────────
// Use this instead of router.push() + router.refresh() after a successful
// create/update.
//
// Why: Next.js client-side navigation fetches the destination as an RSC payload
// (`?_rsc=...`). On a cold serverless function that request can come back 503.
// When it does, router.push() resolves without navigating and without throwing,
// so a form's `isPending` never clears — the button sits on "Saving…" forever
// even though the record was created. A document navigation always lands, and
// it also guarantees the destination renders fresh data (no router cache).
//
// Trade-off: a full page load is marginally slower than a soft navigation. That
// is the right trade for the handful of times a save completes per session.

export function navigateAfterSave(url: string): void {
  window.location.assign(url);
}

// Wraps a save handler so a button can never hang indefinitely. If navigation
// hasn't taken the user off the page within `ms`, `onStuck` runs so the UI can
// re-enable the button and explain what happened.
export function guardAgainstStuckSave(
  onStuck: () => void,
  ms = 8000
): { clear: () => void } {
  const timer = window.setTimeout(onStuck, ms);
  return { clear: () => window.clearTimeout(timer) };
}
