// POST /api/communications/outbound/:id/regenerate
// Regenerates the AI draft for an outbound message
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  draftCancellationReply,
  draftScheduleChangeOutreach,
} from "@/lib/claude/communications";
import { getOutboundMessageById } from "@/lib/queries/communications";

export async function POST(
  _request: NextRequest,
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
  const outbound = await getOutboundMessageById(id);
  if (!outbound)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (outbound.status === "SENT") {
    return NextResponse.json(
      { error: "Cannot regenerate a sent message." },
      { status: 409 }
    );
  }

  try {
    let newDraft: string;

    if (outbound.outreachReason === "CANCELLATION_REPLY") {
      // Fetch the linked inbound message for context
      const inbound = outbound.inboundMessageId
        ? await prisma.inboundMessage.findUnique({
            where: { id: outbound.inboundMessageId },
            include: {
              client: { select: { firstName: true } },
              provider: { select: { firstName: true } },
            },
          })
        : null;

      const senderName =
        inbound?.client?.firstName ??
        inbound?.provider?.firstName ??
        null;

      newDraft = await draftCancellationReply({
        senderName,
        summary: inbound?.aiSummary ?? outbound.draftBody,
      });
    } else {
      // SCHEDULE_CHANGE_OUTREACH — use recipient name from DB
      const recipientClient = outbound.recipientClientId
        ? await prisma.client.findUnique({
            where: { id: outbound.recipientClientId },
            select: { firstName: true },
          })
        : null;
      const recipientProvider = outbound.recipientProviderId
        ? await prisma.provider.findUnique({
            where: { id: outbound.recipientProviderId },
            select: { firstName: true },
          })
        : null;

      const recipientName =
        recipientClient?.firstName ?? recipientProvider?.firstName ?? null;

      newDraft = await draftScheduleChangeOutreach({
        recipientName,
        recipientType: outbound.recipientType as "CLIENT" | "PROVIDER",
        changeDescription:
          "Your upcoming session schedule has been updated. Please check with your care team for details.",
      });
    }

    await prisma.outboundMessage.update({
      where: { id },
      data: { draftBody: newDraft, editedBody: null },
    });

    return NextResponse.json({ draftBody: newDraft });
  } catch (err) {
    console.error("[outbound/regenerate]", err);
    return NextResponse.json(
      { error: "Failed to regenerate draft." },
      { status: 500 }
    );
  }
}
