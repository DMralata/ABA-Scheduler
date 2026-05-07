import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { verifyZoomWebhookSignature } from "@/lib/zoom/verify";
import {
  classifyAndSummarizeMessage,
  draftCancellationReply,
} from "@/lib/claude/communications";
import { resolveZoomUserId } from "@/lib/queries/communications";
import { getZoomUserName } from "@/lib/zoom/client";

// ─── Zoom Team Chat Webhook Handler ───────────────────────────────────────────
// Receives events when a provider DMs the scheduler bot.
// Two event types are handled:
//   bot_notification (Chat Subscription / Bot Endpoint URL):
//     payload.userJid (sender JID), payload.cmd (message text), payload.msgId
//   chat_message.sent (Event Subscription):
//     payload.operator_id (sender Zoom user ID), payload.object.message, payload.object.id
//     Only "Chat" type (DMs) are processed; channel messages are ignored.
//
// Authentication: HMAC-SHA256 signature verification via ZOOM_CHAT_WEBHOOK_SECRET_TOKEN
// This route is excluded from Supabase session auth via the middleware matcher.
//
// IMPORTANT: Always return 200. Zoom retries on non-2xx.
// The one exception is invalid signatures (401) which signals misconfiguration.
//
// Note: fromNumber on InboundMessage stores the Zoom User ID for ZOOM_CHAT messages.

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();

  const signature = request.headers.get("x-zm-signature") ?? "";
  const timestamp = request.headers.get("x-zm-request-timestamp") ?? "";
  const secret =
    process.env.ZOOM_CHAT_WEBHOOK_SECRET_TOKEN ??
    process.env.ZOOM_WEBHOOK_SECRET_TOKEN ??
    "";

  // Verify signature
  if (
    !verifyZoomWebhookSignature({ timestamp, signature, body: rawBody, secret })
  ) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Reject stale requests (replay attack protection)
  const requestAge = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
  if (requestAge > 300) {
    return NextResponse.json({ error: "Request too old" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ received: true });
  }

  const event = body.event as string | undefined;

  // Handle Zoom URL validation challenge (required during webhook setup)
  if (event === "endpoint.url_validation") {
    const payload = body.payload as Record<string, string> | undefined;
    const plainToken = payload?.plainToken ?? "";
    const encryptedToken = crypto
      .createHmac("sha256", secret)
      .update(plainToken)
      .digest("hex");
    return NextResponse.json({ plainToken, encryptedToken });
  }

  // Only process bot DM notifications
  if (event !== "bot_notification" && event !== "chat_message.sent") {
    return NextResponse.json({ received: true });
  }

  const payload = body.payload as Record<string, unknown> | undefined;

  let zoomSenderId: string;
  let rawText: string;
  let zoomMessageId: string | null;

  if (event === "bot_notification") {
    // bot_notification payload: userJid is sender's JID (userId@xmpp.zoom.us), cmd is message text
    const userJid = (payload?.userJid?.toString() ?? "") as string;
    zoomSenderId = userJid.split("@")[0];
    rawText = (payload?.cmd?.toString() ?? "") as string;
    zoomMessageId = (payload?.msgId?.toString() ?? null) as string | null;
  } else {
    // chat_message.sent payload: operator_id is sender's Zoom user ID
    const obj = payload?.object as Record<string, unknown> | undefined;
    // Only process DMs (type "Chat"), not channel messages
    if ((obj?.type as string) !== "Chat") {
      return NextResponse.json({ received: true });
    }
    zoomSenderId = (payload?.operator_id?.toString() ?? "") as string;
    rawText = (obj?.message?.toString() ?? "") as string;
    zoomMessageId = (obj?.id?.toString() ?? null) as string | null;
  }

  if (!zoomSenderId || !rawText) {
    return NextResponse.json({ received: true });
  }

  try {
    // Idempotency check
    if (zoomMessageId) {
      const existing = await prisma.inboundMessage.findUnique({
        where: { zoomMessageId },
        select: { id: true },
      });
      if (existing) return NextResponse.json({ received: true });
    }

    // Resolve Zoom User ID to a provider record
    const resolved = await resolveZoomUserId(zoomSenderId);

    // If no provider matched, fetch the display name from Zoom directly
    const fromName = resolved.name ?? (await getZoomUserName(zoomSenderId));

    // Classify with Claude
    const classification = await classifyAndSummarizeMessage({
      rawBody: rawText,
      senderName: fromName,
      messageType: "ZOOM_CHAT",
    });

    // Create InboundMessage — fromNumber stores Zoom User ID for ZOOM_CHAT messages
    const inbound = await prisma.inboundMessage.create({
      data: {
        zoomMessageId,
        messageType: "ZOOM_CHAT",
        fromNumber: zoomSenderId,
        fromName: fromName ?? undefined,
        toNumber: null,
        rawBody: rawText,
        isCancellation: classification.isCancellation,
        aiSummary: classification.summary,
        aiClassification: classification.label,
        classificationConf: classification.confidence,
        resolvedClientId: resolved.clientId,
        resolvedProviderId: resolved.providerId,
        status: "UNREAD",
        receivedAt: new Date(),
      },
    });

    // Write audit log
    await prisma.auditLog.create({
      data: {
        userId: "zoom-webhook",
        action: "CREATE",
        resourceType: "InboundMessage",
        resourceId: inbound.id,
        metadata: {
          fromZoomUserId: zoomSenderId,
          isCancellation: classification.isCancellation,
          messageType: "ZOOM_CHAT",
          resolvedProviderId: resolved.providerId,
        },
      },
    });

    // If it's a cancellation, draft a reply
    if (classification.isCancellation) {
      const draftBody = await draftCancellationReply({
        senderName: resolved.name,
        summary: classification.summary,
      });

      const outbound = await prisma.outboundMessage.create({
        data: {
          inboundMessageId: inbound.id,
          recipientType: "PROVIDER",
          ...(resolved.providerId
            ? { recipientProviderId: resolved.providerId }
            : {}),
          toNumber: zoomSenderId, // Zoom User ID used as recipient identifier
          draftBody,
          status: "DRAFT",
          outreachReason: "CANCELLATION_REPLY",
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: "zoom-webhook",
          action: "CREATE",
          resourceType: "OutboundMessage",
          resourceId: outbound.id,
          metadata: {
            outreachReason: "CANCELLATION_REPLY",
            inboundMessageId: inbound.id,
          },
        },
      });
    }
  } catch (err) {
    // Log but always return 200 to prevent Zoom retries
    console.error("[zoom-chat-webhook]", err);
  }

  return NextResponse.json({ received: true });
}
