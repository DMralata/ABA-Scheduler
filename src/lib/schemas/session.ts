import { z } from "zod";

export const BookSessionSchema = z.object({
  name: z.string().min(1, "Session name is required"),
  sessionTypeId: z.string().min(1, "Session type is required"),
  providerId: z.string().nullable().optional(),
  clientId: z.string().nullable().optional(),
  authorizationId: z.string().nullable().optional(), // Resolved during validation; can be pre-supplied
  startTime: z.coerce.date({ required_error: "Start time is required" }),
  endTime: z.coerce.date({ required_error: "End time is required" }),
  billable: z.boolean().default(true),
  locationType: z.enum(["HOME", "CENTER", "SCHOOL", "DAYCARE"]).optional(),
  centerId: z.string().nullable().optional(), // Which center (when locationType is CENTER)
  timezone: z.string().optional(), // IANA timezone — falls back to center timezone if omitted
  notes: z.string().nullable().optional(),
}).refine(
  (data) => data.endTime > data.startTime,
  { message: "End time must be after start time", path: ["endTime"] }
).refine(
  (data) => !data.billable || (data.providerId && data.providerId.length > 0),
  { message: "Billable sessions require a provider.", path: ["providerId"] }
).refine(
  (data) => (data.providerId && data.providerId.length > 0) || (data.clientId && data.clientId.length > 0),
  { message: "A session must have at least a provider or a client.", path: ["providerId"] }
);

export const RescheduleSessionSchema = z.object({
  startTime: z.coerce.date({ required_error: "Start time is required" }),
  endTime: z.coerce.date({ required_error: "End time is required" }),
  notes: z.string().nullable().optional(),
}).refine(
  (data) => data.endTime > data.startTime,
  { message: "End time must be after start time", path: ["endTime"] }
);

export type BookSessionInput = z.infer<typeof BookSessionSchema>;
export type RescheduleSessionInput = z.infer<typeof RescheduleSessionSchema>;
