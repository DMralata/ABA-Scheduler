"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    window.location.href = "/dashboard";
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--ata-bg)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <span
            style={{
              display: "inline-flex",
              width: 56,
              height: 56,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)",
              color: "#FFFFFF",
              boxShadow: "0 8px 22px rgba(37,99,235,0.30)",
              marginBottom: 16,
            }}
            aria-hidden
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <circle cx="9" cy="12" r="4.5" />
              <circle cx="15" cy="12" r="4.5" />
            </svg>
          </span>
          <h1
            style={{
              fontSize: 24,
              lineHeight: "30px",
              fontWeight: 800,
              color: "var(--ata-gray-900)",
              letterSpacing: "-0.01em",
              margin: 0,
            }}
          >
            All Together Autism
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "var(--ata-gray-600)",
              margin: "6px 0 0",
            }}
          >
            Sign in to your account
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{
            background: "#FFFFFF",
            border: "1px solid var(--ata-gray-200)",
            borderRadius: 16,
            padding: 24,
            boxShadow: "var(--shadow-sm)",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {error && (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                fontSize: 13,
                color: "var(--ata-danger-700)",
                background: "var(--ata-danger-50)",
                border: "1px solid var(--ata-danger-100)",
              }}
            >
              {error}
            </div>
          )}
          <div>
            <label
              htmlFor="email"
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--ata-gray-700)",
                marginBottom: 6,
              }}
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="ata-input"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--ata-gray-700)",
                marginBottom: 6,
              }}
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="ata-input"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="ata-btn ata-btn--primary ata-btn--lg ata-btn--full"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
