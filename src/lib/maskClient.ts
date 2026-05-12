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
// Callers should await this once and then apply the returned function synchronously.
export async function getClientNameMasker(): Promise<NameMasker> {
  const blinded = await isBlindedViewer();
  return blinded ? maskName : identity;
}
