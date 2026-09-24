"use client";

import {
  Archive,
  Check,
  Copy,
  Download,
  Loader2,
  LogOut,
  Moon,
  Plus,
  QrCode,
  RefreshCcw,
  Settings,
  Sun,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "react-qr-code";

type Client = {
  id: string;
  name: string;
  address: string;
  enabled: boolean;
  managed: boolean;
  publicKey: string;
  lastHandshake?: string;
  rx?: string;
  tx?: string;
  rxRate?: number;
  txRate?: number;
};

type TrafficSample = {
  rx: number;
  tx: number;
  at: number;
};

const ONLINE_WINDOW_SECONDS = 180;
const LIVE_REFRESH_MS = 2000;

function counterValue(value?: string | number | null) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function parseRouterDurationSeconds(value?: string | number | null): number | null {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw || raw === "never") return null;

  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);

  const clock = raw.match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (clock) {
    return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  }

  const unitPattern = /(\d+(?:\.\d+)?)\s*(w|d|h|m|s)/g;
  const multipliers: Record<string, number> = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
  let total = 0;
  let matched = false;
  let match: RegExpExecArray | null;
  while ((match = unitPattern.exec(raw)) !== null) {
    matched = true;
    total += Number(match[1]) * multipliers[match[2]];
  }
  if (matched && raw.replace(unitPattern, "").trim() === "") return total;

  return null;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1000 && unit < units.length - 1) {
    size /= 1000;
    unit += 1;
  }
  return unit === 0 ? `${Math.round(size)} B` : `${size.toFixed(2)} ${units[unit]}`;
}

function formatRate(value: number) {
  return `${formatBytes(value)}/s`;
}

function handshakeLabel(value?: string | number | null) {
  const seconds = parseRouterDurationSeconds(value);
  if (seconds === null || seconds === 0) return "Never";
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${Math.floor(seconds)} seconds ago`;
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(seconds / 86400);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function isClientOnline(client: Client) {
  if (!client.enabled) return false;
  const handshakeSeconds = parseRouterDurationSeconds(client.lastHandshake);
  const hasRecentHandshake = handshakeSeconds !== null && handshakeSeconds > 0 && handshakeSeconds <= ONLINE_WINDOW_SECONDS;
  const hasLiveTraffic = (client.rxRate ?? 0) > 0 || (client.txRate ?? 0) > 0;
  return hasRecentHandshake || hasLiveTraffic;
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, init);
  if (res.status === 401) throw new Error("AUTH");
  if (res.status === 503) throw new Error("SETUP");
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Request failed (${res.status})`);
  }
  return res;
}

