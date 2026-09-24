import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WireGuard",
  description: "MikroTik WireGuard peer manager",
  icons: {
    icon: "/logo.svg",
    shortcut: "/logo.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
