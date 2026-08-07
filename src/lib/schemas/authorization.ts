import { z } from "zod";

// Bound authorization dates so a mistyped year ("20226") is caught here with a
// clear message rather than failing opaquely at the database layer.
const MIN_AUTH_DATE = new Date("2000-01-01");
function yearsFromNow(n: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() + n);
  return d;
}

const AuthorizationBaseSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  authNumber: z.string().nullable().optional(),
  serviceCode: z.string().nullable().optional(), // CPT code; null = covers all billable services
  fundingSource: z.string().nullable().optional(),
  approvedHoursPerWeek: z.number().positive("Approved hours must be greater than 0"),
  startDate: z.coerce
    .date({ required_error: "Start date is required", invalid_type_error: "Start date is not a valid date" })
    .min(MIN_AUTH_DATE, "Start date looks wrong — check the year (must be 2000 or later)")
    .max(yearsFromNow(10), "Start date is too far in the future — check the year"),
  endDate: z.coerce
    .date({ required_error: "End date is required", invalid_type_error: "End date is not a valid date" })
    .min(MIN_AUTH_DATE, "End date looks wrong — check the year (must be 2000 or later)")
    .max(yearsFromNow(10), "End date is too far in the future — check the year"),
  notes: z.string().nullable().optional(),
});

export const AuthorizationSchema = AuthorizationBaseSchema.refine(
  (data) => data.endDate > data.startDate,
  { message: "End date must be after start date", path: ["endDate"] }
);

export const UpdateAuthorizationSchema = AuthorizationBaseSchema
  .omit({ clientId: true })
  .partial()
  .refine(
    (data) =>
      !data.startDate || !data.endDate || data.endDate > data.startDate,
    { message: "End date must be after start date", path: ["endDate"] }
  );

export type AuthorizationInput = z.infer<typeof AuthorizationSchema>;
export type UpdateAuthorizationInput = z.infer<typeof UpdateAuthorizationSchema>;
