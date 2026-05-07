import React from "react";
import { AlertTriangle, CalendarX, Trash2 } from "lucide-react";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";

export default function CancelSessionModal({ open = true, onClose = () => {} }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeOnOverlayClick={false}
      title="Cancel Session"
      icon={<AlertTriangle size={26} color="var(--ata-danger-600)" />}
    >
      <div style={{ height: 92, padding: "18px 20px", background: "var(--ata-blue-25)", border: "1px solid var(--ata-blue-100)", borderRadius: 14, display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
        <span className="ata-avatar" style={{ width: 52, height: 52, background: "var(--ata-purple-500)" }}>MJ</span>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Jackson, Mia</div>
          <div style={{ color: "var(--ata-gray-600)", fontSize: 14 }}>Direct Therapy Home · Apr 30 at 9:00 AM</div>
        </div>
      </div>

      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Cancelled by</div>
      <div style={{ height: 56, display: "grid", gridTemplateColumns: "1fr 1fr", border: "1px solid var(--ata-gray-200)", borderRadius: 12, overflow: "hidden", marginBottom: 20 }}>
        <button type="button" style={{ border: "2px solid var(--ata-blue-600)", background: "var(--ata-blue-50)", color: "var(--ata-blue-700)", fontWeight: 800 }}>Client</button>
        <button type="button" style={{ border: 0, background: "#fff", color: "var(--ata-gray-700)", fontWeight: 700 }}>Provider</button>
      </div>

      <label style={{ display: "block", marginBottom: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Reason</div>
        <select className="ata-input" style={{ width: "100%", height: 52 }} defaultValue="">
          <option value="" disabled>Select reason...</option>
          <option>Illness</option>
          <option>Weather</option>
          <option>Family request</option>
          <option>Provider unavailable</option>
        </select>
      </label>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <Button variant="danger" size="lg" iconLeft={<Trash2 size={16} />}>Cancel Session</Button>
        <Button variant="secondary" size="lg" style={{ width: 132 }} onClick={onClose}>Keep</Button>
      </div>

      <div style={{ padding: 18, borderRadius: 14, background: "var(--ata-danger-50)", border: "1px solid var(--ata-danger-100)", display: "flex", gap: 16, marginBottom: 18 }}>
        <CalendarX size={24} color="var(--ata-danger-600)" />
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ata-danger-700)" }}>Cancel Client&apos;s Rest of Day</div>
          <div style={{ marginTop: 4, color: "var(--ata-danger-700)", fontSize: 13, lineHeight: 1.45 }}>
            Cancels all remaining sessions and blocks the schedule from this time forward.
          </div>
        </div>
      </div>

      <button type="button" style={{ height: 44, width: "100%", border: 0, background: "transparent", color: "var(--ata-gray-600)", fontWeight: 700 }}>
        Remove Session Without Cancelling
      </button>
    </Modal>
  );
}
