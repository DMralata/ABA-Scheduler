interface ZoomToken {
  accessToken: string;
  expiresAt: number; // ms epoch
}

let cachedToken: ZoomToken | null = null;
let cachedBotToken: ZoomToken | null = null;

export async function getZoomBotToken(): Promise<string> {
  const now = Date.now();
  if (cachedBotToken && cachedBotToken.expiresAt - 60_000 > now) {
    return cachedBotToken.accessToken;
  }

  const clientId = process.env.ZOOM_BOT_CLIENT_ID;
  const clientSecret = process.env.ZOOM_BOT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing ZOOM_BOT_CLIENT_ID or ZOOM_BOT_CLIENT_SECRET");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(
    "https://zoom.us/oauth/token?grant_type=client_credentials",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zoom Bot OAuth failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  cachedBotToken = {
    accessToken: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };

  return cachedBotToken.accessToken;
}

export async function getZoomAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) {
    return cachedToken.accessToken;
  }

  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;

  if (!accountId || !clientId || !clientSecret) {
    throw new Error("Missing Zoom OAuth environment variables");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  );

  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zoom OAuth failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };

  return cachedToken.accessToken;
}

export async function getZoomUserName(zoomUserId: string): Promise<string | null> {
  try {
    const token = await getZoomBotToken();
    const res = await fetch(
      `https://api.zoom.us/v2/users/${encodeURIComponent(zoomUserId)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      display_name?: string;
      first_name?: string;
      last_name?: string;
    };
    return (
      data.display_name ??
      ([data.first_name, data.last_name].filter(Boolean).join(" ") || null)
    );
  } catch (err) {
    console.error("[getZoomUserName]", err);
    return null;
  }
}

export async function sendZoomSms(params: {
  toNumber: string;
  body: string;
  fromNumber?: string;
}): Promise<{ messageId: string }> {
  const token = await getZoomAccessToken();
  const fromNumber =
    params.fromNumber ?? process.env.ZOOM_PHONE_NUMBER;

  if (!fromNumber) {
    throw new Error("No from number provided and ZOOM_PHONE_NUMBER is not set");
  }

  const res = await fetch("https://api.zoom.us/v2/phone/sms/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to_number: params.toNumber,
      message: params.body,
      from_number: fromNumber,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zoom SMS send failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { message_id?: string; id?: string };
  const messageId = data.message_id ?? data.id ?? "";
  return { messageId };
}
