import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

// ─── Audit Log Writer ─────────────────────────────────────────────────────────
// Write-only. Logs every create, update, and delete of client-related data for
// HIPAA compliance. Call after a successful mutation — never before.
//
// Failures are swallowed and logged to stderr so the primary operation is never
// blocked by an audit log write. HIPAA requires best-effort logging; it does not
// require the primary action to fail if logging fails.

export async function writeAuditLog(params: {
  action: "CREATE" | "UPDATE" | "DELETE";
  resourceType: string; // "Client" | "Session" | "Authorization" | "Provider" | "ApprovedHome" | etc.
  resourceId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      // Actions should only be reachable by authenticated users.
      // If this fires, something bypassed auth — flag it loudly.
      console.error(
        `[AuditLog] Unauthenticated write attempt: ${params.action} ${params.resourceType}/${params.resourceId}`
      );
      return;
    }

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        metadata: params.metadata ? JSON.parse(JSON.stringify(params.metadata)) : undefined,
      },
    });
  } catch (err) {
    // Log to stderr but do not re-throw — audit failures must not block operations.
    console.error("[AuditLog] Failed to write audit log:", err, params);
  }
}
