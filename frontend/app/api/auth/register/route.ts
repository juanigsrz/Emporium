// Register: forwards to DRF, then (if a token comes back) logs the user in by
// setting the httpOnly cookie.

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { DJANGO_API_URL, TOKEN_COOKIE } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const payload = await req.json().catch(() => ({}));

  let regRes: Response;
  try {
    regRes = await fetch(`${DJANGO_API_URL}/auth/register/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return NextResponse.json(
      { detail: "Upstream API is unreachable." },
      { status: 502 },
    );
  }

  const data = await regRes.json().catch(() => ({}));
  if (!regRes.ok) {
    return NextResponse.json(data, { status: regRes.status });
  }

  if (data.token) {
    const jar = await cookies();
    jar.set(TOKEN_COOKIE, data.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return NextResponse.json({ profile: data.profile ?? null });
}
