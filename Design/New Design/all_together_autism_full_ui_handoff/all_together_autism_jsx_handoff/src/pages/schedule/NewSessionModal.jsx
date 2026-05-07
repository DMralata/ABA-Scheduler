import React from "react";
import { CalendarPlus, Sparkles } from "lucide-react";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";

function Field({ label, helper, children }) {
  return (
    <label style={{ display: "block", marginBottom: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{label}</div>
      {children}
      {helper && <div style={{ marginTop: 6, fontSize: 12, color: "var(--ata-gray-500)" }}>{helper}</div>}
    </label>
  );
}

export default function NewSessionModal({ open = true, onClose = () => {} }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Session"
      subtitle="Create a new session on the schedule"
      icon={<CalendarPlus size={28} color="var(--ata-blue-600)" />}
      footer={
        <>
          <Button fullWidth iconLeft={<CalendarPlus size={16} />}>Book Session</Button>
          <Button variant="secondary" style={{ width: 150 }} onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <div style={{ height: 72, borderRadius: 12, border: "1px solid var(--ata-blue-100)", background: "var(--ata-blue-25)", display: "grid", gridTemplateColumns: "1fr 1fr", marginBottom: 24 }}>
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: "var(--ata-gray-500)", fontWeight: 700 }}>Duration</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>1h 00m</div>
        </div>
        <div style={{ padding: 16, borderLeft: "1px solid var(--ata-blue-100)" }}>
          <div style={{ fontSize: 12, color: "var(--ata-gray-500)", fontWeight: 700 }}>Setting</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Not set</div>
        </div>
      </div>

      <Field label="Session Type" helper="Choose the type of session to schedule.">
        <select className="ata-input" style={{ width: "100%" }} defaultValue="">
          <option value="" disabled>Select type...</option>
          <option>Direct Therapy Home</option>
          <option>Direct Therapy</option>
          <option>Supervision</option>
          <option>Parent Training</option>
        </select>
      </Field>

      <Field label="Client (optional for non-billable)" helper="Select a client to associate with this session.">
        <select className="ata-input" style={{ width: "100%" }} defaultValue="">
          <option value="" disabled>Select client...</option>
          <option>Olivia Davis</option>
          <option>Jackson, Mia</option>
        </select>
      </Field>

      <Field label="Session Name" helper="A descriptive name will be generated automatically.">
        <input className="ata-input" style={{ width: "100%" }} placeholder="Auto-generated from session type and client" />
      </Field>

      <Field label="Provider" helper="Choose the provider for this session.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 148px", gap: 12 }}>
          <select className="ata-input" defaultValue="">
            <option value="" disabled>Select provider...</option>
            <option>Ashley Chen</option>
          </select>
          <Button variant="secondary" iconLeft={<Sparkles size={16} />}>Find best match</Button>
        </div>
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Field label="Start">
          <input className="ata-input" style={{ width: "100%" }} defaultValue="04/30/2026, 09:00 AM" />
        </Field>
        <Field label="End">
          <input className="ata-input" style={{ width: "100%" }} defaultValue="04/30/2026, 10:00 AM" />
        </Field>
      </div>

      <Field label="Notes (optional)" helper="Add any relevant details for this session.">
        <textarea className="ata-input" style={{ width: "100%", height: 88, paddingTop: 12, resize: "vertical" }} placeholder="Any notes..." />
      </Field>
    </Modal>
  );
}
