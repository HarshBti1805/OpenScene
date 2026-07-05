import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource/big-shoulders-display/600.css";
import "@fontsource/big-shoulders-display/700.css";
import "@fontsource/courier-prime";
import "@fontsource/courier-prime/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenScene — Free, offline-first screenwriting",
  description:
    "A completely free, open-source, offline-first professional screenwriting app for macOS, Windows, and Linux. No accounts, no telemetry, no AI, no paid anything.",
  keywords: [
    "screenwriting",
    "screenplay",
    "fountain",
    "final draft alternative",
    "free screenwriting software",
    "open source",
  ],
};

/* Applies the persisted theme before first paint so there is no flash.
   Mirrors the app: system | light | dark | midnight, default system. */
const themeInit = `(function(){try{var p=localStorage.getItem("os-theme")||"system";var t=p==="system"?(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):p;document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
