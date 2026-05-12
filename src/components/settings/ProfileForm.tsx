"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateUserProfile, updateUserPassword } from "@/lib/actions/users";

const POSITIONS = ["Manager", "BCBA", "BCaBA", "RBT", "Scheduler"];

type Props = {
  email: string;
  initialFirstName: string;
  initialLastName: string;
  initialPosition: string;
};

export function ProfileForm({
  email,
  initialFirstName,
  initialLastName,
  initialPosition,
}: Props) {
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [position, setPosition] = useState(initialPosition);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMsg(null);
    updateUserProfile({ firstName, lastName, position })
      .then((res) => {
        setSavingProfile(false);
        if (res.success) setProfileMsg({ kind: "ok", text: "Profile updated." });
        else setProfileMsg({ kind: "err", text: res.error });
      })
      .catch(() => {
        setSavingProfile(false);
        setProfileMsg({ kind: "err", text: "Failed to update profile." });
      });
  }

  function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (newPassword !== confirmPassword) {
      setPwMsg({ kind: "err", text: "Passwords do not match." });
      return;
    }
    setSavingPw(true);
    updateUserPassword(newPassword)
      .then((res) => {
        setSavingPw(false);
        if (res.success) {
          setPwMsg({ kind: "ok", text: "Password updated." });
          setNewPassword("");
          setConfirmPassword("");
        } else {
          setPwMsg({ kind: "err", text: res.error });
        }
      })
      .catch(() => {
        setSavingPw(false);
        setPwMsg({ kind: "err", text: "Failed to update password." });
      });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <section
        style={{
          background: "#FFFFFF",
          border: "1px solid var(--ata-gray-200)",
          borderRadius: 12,
          padding: 20,
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: "var(--ata-gray-900)" }}>
          Personal details
        </h2>
        <form onSubmit={saveProfile} style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input value={email} disabled />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="space-y-1.5">
              <Label>First name</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>Last name</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Position</Label>
            <Select value={position} onValueChange={(v) => setPosition(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Select position…" />
              </SelectTrigger>
              <SelectContent>
                {POSITIONS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {profileMsg && (
            <div
              style={{
                fontSize: 12,
                color: profileMsg.kind === "ok" ? "var(--ata-success-700, #15803d)" : "var(--ata-danger-700, #b91c1c)",
              }}
            >
              {profileMsg.text}
            </div>
          )}

          <div>
            <Button type="submit" disabled={savingProfile}>
              {savingProfile ? "Saving…" : "Save profile"}
            </Button>
          </div>
        </form>
      </section>

      <section
        style={{
          background: "#FFFFFF",
          border: "1px solid var(--ata-gray-200)",
          borderRadius: 12,
          padding: 20,
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: "var(--ata-gray-900)" }}>
          Change password
        </h2>
        <form onSubmit={savePassword} style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="space-y-1.5">
            <Label>New password</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Confirm new password</Label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              autoComplete="new-password"
            />
          </div>

          {pwMsg && (
            <div
              style={{
                fontSize: 12,
                color: pwMsg.kind === "ok" ? "var(--ata-success-700, #15803d)" : "var(--ata-danger-700, #b91c1c)",
              }}
            >
              {pwMsg.text}
            </div>
          )}

          <div>
            <Button type="submit" disabled={savingPw || !newPassword || !confirmPassword}>
              {savingPw ? "Saving…" : "Update password"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
