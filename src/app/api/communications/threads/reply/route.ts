import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { sendZoomSms } from "@/lib/zoom/client";
import { sendZoomChatMessage } from "@/lib/zoom/chat";
import { writeAuditLog } from "@/lib/audit";

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options?: object }[]
        ) {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(
              name,
              value,
              options as Parameters<typeof cookieStore.set>[2]
            );
          }
        },
      },
    },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    threadKey: string;
    message: string;
  };

  if (!body.message?.trim()) {
    return NextResponse.json(
      { error: "Message cannot be empty." },
      { status: 400 },
    );
  }

  // Find the most recent inbound message in this thread to determine channel + recipient
  let where: Record<string, unknown>;
  if (body.threadKey.startsWith("provider:")) {
    where = { resolvedProviderId: body.threadKey.slice("provider:".length) };
  } else if (body.threadKey.startsWith("client:")) {
    where = { resolvedClientId: body.threadKey.slice("client:".length) };
  } else {
    where = { fromNumber: body.threadKey.slice("from:".length) };
  }

  const latestInbound = await prisma.inboundMessage.findFirst({
    where,
    orderBy: { receivedAt: "desc" },
    select: {
      id: true,
      messageType: true,
      fromNumber: true,
      resolvedProviderId: true,
      resolvedClientId: true,
    },
  });

  if (!latestInbound) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }

  const isZoomChat = latestInbound.messageType === "ZOOM_CHAT";
  const recipientId = latestInbound.fromNumber; // Zoom user ID or phone number

  try {
    const { messageId: zoomMessageId } = isZoomChat
      ? await sendZoomChatMessage({
          toUserId: recipientId,
          message: body.message,
        })
      : await sendZoomSms({ toNumber: recipientId, body: body.message });

    // Record as OutboundMessage for audit trail.
    // Use upsert because the Zoom webhook (chat_message.sent / bot_notification)
    // may race ahead and insert a row with this zoomMessageId before we get here.
    // When that happens, we update the existing row with the user-tracked data
    // (sentByUserId, outreachReason, draftBody) instead of failing.
    const recipientType = latestInbound.resolvedProviderId
      ? "PROVIDER"
      : latestInbound.resolvedClientId
      ? "CLIENT"
      : "UNKNOWN";

    const outbound = zoomMessageId
      ? await prisma.outboundMessage.upsert({
          where: { zoomMessageId },
          create: {
            inboundMessageId: latestInbound.id,
            recipientType,
            recipientProviderId: latestInbound.resolvedProviderId,
            recipientClientId: latestInbound.resolvedClientId,
            toNumber: recipientId,
            draftBody: body.message,
            sentBody: body.message,
            status: "SENT",
            sentAt: new Date(),
            sentByUserId: user.id,
            zoomMessageId,
            outreachReason: "MANUAL_REPLY",
          },
          update: {
            inboundMessageId: latestInbound.id,
            recipientType,
            recipientProviderId: latestInbound.resolvedProviderId,
            recipientClientId: latestInbound.resolvedClientId,
            draftBody: body.message,
            sentBody: body.message,
            status: "SENT",
            sentAt: new Date(),
            sentByUserId: user.id,
            outreachReason: "MANUAL_REPLY",
          },
        })
      : await prisma.outboundMessage.create({
          data: {
            inboundMessageId: latestInbound.id,
            recipientType,
            recipientProviderId: latestInbound.resolvedProviderId,
            recipientClientId: latestInbound.resolvedClientId,
            toNumber: recipientId,
            draftBody: body.message,
            sentBody: body.message,
            status: "SENT",
            sentAt: new Date(),
            sentByUserId: user.id,
            outreachReason: "MANUAL_REPLY",
          },
        });

    await writeAuditLog({
      action: "CREATE",
      resourceType: "OutboundMessage",
      resourceId: outbound.id,
      metadata: {
        action: "manual_reply_sent",
        threadKey: body.threadKey,
        channel: isZoomChat ? "ZOOM_CHAT" : "SMS",
      },
    });

    return NextResponse.json({ success: true, messageId: outbound.id });
  } catch (err) {
    console.error("[threads/reply]", err);
    return NextResponse.json(
      { error: "Failed to send. Please try again." },
      { status: 502 },
    );
  }
}
