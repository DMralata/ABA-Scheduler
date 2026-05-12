"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const POSITIONS = ["Manager", "BCBA", "Scheduler"] as const;

export default function SignupPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [position, setPosition] = useState<string>("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    let res: Response;
    try {
      res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, firstName, lastName, position }),
      });
    } catch (err) {
      setError(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
      setLoading(false);
      return;
    }

    const rawText = await res.text();
    let data: { error?: string } = {};
    try {
      data = JSON.parse(rawText) as { error?: string };
    } catch {
      // Non-JSON response — surface the raw body so we can see it
    }

    if (!res.ok) {
      setError(
        data.error ??
          `HTTP ${res.status} ${res.statusText} — ${rawText.slice(0, 300)}`,
      );
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(
        "Account created. Please sign in.",
      );
      setLoading(false);
      window.location.href = "/login";
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
            Create your account
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label
                htmlFor="firstName"
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--ata-gray-700)",
                  marginBottom: 6,
                }}
              >
                First name
              </label>
              <input
                id="firstName"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                autoComplete="given-name"
                className="ata-input"
              />
            </div>
            <div>
              <label
                htmlFor="lastName"
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--ata-gray-700)",
                  marginBottom: 6,
                }}
              >
                Last name
              </label>
              <input
                id="lastName"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                autoComplete="family-name"
                className="ata-input"
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="position"
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--ata-gray-700)",
                marginBottom: 6,
              }}
            >
              Position
            </label>
            <select
              id="position"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              required
              className="ata-input"
            >
              <option value="" disabled>
                Select your position
              </option>
              {POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
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
              Work email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@alltogetherautism.com"
              className="ata-input"
            />
            <p
              style={{
                fontSize: 12,
                color: "var(--ata-gray-500)",
                margin: "6px 0 0",
              }}
            >
              Only @alltogetherautism.com addresses are permitted.
            </p>
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
              minLength={12}
              autoComplete="new-password"
              className="ata-input"
            />
            <p
              style={{
                fontSize: 12,
                color: "var(--ata-gray-500)",
                margin: "6px 0 0",
              }}
            >
              At least 12 characters.
            </p>
          </div>
          <div>
            <label
              htmlFor="confirmPassword"
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--ata-gray-700)",
                marginBottom: 6,
              }}
            >
              Confirm password
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={12}
              autoComplete="new-password"
              className="ata-input"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="ata-btn ata-btn--primary ata-btn--lg ata-btn--full"
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
          <p
            style={{
              fontSize: 13,
              color: "var(--ata-gray-600)",
              margin: 0,
              textAlign: "center",
            }}
          >
            Already have an account?{" "}
            <Link
              href="/login"
              style={{ color: "var(--ata-primary-600)", fontWeight: 600 }}
            >
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
