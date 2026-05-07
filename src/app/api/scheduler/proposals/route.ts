// GET /api/scheduler/proposals?weekOf=<ISO date>
// Returns pending proposals for a given week — used by ProposalView to refresh after generation.

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPendingProposals } from "@/lib/actions/scheduler";

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2]);
          }
        },
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const weekOfStr = request.nextUrl.searchParams.get("weekOf");
  if (!weekOfStr) {
    return NextResponse.json({ error: "weekOf is required" }, { status: 400 });
  }

  const weekOf = new Date(weekOfStr);
  if (isNaN(weekOf.getTime())) {
    return NextResponse.json({ error: "Invalid weekOf date" }, { status: 400 });
  }

  const proposals = await getPendingProposals(weekOf);
  return NextResponse.json({ proposals });
}
