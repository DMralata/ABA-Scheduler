import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { verifyZoomWebhookSignature } from "@/lib/zoom/verify";
import {
  classifyAndSummarizeMessage,
  draftCancellationReply,
} from "@/lib/claude/communications";
import { resolvePhoneNumber } from "@/lib/queries/communications";

// ─── Zoom Phone Webhook Handler ────────────────────────────────────────────────
// This route is intentionally unauthenticated — Supabase session auth is bypassed
// in middleware.ts. Authentication here is HMAC-SHA256 signature verification only.
//
// IMPORTANT: Always return 200. Zoom retries on non-2xx, which could cause
// duplicate processing. The one exception is invalid signatures (401) which
// signals misconfiguration to the Zoom app developer.

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();

  const signature = request.headers.get("x-zm-signature") ?? "";
  const timestamp = request.headers.get("x-zm-request-timestamp") ?? "";
  const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN ?? "";

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

  // Only process inbound SMS/voicemail events
  if (event !== "phone.message_received" && event !== "phone.voicemail_received") {
    return NextResponse.json({ received: true });
  }

  const messageType = event === "phone.voicemail_received" ? "VOICEMAIL" : "SMS";
  const payload = body.payload as Record<string, unknown> | undefined;
  const obj = (payload?.object ?? {}) as Record<string, unknown>;

  const zoomMessageId = (body.event_ts?.toString() ?? obj.id?.toString() ?? null) as string | null;
  const fromNumber = (obj.caller_number ?? obj.from_number ?? "") as string;
  const toNumber = (obj.callee_number ?? obj.to_number ?? null) as string | null;
  const rawBody2 =
    messageType === "VOICEMAIL"
      ? ((obj.transcript ?? obj.body ?? "") as string)
      : ((obj.message ?? obj.body ?? "") as string);
  const receivedAt = obj.date_time
    ? new Date(obj.date_time as string)
    : new Date();

  if (!fromNumber || !rawBody2) {
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

    // Resolve phone number to client or provider
    const resolved = await resolvePhoneNumber(fromNumber);

    // Classify with Claude
    const classification = await classifyAndSummarizeMessage({
      rawBody: rawBody2,
      senderName: resolved.name,
      messageType,
    });

    // Create InboundMessage
    const inbound = await prisma.inboundMessage.create({
      data: {
        zoomMessageId,
        messageType,
        fromNumber,
        toNumber,
        rawBody: rawBody2,
        isCancellation: classification.isCancellation,
        aiSummary: classification.summary,
        aiClassification: classification.label,
        classificationConf: classification.confidence,
        resolvedClientId: resolved.clientId,
        resolvedProviderId: resolved.providerId,
        status: "UNREAD",
        receivedAt,
      },
    });

    // Write audit log directly (no session available in webhook context)
    await prisma.auditLog.create({
      data: {
        userId: "zoom-webhook",
        action: "CREATE",
        resourceType: "InboundMessage",
        resourceId: inbound.id,
        metadata: {
          fromNumber,
          isCancellation: classification.isCancellation,
          messageType,
          resolvedClientId: resolved.clientId,
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
          recipientType: resolved.clientId ? "CLIENT" : "PROVIDER",
          ...(resolved.clientId
            ? { recipientClientId: resolved.clientId }
            : {}),
          ...(resolved.providerId
            ? { recipientProviderId: resolved.providerId }
            : {}),
          toNumber: fromNumber,
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
    console.error("[zoom-webhook]", err);
  }

  return NextResponse.json({ received: true });
}
