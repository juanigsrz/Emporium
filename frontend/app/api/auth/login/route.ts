// Login: forwards credentials to DRF, stores the returned token in an httpOnly
// cookie, and returns the caller's profile.

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { DJANGO_API_URL, TOKEN_COOKIE } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const creds = await req.json().catch(() => ({}));

  let loginRes: Response;
  try {
    loginRes = await fetch(`${DJANGO_API_URL}/auth/login/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(creds),
    });
  } catch {
    return NextResponse.json(
      { detail: "Upstream API is unreachable." },
      { status: 502 },
    );
  }

  const data = await loginRes.json().catch(() => ({}));
  if (!loginRes.ok) {
    return NextResponse.json(data, { status: loginRes.status });
  }

  const token: string | undefined = data.token;
  if (!token) {
    return NextResponse.json(
      { detail: "Login did not return a token." },
      { status: 502 },
    );
  }

  const jar = await cookies();
  jar.set(TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  // Best-effort: return the profile so the client can hydrate immediately.
  let profile = data.profile;
  if (!profile) {
    try {
      const meRes = await fetch(`${DJANGO_API_URL}/me/`, {
        headers: { authorization: `Token ${token}` },
      });
      if (meRes.ok) profile = await meRes.json();
    } catch {
      /* ignore; client will fetch /me */
    }
  }

  return NextResponse.json({ profile: profile ?? null });
}
