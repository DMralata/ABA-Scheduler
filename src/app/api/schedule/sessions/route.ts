// GET /api/schedule/sessions?start=ISO&end=ISO&clientId=...&providerId=...
// Returns sessions in FullCalendar event format, including pending proposals.

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getDriveTimeMatrix } from "@/lib/scheduler/maps";
import { getSessionTypeColor, getSessionTypeAccent, DRIVE_TIME_COLOR } from "@/lib/utils";

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
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  const clientId = searchParams.get("clientId");
  const providerId = searchParams.get("providerId");
  const centerId = searchParams.get("centerId");

  if (!start || !end) {
    return NextResponse.json({ error: "start and end are required" }, { status: 400 });
  }

  const startDate = new Date(start);
  const endDate = new Date(end);

  // Load center address for use as the "from" location in CENTER session drive blocks
  const center = centerId
    ? await prisma.center.findUnique({
        where: { id: centerId },
        select: {
          id: true, street: true, city: true, state: true, zip: true, latitude: true, longitude: true, timezone: true,
          schoolStreet: true, schoolCity: true, schoolState: true, schoolZip: true, schoolLatitude: true, schoolLongitude: true,
        },
      })
    : null;
  const centerAddress = center
    ? [center.street, center.city, center.state, center.zip].filter(Boolean).join(", ") || null
    : null;
  const centerLat = center?.latitude ?? null;
  const centerLng = center?.longitude ?? null;
  const schoolAddress = center
    ? [center.schoolStreet, center.schoolCity, center.schoolState, center.schoolZip].filter(Boolean).join(", ") || null
    : null;
  const schoolLat = center?.schoolLatitude ?? null;
  const schoolLng = center?.schoolLongitude ?? null;

  const sessions = await prisma.session.findMany({
    where: {
      // Show all statuses including CANCELLED — the frontend differentiates:
      //   CLIENT-cancelled: dark red striped in client row, free block in provider row
      //   PROVIDER-cancelled: dark red striped in provider row, free block in client row
      status: { in: ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] },
      AND: [{ startTime: { lt: endDate } }, { endTime: { gt: startDate } }],
      ...(clientId ? { clientId } : {}),
      ...(providerId ? { providerId } : {}),
    },
    include: {
      client: { select: { id: true, firstName: true, lastName: true, street: true, city: true, state: true, zip: true, latitude: true, longitude: true } },
      provider: { select: { id: true, firstName: true, lastName: true, position: true, street: true, city: true, state: true, zip: true, latitude: true, longitude: true } },
      sessionType: { select: { id: true, name: true } },
    },
    orderBy: { startTime: "asc" },
  });

  const proposals = await prisma.proposedSession.findMany({
    where: {
      status: "PENDING",
      AND: [{ startTime: { lt: endDate } }, { endTime: { gt: startDate } }],
      ...(clientId ? { clientId } : {}),
      ...(providerId ? { providerId } : {}),
    },
    include: {
      client: { select: { id: true, firstName: true, lastName: true, street: true, city: true, state: true, zip: true, latitude: true, longitude: true } },
      provider: { select: { id: true, firstName: true, lastName: true, position: true, street: true, city: true, state: true, zip: true, latitude: true, longitude: true } },
      sessionType: { select: { id: true, name: true } },
    },
  });

  const sessionEvents = sessions.map((s) => {
    const isDriveTime = s.sessionType.name === "Drive Time";
    const color = isDriveTime ? DRIVE_TIME_COLOR : getSessionTypeColor(s.sessionTypeId);
    const accentColor = isDriveTime ? DRIVE_TIME_COLOR : getSessionTypeAccent(s.sessionType.name);

    // Parse driveMinutes from notes JSON for Drive Time sessions so DriveBlock
    // can split the block into the actual drive portion and the buffer.
    let driveMinutes: number | undefined;
    if (isDriveTime && s.notes) {
      try {
        const meta = JSON.parse(s.notes) as { driveMinutes?: number };
        driveMinutes = typeof meta.driveMinutes === "number" ? meta.driveMinutes : undefined;
      } catch { /* malformed notes — leave driveMinutes undefined */ }
    }

    return {
      id: s.id,
      title: isDriveTime ? "Drive Time" : (s.client
        ? `${s.client.lastName}, ${s.client.firstName}`
        : s.provider.lastName + ", " + s.provider.firstName),
      start: s.startTime.toISOString(),
      end: s.endTime.toISOString(),
      backgroundColor: color,
      borderColor: color,
      extendedProps: {
        // Drive Time sessions use type "drive" so ResourceTimeline renders them
        // as a DriveBlock (dashed, two-segment) rather than a solid SessionBlock.
        type: isDriveTime ? "drive" as const : "session" as const,
        sessionTypeId: s.sessionTypeId,
        sessionTypeName: s.sessionType.name,
        clientId: s.clientId,
        clientName: s.client ? `${s.client.firstName} ${s.client.lastName}` : null,
        clientAddress: s.client && s.locationType === "HOME"
          ? [s.client.street, s.client.city, s.client.state, s.client.zip].filter(Boolean).join(", ") || null
          : null,
        locationType: s.locationType ?? "CENTER",
        providerId: s.providerId,
        providerName: `${s.provider.firstName} ${s.provider.lastName}`,
        providerPosition: s.provider.position,
        status: s.status,
        cancelledBy: s.cancelledBy ?? null,
        driveMinutes,
        notes: s.notes,
        accentColor,
      },
    };
  });

  const proposalEvents = proposals.map((p) => {
    const color = getSessionTypeColor(p.sessionTypeId);
    const accentColor = getSessionTypeAccent(p.sessionType.name);
    return {
      id: `proposal-${p.id}`,
      title: `[Proposed] ${p.client.lastName}, ${p.client.firstName}`,
      start: p.startTime.toISOString(),
      end: p.endTime.toISOString(),
      backgroundColor: color + "66", // 40% opacity
      borderColor: color,
      classNames: ["proposal-event"],
      extendedProps: {
        type: "proposal",
        proposalId: p.id,
        sessionTypeId: p.sessionTypeId,
        sessionTypeName: p.sessionType.name,
        clientId: p.clientId,
        clientName: `${p.client.firstName} ${p.client.lastName}`,
        clientAddress: null,
        locationType: p.locationType ?? "CENTER",
        providerId: p.providerId,
        providerName: `${p.provider.firstName} ${p.provider.lastName}`,
        providerPosition: p.provider.position,
        reasoning: p.reasoning,
        accentColor,
      },
    };
  });

  // ── Drive time blocks ──────────────────────────────────────────────────────
  // For providers with consecutive HOME sessions/proposals, fetch drive time
  // from each client's location to the next, then return "drive" pseudo-events
  // so the timeline can render a travel block in the provider's row.

  type DriveCandidate = {
    providerId: string;
    clientId: string | null;
    clientName: string | null;
    clientAddress: string | null;
    clientLat: number | null;
    clientLng: number | null;
    endTime: Date;
    nextClientId: string | null;
    nextClientName: string | null;
    nextClientAddress: string | null;
    nextClientLat: number | null;
    nextClientLng: number | null;
    nextStartTime: Date;
  };

  function formatAddress(parts: (string | null | undefined)[]): string | null {
    const s = parts.filter(Boolean).join(", ");
    return s || null;
  }

  // Build a unified list of all client sessions (HOME + CENTER) with their
  // effective "from" location for drive time computation.
  //
  // For HOME sessions: "from" = client's home address.
  // For CENTER sessions: "from" = center address (actual clinic location).
  //   Falls back to provider home if center address is unavailable.
  //
  // Only sessions where the NEXT session is HOME need a from-address — CENTER
  // arrivals don't require a drive block. We include CENTER sessions here so
  // we can detect CENTER→HOME transitions.
  const allClientSlots: Array<{
    providerId: string;
    locationType: "HOME" | "CENTER" | "SCHOOL";
    fromAddress: string | null;
    fromLat: number | null;
    fromLng: number | null;
    clientId: string | null;    // client at the destination (used for "to" when this is the FROM session)
    clientName: string | null;
    clientAddress: string | null; // destination address
    clientLat: number | null;
    clientLng: number | null;
    startTime: Date;
    endTime: Date;
  }> = [
    ...sessions
      .filter((s) => s.locationType === "HOME" || s.locationType === "CENTER" || s.locationType === "SCHOOL")
      .filter((s) => !s.sessionType || s.sessionType.name !== "Drive Time") // exclude Drive Time sessions
      .map((s) => {
        const loc = (s.locationType ?? "CENTER") as "HOME" | "CENTER" | "SCHOOL";
        const isHome = loc === "HOME";
        const isSchool = loc === "SCHOOL";
        // From = client home for HOME sessions; school address for SCHOOL; center address for CENTER (fallback to provider home).
        const fromAddr = isHome
          ? (s.client ? formatAddress([s.client.street, s.client.city, s.client.state, s.client.zip]) : null)
          : isSchool
            ? schoolAddress
            : (centerAddress ?? formatAddress([s.provider.street, s.provider.city, s.provider.state, s.provider.zip]));
        const fromLatV = isHome ? (s.client?.latitude ?? null) : isSchool ? schoolLat : (centerLat ?? s.provider?.latitude ?? null);
        const fromLngV = isHome ? (s.client?.longitude ?? null) : isSchool ? schoolLng : (centerLng ?? s.provider?.longitude ?? null);
        return {
          providerId: s.providerId,
          locationType: loc,
          fromAddress: fromAddr,
          fromLat: fromLatV,
          fromLng: fromLngV,
          clientId: s.clientId,
          clientName: s.client ? `${s.client.lastName}, ${s.client.firstName}` : null,
          clientAddress: s.client ? formatAddress([s.client.street, s.client.city, s.client.state, s.client.zip]) : null,
          clientLat: s.client?.latitude ?? null,
          clientLng: s.client?.longitude ?? null,
          startTime: s.startTime,
          endTime: s.endTime,
        };
      }),
    ...proposals
      .filter((p) => p.locationType === "HOME" || p.locationType === "CENTER" || p.locationType === "SCHOOL")
      .map((p) => {
        const loc = (p.locationType ?? "CENTER") as "HOME" | "CENTER" | "SCHOOL";
        const isHome = loc === "HOME";
        const isSchool = loc === "SCHOOL";
        // Use the proposal's own provider relation — always available from the include.
        // The old sessions.find() lookup failed for providers with proposals but no
        // existing sessions yet (e.g. first run of the day), leaving fromAddress null
        // and preventing CENTER→HOME pseudo-event generation.
        const prov = p.provider;
        return {
          providerId: p.providerId,
          locationType: loc,
          fromAddress: isHome
            ? formatAddress([p.client.street, p.client.city, p.client.state, p.client.zip])
            : isSchool
              ? schoolAddress
              : (centerAddress ?? (prov ? formatAddress([prov.street, prov.city, prov.state, prov.zip]) : null)),
          fromLat: isHome ? (p.client?.latitude ?? null) : isSchool ? schoolLat : (centerLat ?? prov?.latitude ?? null),
          fromLng: isHome ? (p.client?.longitude ?? null) : isSchool ? schoolLng : (centerLng ?? prov?.longitude ?? null),
          clientId: p.clientId,
          clientName: `${p.client.lastName}, ${p.client.firstName}`,
          clientAddress: formatAddress([p.client.street, p.client.city, p.client.state, p.client.zip]),
          clientLat: p.client?.latitude ?? null,
          clientLng: p.client?.longitude ?? null,
          startTime: p.startTime,
          endTime: p.endTime,
        };
      }),
  ];

  // Build provider name map for drive event labels
  const providerNameMap = new Map<string, string>();
  for (const s of sessions) {
    if (!providerNameMap.has(s.providerId))
      providerNameMap.set(s.providerId, `${s.provider.firstName} ${s.provider.lastName}`);
  }
  for (const p of proposals) {
    if (!providerNameMap.has(p.providerId))
      providerNameMap.set(p.providerId, `${p.provider.firstName} ${p.provider.lastName}`);
  }

  // Group by provider, sort by start time, find consecutive pairs where destination is HOME
  const byProv = new Map<string, typeof allClientSlots>();
  for (const slot of allClientSlots) {
    if (!byProv.has(slot.providerId)) byProv.set(slot.providerId, []);
    byProv.get(slot.providerId)!.push(slot);
  }

  // Collect Drive Time sessions already in the DB so we can suppress computed pseudo-events
  // for gaps that already have a real session. Avoids double-rendering the same gap.
  const driveTimeSessions = sessions.filter((s) => s.sessionType.name === "Drive Time");
  const driveTimeGaps = new Set(
    driveTimeSessions.map((s) => `${s.providerId}|${s.startTime.getTime()}`)
  );

  const candidates: DriveCandidate[] = [];
  for (const slots of byProv.values()) {
    const sorted = slots.slice().sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      // Drive blocks are needed whenever the provider physically moves. Skip cases
      // where they stay put at the same fixed location (CENTER→CENTER, SCHOOL→SCHOOL).
      const sameFixed =
        (a.locationType === "CENTER" && b.locationType === "CENTER") ||
        (a.locationType === "SCHOOL" && b.locationType === "SCHOOL");
      if (sameFixed) continue;
      // Destination is fixed-location (CENTER/SCHOOL) only when b is non-HOME
      const destIsFixed = b.locationType !== "HOME";
      // Skip if a real Drive Time session already starts at a.endTime for this provider
      if (driveTimeGaps.has(`${a.providerId}|${a.endTime.getTime()}`)) continue;
      // Need either an address string OR lat/lng for both origin and destination.
      // For HOME→CENTER/SCHOOL the destination is a fixed location — use b.fromAddress.
      const destAddress = destIsFixed ? b.fromAddress : b.clientAddress;
      const destLat = destIsFixed ? b.fromLat : b.clientLat;
      const destLng = destIsFixed ? b.fromLng : b.clientLng;
      const aHasLocation = a.fromAddress !== null || (a.fromLat !== null && a.fromLng !== null);
      const bHasLocation = destAddress !== null || (destLat !== null && destLng !== null);
      if (a.endTime < b.startTime && aHasLocation && bHasLocation) {
        candidates.push({
          providerId: a.providerId,
          clientId: a.clientId,
          clientName: a.clientName,
          clientAddress: a.fromAddress,        // "from" address (client home or provider home)
          clientLat: a.fromLat,
          clientLng: a.fromLng,
          endTime: a.endTime,
          nextClientId: destIsFixed ? null : b.clientId,
          nextClientName: destIsFixed
            ? (b.locationType === "SCHOOL" ? "School" : "Center")
            : b.clientName,
          nextClientAddress: destAddress,
          nextClientLat: destLat,
          nextClientLng: destLng,
          nextStartTime: b.startTime,
        });
      }
    }
  }

  // Fetch drive times for all consecutive pairs in one Maps API call
  const driveEvents: Array<{
    id: string; title: string; start: string; end: string;
    backgroundColor: string; borderColor: string;
    extendedProps: {
      type: "drive"; sessionTypeName: string; clientId: null; providerId: string;
      providerName: string; driveMinutes: number; notes: string;
    };
  }> = [];
  if (candidates.length > 0 && process.env.GOOGLE_MAPS_API_KEY) {
    try {
      // Prefer address strings (geocoded accurately by Google); fall back to lat/lng
      const origins = candidates.map((c) =>
        c.clientAddress ?? { lat: c.clientLat!, lng: c.clientLng! }
      );
      const destinations = candidates.map((c) =>
        c.nextClientAddress ?? { lat: c.nextClientLat!, lng: c.nextClientLng! }
      );
      const { driveMinutes, distanceMeters } = await getDriveTimeMatrix(origins, destinations);

      candidates.forEach((c, i) => {
        const mins = driveMinutes[i]?.[i] ?? 0;
        if (mins <= 0) return;
        // Round up to the nearest 15 min; remainder is "Misc. Setup and Parking Allocation"
        const roundedMins = Math.ceil(mins / 15) * 15;
        const driveEnd = new Date(c.endTime.getTime() + roundedMins * 60_000);
        const routeNotes = JSON.stringify({
          fromClientId: c.clientId,
          fromName: c.clientName ?? c.clientId ?? "",
          fromAddress: c.clientAddress,
          fromLat: c.clientLat,
          fromLng: c.clientLng,
          toClientId: c.nextClientId,
          toName: c.nextClientName ?? c.nextClientId ?? "",
          toAddress: c.nextClientAddress,
          toLat: c.nextClientLat,
          toLng: c.nextClientLng,
          driveMinutes: mins,
          distanceMeters: distanceMeters[i]?.[i] ?? 0,
        });
        driveEvents.push({
          id: `drive-${c.providerId}-${i}`,
          title: `Drive · ${mins} min`,
          start: c.endTime.toISOString(),
          end: driveEnd.toISOString(),
          backgroundColor: "#e2e8f0",
          borderColor: "#94a3b8",
          extendedProps: {
            type: "drive" as const,
            sessionTypeName: "Drive",
            clientId: null,
            providerId: c.providerId,
            providerName: providerNameMap.get(c.providerId) ?? "Provider",
            driveMinutes: mins,
            notes: routeNotes,
          },
        });
      });
    } catch (err) {
      console.warn("[sessions] Drive time fetch failed:", err);
    }
  }

  // ── Block events (ProviderBlock + ClientBlock) ─────────────────────────────
  // Return rest-of-day blocks so ResourceTimeline can render light red stripes.

  const centerTz = center?.timezone ?? "America/New_York"; // reuse the center already fetched above

  // Helper: convert a block's date + "HH:MM" local time → UTC Date
  function blockTimeToUTC(blockDate: Date, timeStr: string): Date {
    const dateStr = blockDate.toISOString().split("T")[0];
    const [h, m] = timeStr.replace("24", "0").split(":").map(Number);
    const [y, mo, d] = dateStr.split("-").map(Number);

    // Probe noon UTC to find the UTC offset in this timezone on this date
    const noonUTC = new Date(`${dateStr}T12:00:00Z`);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: centerTz, hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(noonUTC);
    const nh = parseInt(parts.find(p => p.type === "hour")?.value ?? "12");
    const nm = parseInt(parts.find(p => p.type === "minute")?.value ?? "0");
    const localNoonMinutes = (nh === 24 ? 0 : nh) * 60 + nm;
    const offsetMinutes = localNoonMinutes - 12 * 60; // local noon - UTC noon

    return new Date(Date.UTC(y, mo - 1, d, h, m) - offsetMinutes * 60 * 1000);
  }

  const blockDateStart = new Date(startDate);
  blockDateStart.setUTCHours(0, 0, 0, 0);
  // Derive blockDateEnd from blockDateStart (not endDate) so both share the same UTC calendar date.
  // endDate for EDT (UTC-4) is 03:59 UTC the *next* day — using it as the base causes
  // setUTCHours(23,59,59) to push into the next day's UTC range, which pulls in tomorrow's
  // blocks onto today's timeline.
  const blockDateEnd = new Date(blockDateStart);
  blockDateEnd.setUTCHours(23, 59, 59, 999);

  const [providerBlocks, clientBlocks] = await Promise.all([
    prisma.providerBlock.findMany({
      where: {
        date: { gte: blockDateStart, lte: blockDateEnd },
        ...(providerId ? { providerId } : {}),
      },
    }),
    prisma.clientBlock.findMany({
      where: {
        date: { gte: blockDateStart, lte: blockDateEnd },
        ...(clientId ? { clientId } : {}),
      },
    }),
  ]);

  const blockEvents = [
    ...providerBlocks.map(b => ({
      id: `provider-block-${b.id}`,
      title: "Blocked",
      start: blockTimeToUTC(b.date, b.startTime).toISOString(),
      end: blockTimeToUTC(b.date, b.endTime).toISOString(),
      backgroundColor: "#fecaca",
      extendedProps: {
        type: "block" as const,
        sessionTypeName: "Block",
        blockParty: "PROVIDER" as const,
        clientId: null,
        providerId: b.providerId,
      },
    })),
    ...clientBlocks.map(b => ({
      id: `client-block-${b.id}`,
      title: "Blocked",
      start: blockTimeToUTC(b.date, b.startTime).toISOString(),
      end: blockTimeToUTC(b.date, b.endTime).toISOString(),
      backgroundColor: "#fecaca",
      extendedProps: {
        type: "block" as const,
        sessionTypeName: "Block",
        blockParty: "CLIENT" as const,
        clientId: b.clientId,
        providerId: null,
      },
    })),
  ];

  return NextResponse.json({ events: [...sessionEvents, ...proposalEvents, ...driveEvents, ...blockEvents] });
}
