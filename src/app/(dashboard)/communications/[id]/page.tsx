import { notFound } from "next/navigation";
import { getThreadMessages } from "@/lib/queries/communications";
import { markThreadRead } from "@/lib/actions/communications";
import { ThreadDetailView } from "@/components/communications/ThreadDetailView";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ThreadPage({ params }: Props) {
  const { id } = await params;
  const threadKey = decodeURIComponent(id);

  const messages = await getThreadMessages(threadKey);
  if (messages.length === 0) notFound();

  await markThreadRead(threadKey);

  const firstMsg = messages[0];
  const senderName = firstMsg.client
    ? `${firstMsg.client.firstName} ${firstMsg.client.lastName}`
    : firstMsg.provider
      ? `${firstMsg.provider.firstName} ${firstMsg.provider.lastName}`
      : (firstMsg.fromName ??
        (firstMsg.messageType === "ZOOM_CHAT" ? "Unknown" : firstMsg.fromNumber));

  const senderRole = firstMsg.client
    ? "Client"
    : firstMsg.provider
      ? "Provider"
      : null;

  return (
    <ThreadDetailView
      messages={messages}
      senderName={senderName}
      senderRole={senderRole}
      threadKey={threadKey}
    />
  );
}
