// POST /api/communications/outbound/:id/send
// Body: { editedBody?: string }
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { sendZoomSms } from "@/lib/zoom/client";
import { sendZoomChatMessage } from "@/lib/zoom/chat";
import { writeAuditLog } from "@/lib/audit";
import { getOutboundMessageById } from "@/lib/queries/communications";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    }
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = (await request.json()) as { editedBody?: string };

  const outbound = await getOutboundMessageById(id);
  if (!outbound)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (outbound.status !== "DRAFT") {
    return NextResponse.json(
      { error: "Message has already been sent." },
      { status: 409 }
    );
  }

  // Determine channel: check linked inbound message type
  const inbound = outbound.inboundMessageId
    ? await prisma.inboundMessage.findUnique({
        where: { id: outbound.inboundMessageId },
        select: { messageType: true },
      })
    : null;
  const isZoomChat = inbound?.messageType === "ZOOM_CHAT";

  const textToSend = body.editedBody ?? outbound.editedBody ?? outbound.draftBody;

  if (!textToSend.trim()) {
    return NextResponse.json(
      { error: "Message body cannot be empty." },
      { status: 400 }
    );
  }

  // 1,600-char limit applies to SMS only — Zoom Chat has no equivalent constraint
  if (!isZoomChat && textToSend.length > 1600) {
    return NextResponse.json(
      { error: "Message exceeds 1,600 character SMS limit." },
      { status: 400 }
    );
  }

  try {
    const { messageId: zoomMessageId } = isZoomChat
      ? await sendZoomChatMessage({ toUserId: outbound.toNumber, message: textToSend })
      : await sendZoomSms({ toNumber: outbound.toNumber, body: textToSend });

    await prisma.outboundMessage.update({
      where: { id },
      data: {
        status: "SENT",
        sentBody: textToSend,
        sentAt: new Date(),
        sentByUserId: user.id,
        zoomMessageId,
        ...(body.editedBody ? { editedBody: body.editedBody } : {}),
      },
    });

    await writeAuditLog({
      action: "UPDATE",
      resourceType: "OutboundMessage",
      resourceId: id,
      metadata: {
        action: "sent",
        outreachReason: outbound.outreachReason,
        recipientType: outbound.recipientType,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[outbound/send]", err);

    await prisma.outboundMessage.update({
      where: { id },
      data: { status: "FAILED" },
    });

    return NextResponse.json(
      { error: "Failed to send via Zoom. Please try again." },
      { status: 502 }
    );
  }
}
