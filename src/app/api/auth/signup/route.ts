import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ALLOWED_DOMAIN = "alltogetherautism.com";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as {
    email?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
    position?: string;
  } | null;

  const email = body?.email?.trim().toLowerCase();
  const password = body?.password;
  const firstName = body?.firstName?.trim();
  const lastName = body?.lastName?.trim();
  const position = body?.position?.trim();

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 },
    );
  }

  if (!firstName || !lastName) {
    return NextResponse.json(
      { error: "First name and last name are required." },
      { status: 400 },
    );
  }

  const ALLOWED_POSITIONS = ["Manager", "BCBA", "Scheduler"];
  if (!position || !ALLOWED_POSITIONS.includes(position)) {
    return NextResponse.json(
      { error: "Position must be Manager, BCBA, or Scheduler." },
      { status: 400 },
    );
  }

  if (password.length < 12) {
    return NextResponse.json(
      { error: "Password must be at least 12 characters." },
      { status: 400 },
    );
  }

  const emailDomain = email.split("@")[1];
  if (emailDomain !== ALLOWED_DOMAIN) {
    return NextResponse.json(
      { error: `Only @${ALLOWED_DOMAIN} email addresses are permitted.` },
      { status: 403 },
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Server is not configured for signup." },
      { status: 500 },
    );
  }

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
        full_name: `${firstName} ${lastName}`,
        position,
      },
    });

    if (error) {
      console.error("[auth/signup] Supabase error:", error);
      const status = error.message.toLowerCase().includes("already")
        ? 409
        : 400;
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[auth/signup] Unhandled error:", err);
    const message =
      err instanceof Error ? err.message : "Unexpected error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
