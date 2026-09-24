"use client";

import { useRouter } from "next/navigation";
import ConfigForm from "../config-form";

export default function SetupPage() {
  const router = useRouter();

  return (
    <main className="settings-shell">
      <section className="settings-card">
        <div className="settings-brand">
          <div className="brand brand-login">
            <span className="wire-mark"><img className="brand-logo" src="/logo.svg" alt="" aria-hidden="true" /></span>
            <span>WireGuard</span>
          </div>
          <p>First-time setup</p>
        </div>
        <div className="setup-note">
          Configure the web admin account, MikroTik REST connection, and WireGuard client defaults. Settings are stored in the Docker data volume, not in the repository.
        </div>
        <ConfigForm mode="setup" onSaved={() => router.replace("/login")} />
      </section>
    </main>
  );
}
