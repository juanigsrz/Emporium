// Route guard (Next.js 16 proxy convention, formerly middleware). Redirects
// unauthenticated users away from protected routes by checking for the httpOnly
// token cookie. Bypassed in mock mode, where the client manages a simulated
// session (see mocks/).

import { NextRequest, NextResponse } from "next/server";
import { TOKEN_COOKIE, USE_MOCKS } from "@/lib/config";

const AUTH_ROUTES = ["/login", "/register"];

export function proxy(req: NextRequest) {
  if (USE_MOCKS) return NextResponse.next();

  const { pathname } = req.nextUrl;
  const hasToken = Boolean(req.cookies.get(TOKEN_COOKIE)?.value);
  const isAuthRoute = AUTH_ROUTES.some((r) => pathname.startsWith(r));

  if (!hasToken && !isAuthRoute) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (hasToken && isAuthRoute) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// Run on app pages, not on API routes, Next internals, or static assets.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
