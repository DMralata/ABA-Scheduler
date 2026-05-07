import { MessageCircle } from "lucide-react";

export default function CommunicationsEmptyState() {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        color: "var(--ata-gray-500)",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 9999,
          background: "var(--ata-blue-50)",
          color: "var(--ata-blue-600)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 16,
        }}
      >
        <MessageCircle size={28} />
      </div>
      <h2
        style={{
          fontSize: 18,
          lineHeight: "26px",
          fontWeight: 800,
          color: "var(--ata-gray-900)",
          margin: 0,
        }}
      >
        Select a conversation
      </h2>
      <p
        style={{
          fontSize: 14,
          lineHeight: "20px",
          color: "var(--ata-gray-500)",
          marginTop: 6,
          maxWidth: 360,
        }}
      >
        Pick a thread from the left to view messages and reply. Inbound
        messages from clients and providers appear here automatically.
      </p>
    </div>
  );
}
