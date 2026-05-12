"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export async function markMessageRead(
  id: string
): Promise<ActionResult<void>> {
  try {
    await prisma.inboundMessage.update({
      where: { id },
      data: { status: "READ" },
    });
    await writeAuditLog({
      action: "UPDATE",
      resourceType: "InboundMessage",
      resourceId: id,
      metadata: { status: "READ" },
    });
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: "Failed to mark message as read." };
  }
}

export async function markThreadRead(
  threadKey: string
): Promise<ActionResult<{ updated: number }>> {
  try {
    let where: Record<string, unknown>;
    if (threadKey.startsWith("provider:")) {
      where = { resolvedProviderId: threadKey.slice("provider:".length) };
    } else if (threadKey.startsWith("client:")) {
      where = { resolvedClientId: threadKey.slice("client:".length) };
    } else {
      where = { fromNumber: threadKey.slice("from:".length) };
    }

    const result = await prisma.inboundMessage.updateMany({
      where: { ...where, status: "UNREAD" },
      data: { status: "READ" },
    });

    if (result.count > 0) {
      await writeAuditLog({
        action: "UPDATE",
        resourceType: "InboundMessage",
        resourceId: threadKey,
        metadata: { status: "READ", count: result.count, scope: "thread" },
      });
      revalidatePath("/", "layout");
    }

    return { success: true, data: { updated: result.count } };
  } catch {
    return { success: false, error: "Failed to mark thread as read." };
  }
}

export async function markMessageActioned(
  id: string
): Promise<ActionResult<void>> {
  try {
    await prisma.inboundMessage.update({
      where: { id },
      data: { status: "ACTIONED" },
    });
    await writeAuditLog({
      action: "UPDATE",
      resourceType: "InboundMessage",
      resourceId: id,
      metadata: { status: "ACTIONED" },
    });
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: "Failed to mark message as actioned." };
  }
}

export async function updateOutboundDraft(
  id: string,
  editedBody: string
): Promise<ActionResult<void>> {
  if (!editedBody.trim()) {
    return { success: false, error: "Message body cannot be empty." };
  }
  if (editedBody.length > 1600) {
    return {
      success: false,
      error: "Message exceeds 1,600 character SMS limit.",
    };
  }

  try {
    await prisma.outboundMessage.update({
      where: { id },
      data: { editedBody },
    });
    await writeAuditLog({
      action: "UPDATE",
      resourceType: "OutboundMessage",
      resourceId: id,
      metadata: { action: "draft_edited" },
    });
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: "Failed to update draft." };
  }
}