export default function Home() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [dark, setDark] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [config, setConfig] = useState("");
  const [configName, setConfigName] = useState("");
  const [copied, setCopied] = useState(false);
  const restoreInput = useRef<HTMLInputElement>(null);
  const trafficSamples = useRef<Record<string, TrafficSample>>({});
  const refreshing = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (refreshing.current) return;
    refreshing.current = true;
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const res = await api("/api/clients", { cache: "no-store" });
      const incoming: Client[] = await res.json();
      const now = Date.now();
      const nextSamples: Record<string, TrafficSample> = {};

      const withRates = incoming.map((client) => {
        const key = client.id || client.publicKey;
        const rx = counterValue(client.rx);
        const tx = counterValue(client.tx);
        const previous = trafficSamples.current[key];
        const elapsed = previous ? Math.max((now - previous.at) / 1000, 0.25) : 0;
        const rxRate = previous && rx >= previous.rx ? (rx - previous.rx) / elapsed : 0;
        const txRate = previous && tx >= previous.tx ? (tx - previous.tx) / elapsed : 0;

        nextSamples[key] = { rx, tx, at: now };
        return { ...client, rxRate, txRate };
      });

      trafficSamples.current = nextSamples;
      setClients(withRates);
    } catch (err) {
      if (err instanceof Error && err.message === "AUTH") {
        router.replace("/login");
        return;
      }
      if (err instanceof Error && err.message === "SETUP") {
        router.replace("/setup");
        return;
      }
      setError(err instanceof Error ? err.message : "Unable to load clients");
    } finally {
      refreshing.current = false;
      if (!silent) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load(true), LIVE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  async function createClient() {
    if (!newName.trim()) return;
    setBusy("new");
    setError("");
    try {
      await api("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), address: newAddress.trim() || null }),
      });
      setNewOpen(false);
      setNewName("");
      setNewAddress("");
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create client");
    } finally {
      setBusy(null);
    }
  }

  async function toggle(client: Client) {
    setBusy(client.id);
    setClients((old) => old.map((c) => c.id === client.id ? { ...c, enabled: !c.enabled } : c));
    try {
      await api(`/api/clients/${encodeURIComponent(client.id)}/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !client.enabled }),
      });
    } catch (err) {
      setClients((old) => old.map((c) => c.id === client.id ? { ...c, enabled: client.enabled } : c));
      setError(err instanceof Error ? err.message : "Unable to update client");
    } finally {
      setBusy(null);
    }
  }

  async function remove(client: Client) {
    if (!window.confirm(`Delete ${client.name}? This removes the peer from MikroTik.`)) return;
    setBusy(client.id);
    try {
      await api(`/api/clients/${encodeURIComponent(client.id)}`, { method: "DELETE" });
      setClients((old) => old.filter((c) => c.id !== client.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete client");
    } finally {
      setBusy(null);
    }
  }

  async function getConfig(client: Client) {
    const res = await api(`/api/clients/${encodeURIComponent(client.id)}/config`, { cache: "no-store" });
    return await res.text();
  }

  async function showQr(client: Client) {
    setBusy(client.id);
    setError("");
    try {
      const text = await getConfig(client);
      setConfig(text);
      setConfigName(client.name);
      setQrOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to build client config");
    } finally {
      setBusy(null);
    }
  }

  async function downloadConfig(client: Client) {
    setBusy(client.id);
    setError("");
    try {
      const text = await getConfig(client);
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${client.name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase()}.conf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to download client config");
    } finally {
      setBusy(null);
    }
  }

  async function backup() {
    setBusy("backup");
    try {
      const res = await api("/api/backup", { cache: "no-store" });
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mikrotik-wireguard-backup-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backup failed");
    } finally {
      setBusy(null);
    }
  }

  async function restoreFile(file?: File) {
    if (!file) return;
    setBusy("restore");
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await api("/api/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setBusy(null);
      if (restoreInput.current) restoreInput.current.value = "";
    }
  }

  async function copyConfig() {
    await navigator.clipboard.writeText(config);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <main className="page-shell">
      <section className="content-wrap">
        <header className="topbar">
          <div className="brand">
            <span className="wire-mark"><img className="brand-logo" src="/logo.svg" alt="" aria-hidden="true" /></span>
            <span>WireGuard</span>
          </div>
          <div className="header-actions">
            <button className="config-button" onClick={() => router.push("/settings")}><Settings size={15} /> Config</button>
            <button className="theme-toggle" aria-label="Toggle theme" onClick={() => setDark((v) => !v)}>
              {dark ? <Sun size={18} /> : <Moon size={18} fill="currentColor" />}
            </button>
            <button className="logout-button" onClick={logout}>Logout <LogOut size={13} /></button>
          </div>
        </header>

        <section className="clients-card">
          <div className="clients-card-head">
            <h1>Clients</h1>
            <div className="card-actions">
              <input ref={restoreInput} hidden type="file" accept="application/json,.json" onChange={(e) => restoreFile(e.target.files?.[0])} />
              <button onClick={() => restoreInput.current?.click()} disabled={busy === "restore"}>
                {busy === "restore" ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}<span>Restore</span>
              </button>
              <button onClick={backup} disabled={busy === "backup"}>
                {busy === "backup" ? <Loader2 className="spin" size={16} /> : <Archive size={16} />}<span>Backup</span>
              </button>
              <button onClick={() => setNewOpen(true)}><Plus size={16} /><span>New</span></button>
            </div>
          </div>

          {error && <div className="inline-error">{error}<button onClick={() => setError("")}><X size={14}/></button></div>}

          <div className="client-list">
            {loading ? (
              <div className="loading-row"><Loader2 className="spin" size={22} /> Loading clients…</div>
            ) : clients.length === 0 ? (
              <div className="empty-row">No WireGuard peers found on the selected MikroTik interface.</div>
            ) : clients.map((client) => {
              const online = isClientOnline(client);
              const statusClass = !client.enabled ? "disabled" : online ? "online" : "offline";
              const statusTitle = !client.enabled ? "Disabled" : online ? "Online" : "Offline";
              return (
                <div className="client-row" key={client.id || client.publicKey}>
                  <div className="avatar">
                    <UserRound size={22} fill="currentColor" strokeWidth={0} />
                    <span className={`status-dot ${statusClass}`} title={statusTitle} aria-label={statusTitle} />
                  </div>
                  <div className="client-meta">
                    <div className="client-name">{client.name}</div>
                    <div className="client-subline">
                      <span className="client-address">{client.address}</span>
                      <span className="last-seen">{handshakeLabel(client.lastHandshake)}</span>
                    </div>
                  </div>
                  <div className="client-stats" aria-label={`Traffic for ${client.name}`}>
                    <div className="traffic-stat" title="Current receive rate">
                      <div className="traffic-rate"><span className="traffic-arrow">↓</span>{formatRate(client.rxRate ?? 0)}</div>
                      <div className="traffic-total">{formatBytes(counterValue(client.rx))}</div>
                    </div>
                    <div className="traffic-stat" title="Current transmit rate">
                      <div className="traffic-rate"><span className="traffic-arrow">↑</span>{formatRate(client.txRate ?? 0)}</div>
                      <div className="traffic-total">{formatBytes(counterValue(client.tx))}</div>
                    </div>
                  </div>
                  <div className="client-controls">
                    <button
                      className={`switch ${client.enabled ? "on" : "off"}`}
                      onClick={() => toggle(client)}
                      aria-label={client.enabled ? "Disable client" : "Enable client"}
                      disabled={busy === client.id}
                    ><span /></button>
                    <button className="icon-square" title={client.managed ? "Show QR code" : "Private key unavailable"} disabled={!client.managed || busy === client.id} onClick={() => showQr(client)}><QrCode size={18} /></button>
                    <button className="icon-square" title={client.managed ? "Download configuration" : "Private key unavailable"} disabled={!client.managed || busy === client.id} onClick={() => downloadConfig(client)}><Download size={18} /></button>
                    <button className="icon-square danger" title="Delete client" disabled={busy === client.id} onClick={() => remove(client)}><Trash2 size={18} fill="currentColor" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <footer>MikroTik WireGuard UI · RouterOS peer manager</footer>
      </section>

      {newOpen && (
        <div className="modal-backdrop" onMouseDown={() => setNewOpen(false)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head"><h2>New Client</h2><button onClick={() => setNewOpen(false)}><X size={19}/></button></div>
            <label>Client name<input placeholder="e.g. Nika Laptop" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus /></label>
            <label>IP address <small>optional</small><input placeholder="Auto from configured pool" value={newAddress} onChange={(e) => setNewAddress(e.target.value)} /></label>
            <div className="modal-actions"><button className="ghost" onClick={() => setNewOpen(false)}>Cancel</button><button className="primary" disabled={!newName.trim() || busy === "new"} onClick={createClient}>{busy === "new" ? "Creating…" : "Create"}</button></div>
          </div>
        </div>
      )}

      {qrOpen && (
        <div className="modal-backdrop" onMouseDown={() => setQrOpen(false)}>
          <div className="modal qr-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head"><h2>{configName}</h2><button onClick={() => setQrOpen(false)}><X size={19}/></button></div>
            <div className="qr-box"><QRCode value={config} size={248} /></div>
            <div className="qr-actions"><button className="ghost" onClick={copyConfig}>{copied ? <Check size={16}/> : <Copy size={16}/>} {copied ? "Copied" : "Copy config"}</button></div>
          </div>
        </div>
      )}
    </main>
  );
}
