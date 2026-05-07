import { z } from "zod";

const ClientBaseSchema = z.object({
  externalId: z.string().min(1, "External ID is required"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  dateOfBirth: z.coerce.date({ required_error: "Date of birth is required" }),
  gender: z.string().min(1, "Gender is required"),
  spanish: z.boolean().default(false),
  minimumRbtLevel: z.enum(["I", "II", "III"]).nullable().optional(),
  femaleProviderOnly: z.boolean().default(false),
  centerId: z.string().nullable().optional(),
  activeDate: z.coerce.date({ required_error: "Active date is required" }),
  terminationDate: z.coerce.date().nullable().optional(),
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
