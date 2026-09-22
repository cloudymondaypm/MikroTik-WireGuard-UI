"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

function WireMark() {
  return (
    <svg width="27" height="34" viewBox="0 0 27 34" aria-hidden="true">
      <path d="M15.7 2.5c-3.4 0-5.7 2.1-5.7 5.1 0 1.8.8 3 2.1 4.1-3.9.9-6.3 3.8-6.3 7.2 0 4.6 3.4 8.2 8.2 8.2 4.6 0 8-3.2 8-7.5 0-3-1.6-5.3-4.6-7.1 1.6-1.3 2.5-2.9 2.5-4.9 0-2.9-1.8-5.1-4.2-5.1Zm-.5 4.1c.8 0 1.4.6 1.4 1.4 0 .9-.6 1.6-1.6 2.2-.7-.5-1.2-1.1-1.2-2 0-1 .6-1.6 1.4-1.6Zm-1.3 9.1c2.5 0 4.3 1.5 4.3 3.8 0 2.2-1.6 3.8-4 3.8-2.6 0-4.4-1.7-4.4-4 0-2.1 1.6-3.6 4.1-3.6Z" fill="currentColor"/>
      <path d="M12.7 11.2 9 6.7l2.8-1.4 3.6 4.2-2.7 1.7Z" fill="currentColor"/>
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Login failed");
      }
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand brand-login">
          <span className="wire-mark"><WireMark /></span>
          <span>WireGuard</span>
        </div>
        <p className="login-subtitle">MikroTik peer manager</p>
        <form onSubmit={submit} className="login-form">
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
          </label>
          {error && <div className="error-box">{error}</div>}
          <button className="primary-wide" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</button>
        </form>
      </section>
    </main>
  );
}
