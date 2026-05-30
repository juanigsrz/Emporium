// MSW handlers implementing the §9 REST contract against the in-memory db.
// These intercept the BFF-bound requests (/api/dj/*) and the auth route
// handlers (/api/auth/*) directly in the browser, so the real Next.js
// route handlers and Django are never hit in mock mode.

import { http, HttpResponse } from "msw";
import { db } from "./db";
import type { Paginated } from "@/lib/api/types";

const P = "/api/dj";

function paginate<T>(results: T[]): Paginated<T> {
  return { count: results.length, next: null, previous: null, results };
}

const unauthorized = () =>
  HttpResponse.json({ detail: "Authentication required." }, { status: 401 });

function requireUser() {
  const user = db.getCurrentUser();
  if (!user) throw unauthorized();
  return user;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export const handlers = [
  // ---- Auth ----
  http.post("/api/auth/login", async ({ request }) => {
    const body = await readJson(request);
    try {
      const user = db.login(String(body.username), String(body.password));
      return HttpResponse.json({ profile: db.profileOf(user) });
    } catch (e) {
      const err = e as { status: number; body: Record<string, string[]> };
      return HttpResponse.json(err.body, { status: err.status });
    }
  }),
  http.post("/api/auth/register", async ({ request }) => {
    const body = await readJson(request);
    try {
      const user = db.register({
        username: String(body.username),
        email: String(body.email),
        password: String(body.password),
      });
      return HttpResponse.json({ profile: db.profileOf(user) });
    } catch (e) {
      const err = e as { status: number; body: Record<string, string[]> };
      return HttpResponse.json(err.body, { status: err.status });
    }
  }),
  http.post("/api/auth/logout", () => {
    db.logout();
    return HttpResponse.json({ ok: true });
  }),

  // ---- Profile & BGG ----
  http.get(`${P}/me/`, () => {
    const user = db.getCurrentUser();
    if (!user) return unauthorized();
    return HttpResponse.json(db.profileOf(user));
  }),
  http.post(`${P}/me/bgg/link/`, async ({ request }) => {
    const user = requireUser();
    const body = await readJson(request);
    return HttpResponse.json(db.bggLink(user, String(body.bgg_username)));
  }),
  http.post(`${P}/me/bgg/verify/`, () => {
    const user = requireUser();
    return HttpResponse.json(db.bggVerify(user));
  }),
  http.post(`${P}/me/bgg/import/`, () => {
    const user = requireUser();
    return HttpResponse.json(db.bggImport(user));
  }),

  // ---- Catalog ----
  // Literal paths must come before parametric routes (:bgg would eat them otherwise).
  http.get(`${P}/games/search-bgg/`, ({ request }) => {
    requireUser();
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";
    return HttpResponse.json({ results: db.searchBgg(q) });
  }),
  http.get(`${P}/games/`, ({ request }) => {
    requireUser();
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? undefined;
    return HttpResponse.json(paginate(db.games(q)));
  }),
  http.get(`${P}/games/:bgg/listings/`, ({ params }) => {
    requireUser();
    return HttpResponse.json(db.gameListings(Number(params.bgg)));
  }),
  http.get(`${P}/games/:bgg/`, ({ params }) => {
    requireUser();
    const game = db.game(Number(params.bgg));
    return game
      ? HttpResponse.json(game)
      : HttpResponse.json({ detail: "Not found." }, { status: 404 });
  }),

  // ---- Inventory ----
  http.get(`${P}/listings/`, ({ request }) => {
    const user = requireUser();
    const url = new URL(request.url);
    const mine = url.searchParams.get("mine") === "true";
    return HttpResponse.json(paginate(db.listings(mine ? user.id : undefined)));
  }),
  http.post(`${P}/listings/`, async ({ request }) => {
    const user = requireUser();
    const body = await readJson(request);
    return HttpResponse.json(db.createListing(user.id, body), { status: 201 });
  }),
  http.get(`${P}/listings/:id/`, ({ params }) => {
    requireUser();
    const l = db.listing(Number(params.id));
    return l
      ? HttpResponse.json(l)
      : HttpResponse.json({ detail: "Not found." }, { status: 404 });
  }),
  http.put(`${P}/listings/:id/`, async ({ params, request }) => {
    requireUser();
    const body = await readJson(request);
    const l = db.updateListing(Number(params.id), body);
    return l
      ? HttpResponse.json(l)
      : HttpResponse.json({ detail: "Not found." }, { status: 404 });
  }),
  http.delete(`${P}/listings/:id/`, ({ params }) => {
    requireUser();
    db.deleteListing(Number(params.id));
    return new HttpResponse(null, { status: 204 });
  }),
  http.post(`${P}/listings/:id/photos/`, async ({ params, request }) => {
    requireUser();
    let caption = "";
    try {
      const form = await request.formData();
      caption = String(form.get("caption") ?? "");
    } catch {
      /* no-op */
    }
    const photo = db.addPhoto(Number(params.id), caption);
    return photo
      ? HttpResponse.json(photo, { status: 201 })
      : HttpResponse.json({ detail: "Not found." }, { status: 404 });
  }),

  // ---- Events: nested resources first ----
  http.get(`${P}/events/:slug/entries/`, ({ params }) => {
    requireUser();
    return HttpResponse.json(db.entries(String(params.slug)));
  }),
  http.post(`${P}/events/:slug/entries/`, async ({ params, request }) => {
    requireUser();
    const body = await readJson(request);
    return HttpResponse.json(
      db.enterListing(String(params.slug), Number(body.listing)),
      { status: 201 },
    );
  }),
  http.delete(`${P}/events/:slug/entries/:id/`, ({ params }) => {
    requireUser();
    db.withdrawEntry(Number(params.id));
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${P}/events/:slug/statements/:id/`, ({ params }) => {
    requireUser();
    const s = db.statement(Number(params.id));
    return s
      ? HttpResponse.json(s)
      : HttpResponse.json({ detail: "Not found." }, { status: 404 });
  }),
  http.put(`${P}/events/:slug/statements/:id/`, async ({ params, request }) => {
    requireUser();
    const body = await readJson(request);
    const s = db.updateStatement(Number(params.id), body);
    return s
      ? HttpResponse.json(s)
      : HttpResponse.json({ detail: "Not found." }, { status: 404 });
  }),
  http.delete(`${P}/events/:slug/statements/:id/`, ({ params }) => {
    requireUser();
    db.deleteStatement(Number(params.id));
    return new HttpResponse(null, { status: 204 });
  }),
  http.get(`${P}/events/:slug/statements/`, ({ params }) => {
    requireUser();
    return HttpResponse.json(db.statements(String(params.slug)));
  }),
  http.post(`${P}/events/:slug/statements/`, async ({ params, request }) => {
    const user = requireUser();
    const body = await readJson(request);
    return HttpResponse.json(
      db.createStatement(String(params.slug), user.id, body),
      { status: 201 },
    );
  }),

  http.post(`${P}/events/:slug/transition/`, async ({ params, request }) => {
    requireUser();
    const body = await readJson(request);
    const e = db.transition(
      String(params.slug),
      body.to as Parameters<typeof db.transition>[1],
    );
    return e
      ? HttpResponse.json(e)
      : HttpResponse.json({ detail: "Not found." }, { status: 404 });
  }),
  http.post(`${P}/events/:slug/run-match/`, ({ params }) => {
    requireUser();
    return HttpResponse.json(db.runMatch(String(params.slug)));
  }),
  http.get(`${P}/events/:slug/result/`, ({ params }) => {
    const user = requireUser();
    return HttpResponse.json(db.result(String(params.slug), user.id));
  }),
  http.get(`${P}/events/:slug/shipping/`, ({ params }) => {
    const user = requireUser();
    return HttpResponse.json(db.shipping(String(params.slug), user.id));
  }),

  http.get(`${P}/events/:slug/`, ({ params }) => {
    requireUser();
    const e = db.event(String(params.slug));
    return e
      ? HttpResponse.json(e)
      : HttpResponse.json({ detail: "Not found." }, { status: 404 });
  }),
  http.put(`${P}/events/:slug/`, async ({ params, request }) => {
    requireUser();
    const body = await readJson(request);
    const e = db.updateEvent(String(params.slug), body);
    return e
      ? HttpResponse.json(e)
      : HttpResponse.json({ detail: "Not found." }, { status: 404 });
  }),
  http.get(`${P}/events/`, () => {
    requireUser();
    return HttpResponse.json(paginate(db.events()));
  }),
  http.post(`${P}/events/`, async ({ request }) => {
    const user = requireUser();
    if (!user.is_organizer) {
      return HttpResponse.json(
        { detail: "Only organizers can create events." },
        { status: 403 },
      );
    }
    const body = await readJson(request);
    return HttpResponse.json(db.createEvent(user.id, body), { status: 201 });
  }),

  // ---- Shipping ----
  http.post(`${P}/shipments/:id/mark-shipped/`, async ({ params, request }) => {
    const user = requireUser();
    const body = await readJson(request);
    const s = db.markShipped(
      Number(params.id),
      String(body.tracking ?? ""),
      user.id,
    );
    return s
      ? HttpResponse.json(s)
      : HttpResponse.json({ detail: "Not found." }, { status: 404 });
  }),
  http.post(`${P}/shipments/:id/mark-received/`, ({ params }) => {
    const user = requireUser();
    const s = db.markReceived(Number(params.id), user.id);
    return s
      ? HttpResponse.json(s)
      : HttpResponse.json({ detail: "Not found." }, { status: 404 });
  }),
];
