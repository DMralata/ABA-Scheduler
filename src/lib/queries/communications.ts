import { prisma } from "@/lib/prisma";
import { InboundMessageStatus } from "@prisma/client";

// Normalize a phone number to E.164 digits-only for comparison
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  // If 11 digits starting with 1, strip the leading 1 for comparison
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export async function resolvePhoneNumber(phoneNumber: string): Promise<{
  clientId: string | null;
  providerId: string | null;
  name: string | null;
}> {
  const normalized = normalizePhone(phoneNumber);

  // Check clients first
  const clients = await prisma.client.findMany({
    where: { phoneNumber: { not: null } },
    select: { id: true, firstName: true, lastName: true, phoneNumber: true },
  });

  const matchedClient = clients.find(
    (c) => c.phoneNumber && normalizePhone(c.phoneNumber) === normalized
  );
  if (matchedClient) {
    return {
      clientId: matchedClient.id,
      providerId: null,
      name: `${matchedClient.firstName} ${matchedClient.lastName}`,
    };
  }

  // Check providers
  const providers = await prisma.provider.findMany({
    where: { phoneNumber: { not: null } },
    select: { id: true, firstName: true, lastName: true, phoneNumber: true },
  });

  const matchedProvider = providers.find(
    (p) => p.phoneNumber && normalizePhone(p.phoneNumber) === normalized
  );
  if (matchedProvider) {
    return {
      clientId: null,
      providerId: matchedProvider.id,
      name: `${matchedProvider.firstName} ${matchedProvider.lastName}`,
    };
  }

  return { clientId: null, providerId: null, name: null };
}

export async function getInboxMessages(params: {
  status?: InboundMessageStatus;
  limit: number;
  offset: number;
}) {
  const where = params.status ? { status: params.status } : {};

  const [messages, total] = await Promise.all([
    prisma.inboundMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: params.limit,
      skip: params.offset,
      include: {
        client: { select: { id: true, firstName: true, lastName: true } },
        provider: { select: { id: true, firstName: true, lastName: true } },
        outboundMessages: {
          where: { status: "DRAFT" },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    prisma.inboundMessage.count({ where }),
  ]);

  return { messages, total };
}

// ─── Thread-based inbox ──────────────────────────────────────────────────────

export type ThreadSummary = {
  threadKey: string;
  senderName: string;
  senderType: "Client" | "Provider" | null;
  messageType: string;
  latestMessage: {
    id: string;
    aiSummary: string | null;
    rawBody: string;
    receivedAt: Date;
    isCancellation: boolean;
  };
  unreadCount: number;
  totalCount: number;
};

function getThreadKey(msg: {
  resolvedProviderId: string | null;
  resolvedClientId: string | null;
  fromNumber: string;
}): string {
  if (msg.resolvedProviderId) return `provider:${msg.resolvedProviderId}`;
  if (msg.resolvedClientId) return `client:${msg.resolvedClientId}`;
  return `from:${msg.fromNumber}`;
}

export async function getThreads(): Promise<ThreadSummary[]> {
  const messages = await prisma.inboundMessage.findMany({
    orderBy: { receivedAt: "desc" },
    include: {
      client: { select: { id: true, firstName: true, lastName: true } },
      provider: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  const threadMap = new Map<string, ThreadSummary>();

  for (const msg of messages) {
    const key = getThreadKey(msg);

    if (!threadMap.has(key)) {
      const senderName = msg.client
        ? `${msg.client.firstName} ${msg.client.lastName}`
        : msg.provider
        ? `${msg.provider.firstName} ${msg.provider.lastName}`
        : msg.fromName
        ?? (msg.messageType === "ZOOM_CHAT" ? "Unknown" : msg.fromNumber);

      threadMap.set(key, {
        threadKey: key,
        senderName,
        senderType: msg.client ? "Client" : msg.provider ? "Provider" : null,
        messageType: msg.messageType,
        latestMessage: {
          id: msg.id,
          aiSummary: msg.aiSummary,
          rawBody: msg.rawBody,
          receivedAt: msg.receivedAt,
          isCancellation: msg.isCancellation,
        },
        unreadCount: msg.status === "UNREAD" ? 1 : 0,
        totalCount: 1,
      });
    } else {
      const thread = threadMap.get(key)!;
      thread.totalCount++;
      if (msg.status === "UNREAD") thread.unreadCount++;
    }
  }

  return Array.from(threadMap.values());
}

export async function getThreadMessages(threadKey: string) {
  let where: Record<string, unknown>;

  if (threadKey.startsWith("provider:")) {
    where = { resolvedProviderId: threadKey.slice("provider:".length) };
  } else if (threadKey.startsWith("client:")) {
    where = { resolvedClientId: threadKey.slice("client:".length) };
  } else {
    where = { fromNumber: threadKey.slice("from:".length) };
  }

  return prisma.inboundMessage.findMany({
    where,
    orderBy: { receivedAt: "asc" },
    include: {
      client: { select: { id: true, firstName: true, lastName: true } },
      provider: { select: { id: true, firstName: true, lastName: true } },
      outboundMessages: { orderBy: { createdAt: "asc" } },
    },
  });
}

export async function getMessageById(id: string) {
  return prisma.inboundMessage.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, firstName: true, lastName: true } },
      provider: { select: { id: true, firstName: true, lastName: true } },
      outboundMessages: { orderBy: { createdAt: "asc" } },
    },
  });
}

export async function getDraftOutboundMessages(inboundMessageId: string) {
  return prisma.outboundMessage.findMany({
    where: { inboundMessageId, status: "DRAFT" },
    orderBy: { createdAt: "asc" },
  });
}

export async function getOutboundMessageById(id: string) {
  return prisma.outboundMessage.findUnique({ where: { id } });
}

export async function getUnreadCount(): Promise<number> {
  return prisma.inboundMessage.count({ where: { status: "UNREAD" } });
}

export async function resolveZoomUserId(zoomUserId: string): Promise<{
  clientId: string | null;
  providerId: string | null;
  name: string | null;
}> {
  const provider = await prisma.provider.findUnique({
    where: { zoomUserId },
    select: { id: true, firstName: true, lastName: true },
  });

  if (provider) {
    return {
      clientId: null,
      providerId: provider.id,
      name: `${provider.firstName} ${provider.lastName}`,
    };
  }

  return { clientId: null, providerId: null, name: null };
}
