// GET /api/communications/messages?status=UNREAD&limit=50&offset=0
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { InboundMessageStatus } from "@prisma/client";
import { getInboxMessages } from "@/lib/queries/communications";

export async function GET(request: NextRequest) {
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

  const { searchParams } = request.nextUrl;
  const statusParam = searchParams.get("status");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100);
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);

  const validStatuses = ["UNREAD", "READ", "ACTIONED", "DISMISSED"];
  const status =
    statusParam && validStatuses.includes(statusParam)
      ? (statusParam as InboundMessageStatus)
      : undefined;

  const result = await getInboxMessages({ status, limit, offset });
  return NextResponse.json(result);
}
