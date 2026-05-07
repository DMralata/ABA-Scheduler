import { z } from "zod";

const ProviderBaseSchema = z.object({
  externalId: z.string().min(1, "External ID is required"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  position: z.enum(["BCBA", "BCaBA", "RBT"]),
  rbtLevel: z.enum(["I", "II", "III"]).nullable().optional(),
  gender: z.string().min(1, "Gender is required"),
  spanish: z.boolean().default(false),
  centerId: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  zip: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  payRateHourly: z.number().positive().nullable().optional(),
  zoomUserId: z.string().nullable().optional(),
});

export const ProviderSchema = ProviderBaseSchema.refine(
  (data) => data.position !== "RBT" || data.rbtLevel != null,
  { message: "RBT level is required for RBT providers", path: ["rbtLevel"] }
);

export const UpdateProviderSchema = ProviderBaseSchema
  .omit({ externalId: true })
  .partial()
  .refine(
    (data) => !data.position || data.position !== "RBT" || data.rbtLevel != null,
    { message: "RBT level is required for RBT providers", path: ["rbtLevel"] }
  );

export type ProviderInput = z.infer<typeof ProviderSchema>;
export type UpdateProviderInput = z.infer<typeof UpdateProviderSchema>;
