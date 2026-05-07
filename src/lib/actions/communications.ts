"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { draftScheduleChangeOutreach } from "@/lib/claude/communications";

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

export async function generateOutreachForAffectedParties(params: {
  cancelledSessionIds: string[];
  changeDescription: string;
  inboundMessageId?: string;
}): Promise<ActionResult<{ outboundMessageIds: string[] }>> {
  const { cancelledSessionIds, changeDescription, inboundMessageId } = params;

  if (!cancelledSessionIds.length) {
    return { success: false, error: "No session IDs provided." };
  }

  try {
    const sessions = await prisma.session.findMany({
      where: { id: { in: cancelledSessionIds } },
      include: {
        client: {
          select: { id: true, firstName: true, lastName: true, phoneNumber: true },
        },
        provider: {
          select: { id: true, firstName: true, lastName: true, phoneNumber: true },
        },
      },
    });

    // Collect unique affected parties (client + provider) with phone numbers
    type Party = {
      type: "CLIENT" | "PROVIDER";
      id: string;
      name: string;
      phone: string;
    };

    const partiesMap = new Map<string, Party>();

    for (const session of sessions) {
      if (session.client?.phoneNumber && !partiesMap.has(session.client.id)) {
        partiesMap.set(session.client.id, {
          type: "CLIENT",
          id: session.client.id,
          name: `${session.client.firstName} ${session.client.lastName}`,
          phone: session.client.phoneNumber,
        });
      }
      if (
        session.provider.phoneNumber &&
        !partiesMap.has(session.provider.id)
      ) {
        partiesMap.set(session.provider.id, {
          type: "PROVIDER",
          id: session.provider.id,
          name: `${session.provider.firstName} ${session.provider.lastName}`,
          phone: session.provider.phoneNumber,
        });
      }
    }

    const parties = Array.from(partiesMap.values());

    if (!parties.length) {
      return {
        success: false,
        error:
          "No affected parties with phone numbers found for the given sessions.",
      };
    }

    const outboundMessageIds: string[] = [];

    for (const party of parties) {
      const draftBody = await draftScheduleChangeOutreach({
        recipientName: party.name.split(" ")[0], // first name only
        recipientType: party.type,
        changeDescription,
      });

      const relatedSessionId = cancelledSessionIds[0];

      const outbound = await prisma.outboundMessage.create({
        data: {
          inboundMessageId: inboundMessageId ?? null,
          recipientType: party.type,
          ...(party.type === "CLIENT"
            ? { recipientClientId: party.id }
            : { recipientProviderId: party.id }),
          toNumber: party.phone,
          draftBody,
          status: "DRAFT",
          outreachReason: "SCHEDULE_CHANGE_OUTREACH",
          relatedSessionId,
        },
      });

      await writeAuditLog({
        action: "CREATE",
        resourceType: "OutboundMessage",
        resourceId: outbound.id,
        metadata: {
          outreachReason: "SCHEDULE_CHANGE_OUTREACH",
          recipientType: party.type,
        },
      });

      outboundMessageIds.push(outbound.id);
    }

    return { success: true, data: { outboundMessageIds } };
  } catch (err) {
    console.error("[generateOutreachForAffectedParties]", err);
    return { success: false, error: "Failed to generate outreach drafts." };
  }
}
