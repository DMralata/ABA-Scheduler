import { z } from "zod";

// ─── Sane calendar bounds ────────────────────────────────────────────────────
// A mistyped year ("20226" instead of "2026") used to sail through validation
// and only blow up at the database layer, where it surfaced as a generic
// "Something went wrong" with no clue what was wrong. Bound the dates so a typo
// is caught here with a message that names the field.

const MIN_DOB = new Date("1950-01-01");
const MIN_SERVICE_DATE = new Date("2000-01-01");
function yearsFromNow(n: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() + n);
  return d;
}

const dateOfBirthField = z.coerce
  .date({ required_error: "Date of birth is required", invalid_type_error: "Date of birth is not a valid date" })
  .min(MIN_DOB, "Date of birth looks wrong — check the year (must be 1950 or later)")
  .max(new Date(), "Date of birth can't be in the future — check the year");

const activeDateField = z.coerce
  .date({ required_error: "Active date is required", invalid_type_error: "Active date is not a valid date" })
  .min(MIN_SERVICE_DATE, "Active date looks wrong — check the year (must be 2000 or later)")
  .max(yearsFromNow(5), "Active date is too far in the future — check the year (a 4-digit year like 2026)");

const terminationDateField = z.coerce
  .date({ invalid_type_error: "Termination date is not a valid date" })
  .min(MIN_SERVICE_DATE, "Termination date looks wrong — check the year (must be 2000 or later)")
  .max(yearsFromNow(5), "Termination date is too far in the future — check the year (a 4-digit year like 2026)")
  .nullable()
  .optional();

const ClientBaseSchema = z.object({
  externalId: z.string().min(1, "External ID is required"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  dateOfBirth: dateOfBirthField,
  gender: z.string().min(1, "Gender is required"),
  spanish: z.boolean().default(false),
  minimumRbtLevel: z.enum(["I", "II", "III"]).nullable().optional(),
  femaleProviderOnly: z.boolean().default(false),
  centerId: z.string().nullable().optional(),
  activeDate: activeDateField,
  terminationDate: terminationDateField,
  street: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  zip: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  insurance: z.string().min(1, "Insurance is required"),
  defaultSessionHours: z.number().min(2).max(8).nullable().optional(),
  preferredLocation: z.enum(["HOME", "CENTER", "HYBRID", "SCHOOL"]).optional(),
});

export const ClientSchema = ClientBaseSchema.refine(
  (data) => !data.terminationDate || data.terminationDate > data.activeDate,
  { message: "Termination date must be after active date", path: ["terminationDate"] }
);

export const UpdateClientSchema = ClientBaseSchema
  .omit({ externalId: true })
  .partial()
  .refine(
    (data) => !data.terminationDate || !data.activeDate || data.terminationDate > data.activeDate,
    { message: "Termination date must be after active date", path: ["terminationDate"] }
  );

export type ClientInput = z.infer<typeof ClientSchema>;
export type UpdateClientInput = z.infer<typeof UpdateClientSchema>;
