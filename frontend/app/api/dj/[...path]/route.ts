// BFF proxy: forwards /api/dj/* to the Django API, attaching the DRF token
// from the httpOnly cookie as `Authorization: Token <token>`. Keeps the token
// out of client JS and avoids CORS entirely.

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { DJANGO_API_URL, TOKEN_COOKIE } from "@/lib/config";

export const dynamic = "force-dynamic";

async function forward(req: NextRequest, path: string[]) {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value;
  const search = req.nextUrl.search;
  const target = `${DJANGO_API_URL}/${path.join("/")}${
    path.length ? "/" : ""
  }${search}`.replace(/(?<!:)\/\/+/g, "/");

  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const accept = req.headers.get("accept");
  if (accept) headers.set("accept", accept);
  if (token) headers.set("authorization", `Token ${token}`);

  const hasBody = !["GET", "HEAD"].includes(req.method);
  const init: RequestInit = {
    method: req.method,
    headers,
    body: hasBody ? await req.arrayBuffer() : undefined,
    redirect: "manual",
  };

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch {
    return NextResponse.json(
      { detail: "Upstream API is unreachable." },
      { status: 502 },
    );
  }

  const body = await upstream.arrayBuffer();
  const res = new NextResponse(body, { status: upstream.status });
  const ct = upstream.headers.get("content-type");
  if (ct) res.headers.set("content-type", ct);
  return res;
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
