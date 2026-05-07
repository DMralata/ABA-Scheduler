"use server";

// Server actions for user-level preferences.
// Backed by Supabase auth user_metadata — no Prisma User table required.

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type ActionResult =
  | { success: true }
  | { success: false; error: string };

// Curated list of IANA timezones the user can pick from. Empty string = clear
// the override and fall back to the center's timezone.
export const SUPPORTED_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
] as const;

export async function updateUserTimezone(timezone: string | null): Promise<ActionResult> {
  // Validate input: either null/empty (clear override) or a member of the curated list.
  if (timezone && !SUPPORTED_TIMEZONES.includes(timezone as (typeof SUPPORTED_TIMEZONES)[number])) {
    return { success: false, error: "Unsupported timezone." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not signed in." };

  const { error } = await supabase.auth.updateUser({
    data: { timezone: timezone || null },
  });
  if (error) return { success: false, error: error.message };

  revalidatePath("/settings");
  revalidatePath("/schedule");
  return { success: true };
}
