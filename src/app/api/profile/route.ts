// GET /api/profile?type=client|provider&id=...
// Returns a compact profile summary for use in the schedule ProfileSheet.

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

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
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const type = searchParams.get("type");
  const id   = searchParams.get("id");

  if (!id || (type !== "client" && type !== "provider")) {
    return NextResponse.json({ error: "type and id are required" }, { status: 400 });
  }

  if (type === "client") {
    const client = await prisma.client.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        gender: true,
        insurance: true,
        spanish: true,
        femaleProviderOnly: true,
        preferredLocation: true,
        minimumRbtLevel: true,
        activeDate: true,
        terminationDate: true,
        street: true,
        city: true,
        state: true,
        zip: true,
      },
    });
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ type: "client", ...client });
  }

  const provider = await prisma.provider.findUnique({
    where: { id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      status: true,
      position: true,
      rbtLevel: true,
      gender: true,
      spanish: true,
      payRateHourly: true,
      street: true,
      city: true,
      state: true,
      zip: true,
    },
  });
  if (!provider) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ type: "provider", ...provider });
}
