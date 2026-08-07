// ─── Location type labels ────────────────────────────────────────────────────
// Single source of truth for rendering a LocationType.
//
// Several places used `loc === "HOME" ? "Home" : "Center"`, which silently
// mislabelled HYBRID, SCHOOL and DAYCARE clients as "Center". Use these helpers
// so adding a location type to the schema can't leave a screen quietly wrong.

export const LOCATION_LABELS: Record<string, string> = {
  HOME: "Home",
  CENTER: "Center",
  HYBRID: "Home + Center",
  SCHOOL: "School",
  DAYCARE: "Daycare",
};

/**
 * Human label for a LocationType. Falls back to the raw value (rather than a
 * plausible-but-wrong default) so an unmapped type is visible, not disguised.
 */
export function locationLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return LOCATION_LABELS[value] ?? value;
}
