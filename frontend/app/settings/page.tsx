"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ConfigForm, { AppConfig } from "../config-form";

type PublicSettings = Partial<AppConfig> & {
  app_password_set?: boolean;
  mikrotik_password_set?: boolean;
};

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) {
          router.replace("/login");
          return null;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || "Unable to load settings");
        return data;
      })
      .then((data) => data && setSettings(data))
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load settings"));
  }, [router]);

  async function saved(result: { reauth_required?: boolean }) {
    if (result.reauth_required) {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      return;
    }
    router.replace("/");
  }

  return (
    <main className="settings-shell">
      <section className="settings-card">
        <div className="settings-head">
          <div>
            <h1>Configuration</h1>
            <p>MikroTik connection, login, and generated client settings.</p>
          </div>
          <button className="ghost back-button" onClick={() => router.push("/")}><ArrowLeft size={16} /> Back</button>
        </div>
        {error && <div className="error-box">{error}</div>}
        {!settings && !error ? (
          <div className="loading-row"><Loader2 className="spin" size={22} /> Loading configuration…</div>
        ) : settings ? (
          <ConfigForm
            mode="settings"
            initial={settings}
            passwordAlreadySet={Boolean(settings.app_password_set)}
            routerPasswordAlreadySet={Boolean(settings.mikrotik_password_set)}
            onSaved={saved}
          />
        ) : null}
      </section>
    </main>
  );
}
