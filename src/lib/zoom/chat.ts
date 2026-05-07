import { getZoomBotToken } from "./client";

// Resolves a Zoom user ID from either a raw user ID or an email address.
// Providers are stored by email (more human-readable) so we look up the
// actual Zoom user ID at send time using the S2S OAuth token.
async function resolveZoomUserId(userIdOrEmail: string): Promise<string> {
  if (!userIdOrEmail.includes("@")) {
    // Already a raw user ID
    return userIdOrEmail;
  }

  const token = await getZoomBotToken();
  const res = await fetch(
    `https://api.zoom.us/v2/users/${encodeURIComponent(userIdOrEmail)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zoom user lookup failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function sendZoomChatMessage(params: {
  toUserId: string; // accepts Zoom user ID or email
  message: string;
}): Promise<{ messageId: string }> {
  const [token, resolvedId] = await Promise.all([
    getZoomBotToken(),
    resolveZoomUserId(params.toUserId),
  ]);

  const robotJid = process.env.ZOOM_BOT_JID;
  const accountId = process.env.ZOOM_ACCOUNT_ID;

  if (!robotJid || !accountId) {
    throw new Error("Missing ZOOM_BOT_JID or ZOOM_ACCOUNT_ID");
  }

  const res = await fetch("https://api.zoom.us/v2/im/chat/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      robot_jid: robotJid,
      to_jid: `${resolvedId}@xmpp.zoom.us`,
      user_jid: `${resolvedId}@xmpp.zoom.us`,
      account_id: accountId,
      content: {
        head: { text: "ABA Scheduler" },
        body: [{ type: "message", text: params.message }],
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zoom Chat send failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { id?: string };
  return { messageId: data.id ?? "" };
}
