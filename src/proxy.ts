import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isFakeMode } from "@/lib/fake-mode";

// For every page request: (1) set a Content-Security-Policy with a fresh nonce, (2) keep the
// login session fresh, (3) send signed-out visitors to /login.

export function buildCsp(nonce: string, dev: boolean) {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const wss = supabase.replace(/^https:/, "wss:");
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${supabase} ${wss} https://*.supabase.co`.trim(),
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce, process.env.NODE_ENV !== "production");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  requestHeaders.set("Content-Security-Policy", csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const finish = (r: NextResponse) => {
    r.headers.set("Content-Security-Policy", csp);
    return r;
  };

  const path = request.nextUrl.pathname;
  const isPublic =
    path.startsWith("/login") || path.startsWith("/privacy") || path.startsWith("/terms") || (isFakeMode() && path.startsWith("/api/test"));

  let signedIn = false;
  if (isFakeMode()) {
    signedIn = request.cookies.get("fake-user")?.value === "1";
  } else {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
            response = NextResponse.next({ request: { headers: requestHeaders } });
            cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          },
        },
      },
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    signedIn = !!user;
  }

  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return finish(NextResponse.redirect(url));
  }
  return finish(response);
}

export const config = {
  matcher: [
    {
      // Skip static files, the service worker, manifest, icons, and the clock routes
      // (the clock routes and /api/inbox and /api/widget prove who they are with a secret or token instead of a login).
      source:
        "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/|api/dispatch|api/cron/|api/inbox|api/widget|.*\\.(?:svg|png|jpg|ico)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
