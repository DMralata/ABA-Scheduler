// GET /api/schedule/sessions/week?weekOf=YYYY-MM-DD&centerId=...
// Returns all sessions + pending proposals for Mon–Fri of the given week.
// Lightweight version of /api/schedule/sessions — no drive time computation.

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getSessionTypeColor } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
          for (const { name, value, options } of cookiesToSet)
            cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2]);
        },
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const weekOf = searchParams.get("weekOf");
  const centerId = searchParams.get("centerId");

  if (!weekOf || !/^\d{4}-\d{2}-\d{2}$/.test(weekOf))
    return NextResponse.json({ error: "weekOf (YYYY-MM-DD) is required" }, { status: 400 });

  const [yr, mo, dy] = weekOf.split("-").map(Number);
  const weekStart = new Date(Date.UTC(yr, mo - 1, dy, 0, 0, 0));
  const weekEnd   = new Date(weekStart.getTime() + 7 * 24 * 3_600_000);

  const centerFilter = centerId ? { provider: { centerId } } : {};

  const [sessions, proposals] = await Promise.all([
    prisma.session.findMany({
      where: {
        status: { in: ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] },
        AND: [{ startTime: { gte: weekStart } }, { startTime: { lt: weekEnd } }],
        ...centerFilter,
      },
      select: {
        id: true, startTime: true, endTime: true,
        status: true, cancelledBy: true,
        sessionTypeId: true, locationType: true,
        client:   { select: { id: true, firstName: true, lastName: true } },
        provider: { select: { id: true, firstName: true, lastName: true } },
        sessionType: { select: { id: true, name: true } },
      },
      orderBy: { startTime: "asc" },
    }),
    prisma.proposedSession.findMany({
      where: {
        status: "PENDING",
        AND: [{ startTime: { gte: weekStart } }, { startTime: { lt: weekEnd } }],
        ...centerFilter,
      },
      select: {
        id: true, startTime: true, endTime: true,
        sessionTypeId: true, locationType: true,
        client:   { select: { id: true, firstName: true, lastName: true } },
        provider: { select: { id: true, firstName: true, lastName: true } },
        sessionType: { select: { id: true, name: true } },
      },
      orderBy: { startTime: "asc" },
    }),
  ]);

  const events = [
    ...sessions.map((s) => ({
      id: s.id,
      start: s.startTime.toISOString(),
      end: s.endTime.toISOString(),
      clientId:     s.client?.id ?? null,
      clientName:   s.client ? `${s.client.lastName}, ${s.client.firstName}` : null,
      providerId:   s.provider.id,
      providerName: `${s.provider.lastName}, ${s.provider.firstName}`,
      sessionTypeId:   s.sessionTypeId,
      sessionTypeName: s.sessionType.name,
      color: getSessionTypeColor(s.sessionTypeId),
      type: "session" as const,
      status: s.status,
      cancelledBy: s.cancelledBy ?? null,
      locationType: s.locationType ?? "CENTER",
    })),
    ...proposals.map((p) => ({
      id: `proposal-${p.id}`,
      proposalId: p.id,
      start: p.startTime.toISOString(),
      end: p.endTime.toISOString(),
      clientId:     p.client.id,
      clientName:   `${p.client.lastName}, ${p.client.firstName}`,
      providerId:   p.provider.id,
      providerName: `${p.provider.lastName}, ${p.provider.firstName}`,
      sessionTypeId:   p.sessionTypeId,
      sessionTypeName: p.sessionType.name,
      color: getSessionTypeColor(p.sessionTypeId),
      type: "proposal" as const,
      status: "PENDING",
      cancelledBy: null,
      locationType: p.locationType ?? "CENTER",
    })),
  ];

  return NextResponse.json({ events });
}
