// GET  /api/communications/messages/:id  — full message detail
// PATCH /api/communications/messages/:id  — update status
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { InboundMessageStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getMessageById } from "@/lib/queries/communications";
import { writeAuditLog } from "@/lib/audit";

async function getUser() {
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
  return user;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const message = await getMessageById(id);
  if (!message)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(message);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = (await request.json()) as { status?: string };

  const validStatuses = ["UNREAD", "READ", "ACTIONED", "DISMISSED"];
  if (!body.status || !validStatuses.includes(body.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const updated = await prisma.inboundMessage.update({
    where: { id },
    data: { status: body.status as InboundMessageStatus },
  });

  await writeAuditLog({
    action: "UPDATE",
    resourceType: "InboundMessage",
    resourceId: id,
    metadata: { status: body.status },
  });

  return NextResponse.json(updated);
}
