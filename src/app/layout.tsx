import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { APP_NAME, APP_TAGLINE } from "@/lib/config";
import { BACKGROUND, startupImages } from "@/lib/splash-sizes";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_TAGLINE,
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default", startupImage: startupImages() },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: BACKGROUND.light },
    { media: "(prefers-color-scheme: dark)", color: BACKGROUND.dark },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Runs before anything paints: is this the first screen of a fresh app launch, and is the opening
// animation switched on? (The setting is remembered on this phone by the app itself.)
const COLD_SCRIPT = `try{var c=!sessionStorage.getItem('nudge-opened'),o=localStorage.getItem('nudge-opening')==='off';document.documentElement.dataset.cold=c&&!o?'1':'0'}catch(e){document.documentElement.dataset.cold='0'}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request headers makes every page render per request, so each one can carry the
  // fresh Content-Security-Policy nonce the proxy created.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        {/* First thing in the body so it runs before the opening cover can paint. (Not in a hand-made <head>: that delays the page title.) */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: COLD_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
