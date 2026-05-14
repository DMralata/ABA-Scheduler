import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { generateActionSteps } from "@/lib/claude/communications";

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

  const body = (await request.json()) as { threadKey: string };

  // Get all messages in this thread
  let where: Record<string, unknown>;
  if (body.threadKey.startsWith("provider:")) {
    where = { resolvedProviderId: body.threadKey.slice("provider:".length) };
  } else if (body.threadKey.startsWith("client:")) {
    where = { resolvedClientId: body.threadKey.slice("client:".length) };
  } else {
    where = { fromNumber: body.threadKey.slice("from:".length) };
  }

  // Find the most recent ACTIONED message in this thread — anything received
  // *after* it is unresolved and worth surfacing to the model. If nothing has
  // ever been actioned, fall back to the latest inbound message only.
  const lastActioned = await prisma.inboundMessage.findFirst({
    where: { ...where, status: "ACTIONED" },
    orderBy: { receivedAt: "desc" },
    select: { receivedAt: true },
  });

  const sinceFilter = lastActioned
    ? { ...where, receivedAt: { gt: lastActioned.receivedAt } }
    : where;

  let messages = await prisma.inboundMessage.findMany({
    where: sinceFilter,
    orderBy: { receivedAt: "desc" },
    take: 20, // safety cap
    include: {
      client: {
        select: { id: true, firstName: true, lastName: true, phoneNumber: true },
      },
      provider: {
        select: { id: true, firstName: true, lastName: true, phoneNumber: true },
      },
    },
  });

  // If everything is already actioned, fall back to the single latest inbound
  // so we always have something for the model to anchor on.
  if (messages.length === 0) {
    messages = await prisma.inboundMessage.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      take: 1,
      include: {
        client: {
          select: { id: true, firstName: true, lastName: true, phoneNumber: true },
        },
        provider: {
          select: { id: true, firstName: true, lastName: true, phoneNumber: true },
        },
      },
    });
  }

  if (messages.length === 0) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }

  // Get schedule context: upcoming sessions involving the sender
  const latestMsg = messages[0];
  const now = new Date();

  const sessionWhere: Record<string, unknown> = {
    startTime: { gte: now },
    status: "SCHEDULED",
  };
  if (latestMsg.resolvedProviderId) {
    sessionWhere.providerId = latestMsg.resolvedProviderId;
  } else if (latestMsg.resolvedClientId) {
    sessionWhere.clientId = latestMsg.resolvedClientId;
  }

  const upcomingSessions =
    latestMsg.resolvedProviderId || latestMsg.resolvedClientId
      ? await prisma.session.findMany({
          where: sessionWhere,
          take: 10,
          orderBy: { startTime: "asc" },
          include: {
            client: {
              select: {
                firstName: true,
                lastName: true,
                phoneNumber: true,
              },
            },
            provider: {
              select: {
                firstName: true,
                lastName: true,
                phoneNumber: true,
              },
            },
            sessionType: { select: { name: true } },
          },
        })
      : [];

  // Build context for Claude
  const senderName = latestMsg.provider
    ? `${latestMsg.provider.firstName} ${latestMsg.provider.lastName}`
    : latestMsg.client
    ? `${latestMsg.client.firstName} ${latestMsg.client.lastName}`
    : latestMsg.fromName ?? "Unknown sender";

  const senderType = latestMsg.provider
    ? "Provider"
    : latestMsg.client
    ? "Client"
    : "Unknown";

  const senderPhone =
    latestMsg.provider?.phoneNumber ??
    latestMsg.client?.phoneNumber ??
    null;

  const messageHistory = messages
    .reverse()
    .map(
      (m) =>
        `[${new Date(m.receivedAt).toLocaleString()}] ${m.rawBody}`
    )
    .join("\n");

  const sessionContext = upcomingSessions
    .map((s) => {
      const date = new Date(s.startTime).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      const start = new Date(s.startTime).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
      const end = new Date(s.endTime).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
      const clientName = s.client
        ? `${s.client.firstName} ${s.client.lastName} (${s.client.phoneNumber ?? "no phone"})`
        : "No client";
      const providerName = s.provider
        ? `${s.provider.firstName} ${s.provider.lastName} (${s.provider.phoneNumber ?? "no phone"})`
        : "No provider";
      return `- ${date} ${start}–${end}: ${s.sessionType?.name ?? "Session"} with ${clientName} — Provider: ${providerName}`;
    })
    .join("\n");

  try {
    const steps = await generateActionSteps({
      senderName,
      senderType,
      senderPhone,
      messageHistory,
      sessionContext: sessionContext || "No upcoming sessions found.",
      isCancellation: messages.some((m) => m.isCancellation),
    });

    return NextResponse.json({ steps });
  } catch (err) {
    console.error("[action-steps]", err);
    return NextResponse.json(
      { error: "Failed to generate action steps." },
      { status: 500 },
    );
  }
}
