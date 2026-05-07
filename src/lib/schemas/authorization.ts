import { z } from "zod";

const AuthorizationBaseSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  authNumber: z.string().nullable().optional(),
  serviceCode: z.string().nullable().optional(), // CPT code; null = covers all billable services
  fundingSource: z.string().nullable().optional(),
  approvedHoursPerWeek: z.number().positive("Approved hours must be greater than 0"),
  startDate: z.coerce.date({ required_error: "Start date is required" }),
  endDate: z.coerce.date({ required_error: "End date is required" }),
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
