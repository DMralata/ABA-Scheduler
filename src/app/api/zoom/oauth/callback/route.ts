import { NextRequest, NextResponse } from "next/server";

// ─── Zoom OAuth Callback ───────────────────────────────────────────────────────
// Handles the redirect after an admin installs the Zoom General App.
// We don't need to store the OAuth token — this app only uses the General App
// for receiving chat_message.sent webhook events. The install just needs to
// complete successfully so Zoom activates the event subscription.
//
// This route is excluded from Supabase session auth via middleware.

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    console.error("[zoom-oauth-callback] Authorization denied:", error);
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (!code) {
    console.error("[zoom-oauth-callback] No code received");
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Installation complete — redirect to the communications inbox
  return NextResponse.redirect(new URL("/communications", request.url));
}
