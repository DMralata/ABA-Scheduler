import { cache } from "react";
import { isBlindedViewer } from "@/lib/auth";

// Mask format: first 3 chars + asterisks padded to length 5.
// "Jonathan" -> "Jon**", "Al" -> "Al***", "Bob" -> "Bob**", "" -> "".
export function maskName(s: string | null | undefined): string {
  if (s == null || s === "") return s ?? "";
  return (s.slice(0, 3) + "**").slice(0, 5).padEnd(5, "*");
}

const identity = (s: string | null | undefined): string => s ?? "";

export type NameMasker = (s: string | null | undefined) => string;

// Resolves once per request whether the current viewer is blinded.
// React `cache` dedupes the underlying Supabase auth call across all query
// callers within the same request, so we don't pay a network round-trip per query.
export const getClientNameMasker = cache(async (): Promise<NameMasker> => {
  const blinded = await isBlindedViewer();
  return blinded ? maskName : identity;
});
