"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type ClientSummary = {
  type: "client";
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  gender: string | null;
  insurance: string | null;
  spanish: boolean;
  femaleProviderOnly: boolean;
  preferredLocation: string;
  minimumRbtLevel: string | null;
  activeDate: string | null;
  terminationDate: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

type ProviderSummary = {
  type: "provider";
  id: string;
  firstName: string;
  lastName: string;
  status: string;
  position: string;
  rbtLevel: string | null;
  gender: string | null;
  spanish: boolean;
  payRateHourly: number | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

type ProfileSummary = ClientSummary | ProviderSummary;

// ── Helpers ───────────────────────────────────────────────────────────────────

function clientStatus(c: ClientSummary) {
  const now = new Date();
  const term   = c.terminationDate ? new Date(c.terminationDate) : null;
  const active = c.activeDate      ? new Date(c.activeDate)      : null;
  if (term && term <= now)   return { label: "Discharged", style: "bg-red-50 text-red-700 border-red-200" };
  if (active && active > now) return { label: "Intake",    style: "bg-amber-50 text-amber-700 border-amber-200" };
  return { label: "Active", style: "bg-green-50 text-green-700 border-green-200" };
}

const PROVIDER_STATUS_LABELS: Record<string, string> = {
  ACTIVE:   "Active",
  INACTIVE: "Inactive",
  ON_LEAVE: "On Leave",
};

const PROVIDER_STATUS_STYLES: Record<string, string> = {
  ACTIVE:   "bg-green-50 text-green-700 border-green-200",
  INACTIVE: "bg-red-50 text-red-700 border-red-200",
  ON_LEAVE: "bg-amber-50 text-amber-700 border-amber-200",
};

const POSITION_LABEL: Record<string, string> = {
  BCBA:  "Board Certified Behavior Analyst",
  BCaBA: "Board Certified Assistant Behavior Analyst",
  RBT:   "Registered Behavior Technician",
};

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(new Date(iso));
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-baseline gap-4 py-2 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs font-medium text-right">{value}</span>
    </div>
  );
}

function StatusBadge({ label, style }: { label: string; style: string }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border", style)}>
      {label}
    </span>
  );
}

// ── Profile content ───────────────────────────────────────────────────────────

function ClientContent({ c }: { c: ClientSummary }) {
  const { label, style } = clientStatus(c);
  const address = [c.street, c.city, c.state, c.zip].filter(Boolean).join(", ");
  return (
    <div className="space-y-4">
      <div>
        <Row label="Status"     value={<StatusBadge label={label} style={style} />} />
        {c.dateOfBirth          && <Row label="DOB"               value={fmtDate(c.dateOfBirth)} />}
        {c.gender               && <Row label="Gender"            value={<span className="capitalize">{c.gender}</span>} />}
        {c.insurance            && <Row label="Insurance"         value={c.insurance} />}
        <Row label="Spanish"           value={c.spanish ? "Yes" : "No"} />
        <Row label="Female Provider Only" value={c.femaleProviderOnly ? "Yes" : "No"} />
        <Row label="Preferred Location"   value={c.preferredLocation === "HOME" ? "Home" : "Center"} />
        {c.minimumRbtLevel      && <Row label="Min. RBT Level"    value={`Level ${c.minimumRbtLevel}`} />}
        {c.activeDate           && <Row label="Active Since"      value={fmtDate(c.activeDate)} />}
        {label === "Discharged" && c.terminationDate && (
          <Row label="Terminated" value={fmtDate(c.terminationDate)} />
        )}
      </div>
      {address && (
        <div className="pt-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Address</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{address}</p>
        </div>
      )}
    </div>
  );
}

function ProviderContent({ p }: { p: ProviderSummary }) {
  const statusStyle = PROVIDER_STATUS_STYLES[p.status] ?? "";
  const address = [p.street, p.city, p.state, p.zip].filter(Boolean).join(", ");
  return (
    <div className="space-y-4">
      <div>
        <Row label="Status"   value={<StatusBadge label={PROVIDER_STATUS_LABELS[p.status] ?? p.status} style={statusStyle} />} />
        <Row label="Position" value={p.position} />
        {p.rbtLevel           && <Row label="RBT Level" value={`Level ${p.rbtLevel}`} />}
        {p.gender             && <Row label="Gender"    value={<span className="capitalize">{p.gender}</span>} />}
        <Row label="Spanish"    value={p.spanish ? "Yes" : "No"} />
        {p.payRateHourly      && <Row label="Pay Rate"  value={`$${p.payRateHourly}/hr`} />}
      </div>
      {address && (
        <div className="pt-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Address</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{address}</p>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ProfileSheetProps {
  entityId: string;
  entityType: "client" | "provider";
  children: React.ReactNode;
}

export function ProfileSheet({ entityId, entityType, children }: ProfileSheetProps) {
  const [open, setOpen]       = useState(false);
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  function handleOpen(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation();
    setOpen(true);
    if (!profile && !loading) {
      setLoading(true);
      setFetchError(false);
      fetch(`/api/profile?type=${entityType}&id=${entityId}`)
        .then(r => r.json())
        .then(data => { setProfile(data); setLoading(false); })
        .catch(() => { setFetchError(true); setLoading(false); });
    }
  }

  const basePath = entityType === "client" ? "clients" : "providers";
  const subtitle = profile
    ? entityType === "provider"
      ? `${(profile as ProviderSummary).position} — ${POSITION_LABEL[(profile as ProviderSummary).position]}`
      : "Client"
    : null;

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        onClick={handleOpen}
        onKeyDown={e => e.key === "Enter" && handleOpen(e)}
        className="hover:underline cursor-pointer"
      >
        {children}
      </span>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="schedule-warm flex flex-col p-0 gap-0">
          <SheetHeader className="px-5 pt-5 pb-4 border-b border-border gap-0.5">
            <SheetTitle>
              {profile
                ? `${profile.firstName} ${profile.lastName}`
                : loading ? "Loading…" : "Profile"}
            </SheetTitle>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {loading && (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}
            {fetchError && (
              <p className="text-sm text-destructive">Failed to load profile.</p>
            )}
            {profile && profile.type === "client" && <ClientContent c={profile} />}
            {profile && profile.type === "provider" && <ProviderContent p={profile} />}
          </div>

          <SheetFooter className="px-5 pb-5 pt-4 border-t border-border flex-row gap-2">
            <Link href={`/${basePath}/${entityId}`} className="flex-1" onClick={() => setOpen(false)}>
              <Button variant="outline" size="sm" className="w-full">
                View Full Profile
              </Button>
            </Link>
            <Link href={`/${basePath}/${entityId}/edit`} className="flex-1" onClick={() => setOpen(false)}>
              <Button size="sm" className="w-full">
                Edit Profile
              </Button>
            </Link>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
