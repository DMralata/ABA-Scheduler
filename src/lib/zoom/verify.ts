import crypto from "crypto";

export function verifyZoomWebhookSignature(params: {
  timestamp: string;
  signature: string;
  body: string;
  secret: string;
}): boolean {
  const { timestamp, signature, body, secret } = params;

  const message = `v0:${timestamp}:${body}`;
  const expected =
    "v0=" +
    crypto.createHmac("sha256", secret).update(message).digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}
