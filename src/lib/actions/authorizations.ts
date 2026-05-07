"use server";

import { prisma } from "@/lib/prisma";
import { AuthorizationSchema, UpdateAuthorizationSchema } from "@/lib/schemas/authorization";
import type { AuthorizationInput, UpdateAuthorizationInput } from "@/lib/schemas/authorization";
import { writeAuditLog } from "@/lib/audit";

// ─── Response Types ───────────────────────────────────────────────────────────

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

// ─── Create Authorization ─────────────────────────────────────────────────────

export async function createAuthorization(
  input: AuthorizationInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = AuthorizationSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const client = await prisma.client.findUnique({
    where: { id: parsed.data.clientId },
    select: { id: true },
  });
  if (!client) {
    return { success: false, error: "Client not found." };
  }

  const authorization = await prisma.authorization.create({
    data: parsed.data,
    select: { id: true },
  });

  await writeAuditLog({
    action: "CREATE",
    resourceType: "Authorization",
    resourceId: authorization.id,
    metadata: { clientId: parsed.data.clientId },
  });

  return { success: true, data: authorization };
}

// ─── Update Authorization ─────────────────────────────────────────────────────

export async function updateAuthorization(
  id: string,
  input: UpdateAuthorizationInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = UpdateAuthorizationSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const existing = await prisma.authorization.findUnique({
    where: { id },
    select: { id: true, clientId: true },
  });
  if (!existing) {
    return { success: false, error: "Authorization not found." };
  }

  const authorization = await prisma.authorization.update({
    where: { id },
    data: parsed.data,
    select: { id: true },
  });

  await writeAuditLog({
    action: "UPDATE",
    resourceType: "Authorization",
    resourceId: authorization.id,
    metadata: { clientId: existing.clientId },
  });

  return { success: true, data: authorization };
}

// ─── Delete Authorization ─────────────────────────────────────────────────────
// Only allowed if no sessions are linked to it.

export async function deleteAuthorization(id: string): Promise<ActionResult<void>> {
  const existing = await prisma.authorization.findUnique({
    where: { id },
    select: { id: true, clientId: true, _count: { select: { sessions: true } } },
  });
  if (!existing) {
    return { success: false, error: "Authorization not found." };
  }
  if (existing._count.sessions > 0) {
    return {
      success: false,
      error: `Cannot delete an authorization with ${existing._count.sessions} linked session(s). Archive or reassign sessions first.`,
    };
  }

  await prisma.authorization.delete({ where: { id } });

  await writeAuditLog({
    action: "DELETE",
    resourceType: "Authorization",
    resourceId: id,
    metadata: { clientId: existing.clientId },
  });

  return { success: true, data: undefined };
}
