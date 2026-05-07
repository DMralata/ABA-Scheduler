import { z } from "zod";

export const BookSessionSchema = z.object({
  name: z.string().min(1, "Session name is required"),
  sessionTypeId: z.string().min(1, "Session type is required"),
  providerId: z.string().min(1, "Provider is required"),
  clientId: z.string().nullable().optional(),
  authorizationId: z.string().nullable().optional(), // Resolved during validation; can be pre-supplied
  startTime: z.coerce.date({ required_error: "Start time is required" }),
  endTime: z.coerce.date({ required_error: "End time is required" }),
  billable: z.boolean().default(true),
  locationType: z.enum(["HOME", "CENTER", "SCHOOL"]).optional(),
  centerId: z.string().nullable().optional(), // Which center (when locationType is CENTER)
  timezone: z.string().optional(), // IANA timezone — falls back to center timezone if omitted
  notes: z.string().nullable().optional(),
}).refine(
  (data) => data.endTime > data.startTime,
  { message: "End time must be after start time", path: ["endTime"] }
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
