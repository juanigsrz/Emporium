// Logout: best-effort notify DRF, then clear the token cookie.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { DJANGO_API_URL, TOKEN_COOKIE } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function POST() {
  const jar = await cookies();
  const token = jar.get(TOKEN_COOKIE)?.value;

  if (token) {
    try {
      await fetch(`${DJANGO_API_URL}/auth/logout/`, {
        method: "POST",
        headers: { authorization: `Token ${token}` },
      });
    } catch {
      /* ignore upstream errors on logout */
    }
  }

  jar.delete(TOKEN_COOKIE);
  return NextResponse.json({ ok: true });
}
