// Shared auth helper for server actions.
// All mutation actions should call requireUser() as their first line so that
// the action layer enforces authentication independently of route-level checks.
// (Server actions are callable via direct fetch; the page-level Supabase guard
// in /app/(dashboard)/layout.tsx alone is not sufficient.)

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// Deduplicated per-request user lookup.
//
// requireUser(), isBlindedViewer() and the dashboard layout each used to call
// supabase.auth.getUser() independently, so a single page render made the same
// auth round trip two or three times. React's cache() memoises it for the
// lifetime of one request only: same user, same answer, fewer network calls.
// It is NOT a time-based cache — nothing is reused across requests, so this
// cannot serve a stale identity.
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});

export async function requireUser():
  Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };
  return { ok: true, userId: user.id };
}

// Reviewer accounts that see masked client names instead of real ones.
// Used to satisfy Zoom Marketplace review while production client data is loaded.
export const BLINDED_VIEWER_EMAILS = ["zoom.reviewer@alltogetherautism.com"];

export async function isBlindedViewer(): Promise<boolean> {
  try {
    const user = await getCurrentUser();
    if (!user?.email) return false;
    return BLINDED_VIEWER_EMAILS.includes(user.email.toLowerCase());
  } catch {
    return false;
  }
}
