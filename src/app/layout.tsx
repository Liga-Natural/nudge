import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { APP_NAME, APP_TAGLINE } from "@/lib/config";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_TAGLINE,
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#FAF8F5",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request headers makes every page render per request, so each one can carry the
  // fresh Content-Security-Policy nonce the proxy created.
  await headers();
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
