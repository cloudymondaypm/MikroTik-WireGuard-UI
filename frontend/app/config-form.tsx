"use client";

import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Save } from "lucide-react";

export type AppConfig = {
  app_username: string;
  app_password: string;
  cookie_secure: boolean;
  session_hours: number;
  mikrotik_host: string;
  mikrotik_username: string;
  mikrotik_password: string;
  mikrotik_rest_scheme: string;
  mikrotik_rest_port: number;
  mikrotik_verify_tls: boolean;
  mikrotik_wg_interface: string;
  client_pool_cidr: string;
  wg_endpoint_host: string;
  wg_client_dns: string;
  wg_client_allowed_ips: string;
  wg_persistent_keepalive: number;
};

type Props = {
  mode: "setup" | "settings";
  initial?: Partial<AppConfig>;
  passwordAlreadySet?: boolean;
  routerPasswordAlreadySet?: boolean;
  onSaved: (result: { reauth_required?: boolean }) => void;
};

const defaults: AppConfig = {
  app_username: "admin",
  app_password: "",
  cookie_secure: false,
  session_hours: 12,
  mikrotik_host: "",
  mikrotik_username: "",
  mikrotik_password: "",
  mikrotik_rest_scheme: "https",
  mikrotik_rest_port: 443,
  mikrotik_verify_tls: false,
  mikrotik_wg_interface: "wireguard1",
  client_pool_cidr: "10.120.0.0/24",
  wg_endpoint_host: "",
  wg_client_dns: "1.1.1.1",
  wg_client_allowed_ips: "0.0.0.0/0",
  wg_persistent_keepalive: 25,
};

export default function ConfigForm({
  mode,
  initial,
  passwordAlreadySet = false,
  routerPasswordAlreadySet = false,
  onSaved,
}: Props) {
  const [form, setForm] = useState<AppConfig>({ ...defaults, ...initial });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setForm({ ...defaults, ...initial, app_password: "", mikrotik_password: "" });
  }, [initial]);

  function set<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setForm((old) => ({ ...old, [key]: value }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(mode === "setup" ? "/api/setup" : "/api/settings", {
        method: mode === "setup" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Unable to save configuration");
      setMessage("Configuration saved.");
      onSaved(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save configuration");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/settings/test", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error("Save the configuration and sign in before testing the router connection.");
      if (!res.ok) throw new Error(data.detail || "Connection test failed");
      setMessage(`Connected to RouterOS ${data.version || ""}${data.board ? ` on ${data.board}` : ""}. Interface: ${data.interface || "OK"}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection test failed");
    } finally {
      setTesting(false);
    }
  }

  return (
    <form className="config-form" onSubmit={submit}>
      <section className="config-section">
        <h2>Web Admin</h2>
        <div className="config-grid">
          <label>Username<input value={form.app_username} onChange={(e) => set("app_username", e.target.value)} required /></label>
          <label>
            Password
            <small>{mode === "settings" && passwordAlreadySet ? "leave blank to keep current" : "minimum 12 characters"}</small>
            <input type="password" value={form.app_password} onChange={(e) => set("app_password", e.target.value)} required={mode === "setup"} minLength={mode === "setup" ? 12 : undefined} />
          </label>
          <label>Session hours<input type="number" min={1} max={168} value={form.session_hours} onChange={(e) => set("session_hours", Number(e.target.value))} required /></label>
          <label className="check-label"><input type="checkbox" checked={form.cookie_secure} onChange={(e) => set("cookie_secure", e.target.checked)} /> Secure cookie <small>enable when the app itself is served over HTTPS</small></label>
        </div>
      </section>

      <section className="config-section">
        <h2>MikroTik RouterOS REST API</h2>
        <div className="config-grid">
          <label>Router host / IP<input placeholder="192.168.88.1" value={form.mikrotik_host} onChange={(e) => set("mikrotik_host", e.target.value)} required /></label>
          <label>REST username<input placeholder="wg-ui" value={form.mikrotik_username} onChange={(e) => set("mikrotik_username", e.target.value)} required /></label>
          <label>
            REST password
            <small>{mode === "settings" && routerPasswordAlreadySet ? "leave blank to keep current" : ""}</small>
            <input type="password" value={form.mikrotik_password} onChange={(e) => set("mikrotik_password", e.target.value)} required={mode === "setup"} />
          </label>
          <label>WireGuard interface<input placeholder="wireguard1" value={form.mikrotik_wg_interface} onChange={(e) => set("mikrotik_wg_interface", e.target.value)} required /></label>
          <label>REST scheme<select value={form.mikrotik_rest_scheme} onChange={(e) => set("mikrotik_rest_scheme", e.target.value)}><option value="https">https</option><option value="http">http</option></select></label>
          <label>REST port<input type="number" min={1} max={65535} value={form.mikrotik_rest_port} onChange={(e) => set("mikrotik_rest_port", Number(e.target.value))} required /></label>
          <label className="check-label"><input type="checkbox" checked={form.mikrotik_verify_tls} onChange={(e) => set("mikrotik_verify_tls", e.target.checked)} /> Verify router TLS certificate <small>leave unchecked for a self-signed certificate on a trusted private network; a mismatch here shows as &quot;certificate verify failed&quot;</small></label>
        </div>
      </section>

      <section className="config-section">
        <h2>WireGuard Client Defaults</h2>
        <div className="config-grid">
          <label>Client pool CIDR<input placeholder="10.120.0.0/24" value={form.client_pool_cidr} onChange={(e) => set("client_pool_cidr", e.target.value)} required /></label>
          <label>Public endpoint / DDNS<input placeholder="vpn.example.com" value={form.wg_endpoint_host} onChange={(e) => set("wg_endpoint_host", e.target.value)} required /></label>
          <label>DNS server<input placeholder="1.1.1.1" value={form.wg_client_dns} onChange={(e) => set("wg_client_dns", e.target.value)} /></label>
          <label>Allowed IPs<input placeholder="0.0.0.0/0" value={form.wg_client_allowed_ips} onChange={(e) => set("wg_client_allowed_ips", e.target.value)} required /></label>
          <label>Persistent keepalive<input type="number" min={0} max={65535} value={form.wg_persistent_keepalive} onChange={(e) => set("wg_persistent_keepalive", Number(e.target.value))} /></label>
        </div>
      </section>

      {error && <div className="error-box">{error}</div>}
      {message && <div className="success-box"><CheckCircle2 size={16} />{message}</div>}

      <div className="config-actions">
        {mode === "settings" && <button type="button" className="ghost" onClick={testConnection} disabled={testing || saving}>{testing ? <Loader2 className="spin" size={16} /> : null}{testing ? "Testing…" : "Test connection"}</button>}
        <button className="primary config-save" disabled={saving || testing}>{saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}{saving ? "Saving…" : mode === "setup" ? "Finish setup" : "Save configuration"}</button>
      </div>
    </form>
  );
}
