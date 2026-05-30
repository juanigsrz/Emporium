// In-memory mock backend mirroring PLAN.md §5/§7/§8/§9. Stateful across a single
// page session; the lifecycle can be walked end to end and a FakeMatcher (§8.4)
// produces valid assignments. Session is persisted in localStorage so reloads
// keep the user logged in.

import type {
  Assignment,
  Condition,
  EventEntry,
  EventResult,
  Game,
  Listing,
  MatchInput,
  MatchResult,
  Photo,
  Shipment,
  TradeEvent,
  TradeStatement,
  UserProfile,
  WantFilters,
} from "@/lib/api/types";
import { BGG_DATASET } from "./bgg-dataset";

interface MockUser {
  id: number;
  username: string;
  email: string;
  password: string;
  bgg_username: string | null;
  bgg_verified: boolean;
  is_organizer: boolean;
}

let nextId = 1000;
const id = () => ++nextId;

const SESSION_KEY = "mock-session-user";

// ---- Seed data ----

const users: MockUser[] = [
  {
    id: 1,
    username: "alice",
    email: "alice@example.com",
    password: "password",
    bgg_username: "alice_bgg",
    bgg_verified: true,
    is_organizer: true,
  },
  {
    id: 2,
    username: "bob",
    email: "bob@example.com",
    password: "password",
    bgg_username: null,
    bgg_verified: false,
    is_organizer: false,
  },
  {
    id: 3,
    username: "carol",
    email: "carol@example.com",
    password: "password",
    bgg_username: "carol_bgg",
    bgg_verified: true,
    is_organizer: false,
  },
];

const games: Game[] = [
  mkGame(13, "Catan", 1995, 3, 4, 90, 2.3, 7.1),
  mkGame(822, "Carcassonne", 2000, 2, 5, 45, 1.9, 7.4),
  mkGame(266192, "Wingspan", 2019, 1, 5, 70, 2.4, 8.1),
  mkGame(230802, "Azul", 2017, 2, 4, 45, 1.8, 7.8),
];

// Full BGG game list for mock search — keyed by bgg_id for O(1) lookup.
const bggIndex = new Map(
  BGG_DATASET.map(([bgg_id, name, year]) => [bgg_id, { bgg_id, name, year_published: year }])
);

function mkGame(
  bgg_id: number,
  name: string,
  year: number,
  minp: number,
  maxp: number,
  time: number,
  weight: number,
  rating: number,
): Game {
  return {
    bgg_id,
    name,
    year_published: year,
    thumbnail_url: "",
    image_url: "",
    min_players: minp,
    max_players: maxp,
    playing_time: time,
    weight,
    avg_rating: rating,
    description: `${name} — a cached BGG description.`,
    last_synced_at: new Date().toISOString(),
  };
}

interface MockListing {
  id: number;
  game_bgg_id: number;
  owner: number;
  condition: Condition;
  language: string;
  bgg_version_id: number | null;
  edition_note: string;
  completeness: Listing["completeness"];
  notes: string;
  estimated_value: string | null;
  is_active: boolean;
  created_at: string;
  photos: Photo[];
}

const listings: MockListing[] = [
  mkListing(13, 1, "VERY_GOOD", "EN", "45.00"),
  mkListing(822, 1, "GOOD", "EN", "20.00"),
  mkListing(266192, 2, "LIKE_NEW", "EN", "55.00"),
  mkListing(266192, 3, "NEW", "DE", "60.00"),
  mkListing(230802, 3, "GOOD", "EN", "30.00"),
];

function mkListing(
  game_bgg_id: number,
  owner: number,
  condition: Condition,
  language: string,
  value: string,
): MockListing {
  return {
    id: id(),
    game_bgg_id,
    owner,
    condition,
    language,
    bgg_version_id: null,
    edition_note: "",
    completeness: "COMPLETE",
    notes: "",
    estimated_value: value,
    is_active: true,
    created_at: new Date().toISOString(),
    photos: [],
  };
}

interface MockEvent {
  slug: string;
  name: string;
  description: string;
  organizer: number;
  status: TradeEvent["status"];
  region_rule: string;
  allow_bundles: boolean;
  submissions_close_at: string | null;
  wantlist_close_at: string | null;
  max_listings_per_user: number | null;
  created_at: string;
}

const events: MockEvent[] = [
  {
    slug: "spring-2026",
    name: "Spring 2026 Math Trade",
    description: "A demo event seeded for the mock backend.",
    organizer: 1,
    status: "OPEN_SUBMISSIONS",
    region_rule: "EU",
    allow_bundles: true,
    submissions_close_at: null,
    wantlist_close_at: null,
    max_listings_per_user: null,
    created_at: new Date().toISOString(),
  },
];

interface MockEntry {
  id: number;
  event: string;
  listing: number;
  item_token: string | null;
  status: EventEntry["status"];
}
const entries: MockEntry[] = [];

interface MockStatement {
  id: number;
  event: string;
  owner: number;
  give_at_most: number;
  get_at_least: number;
  offer_entries: number[];
  want_games: number[];
  want_filters: WantFilters | null;
  created_at: string;
}
const statements: MockStatement[] = [];

interface MockMatchResult {
  id: number;
  event: string;
  input_json: MatchInput | null;
  input_text: string | null;
  output_json: MatchResult["output_json"];
  status: MatchResult["status"];
  items_traded: number | null;
  users_trading: number | null;
  started_at: string | null;
  finished_at: string | null;
}
const matchResults: MockMatchResult[] = [];

interface MockAssignment {
  id: number;
  match_result: number;
  entry: number;
  recipient: number;
}
const assignments: MockAssignment[] = [];

interface MockShipment {
  id: number;
  assignment: number;
  status: Shipment["status"];
  tracking: string;
  shipped_at: string | null;
  received_at: string | null;
  disputed: boolean;
  notes: string;
}
const shipments: MockShipment[] = [];

// ---- Lookups ----

const userById = (uid: number) => users.find((u) => u.id === uid)!;
const userByName = (name: string) =>
  users.find((u) => u.username === name);

// When a listing is created for an unsynced game, promote it to the catalog.
function syncGameIfNeeded(bgg_id: number): void {
  if (games.some((g) => g.bgg_id === bgg_id)) return;
  const entry = bggIndex.get(bgg_id);
  if (!entry) return;
  games.push(mkGame(bgg_id, entry.name, entry.year_published, 2, 4, 60, 2.5, 7.5));
}

const gameById = (bgg: number) => games.find((g) => g.bgg_id === bgg)!;

// ---- Session ----

export function getCurrentUser(): MockUser | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  const uid = Number(raw);
  return users.find((u) => u.id === uid) ?? null;
}

export function login(username: string, password: string): MockUser {
  const user = userByName(username);
  if (!user || user.password !== password) {
    throw { status: 400, body: { non_field_errors: ["Invalid credentials."] } };
  }
  window.localStorage.setItem(SESSION_KEY, String(user.id));
  return user;
}

export function register(payload: {
  username: string;
  email: string;
  password: string;
}): MockUser {
  if (userByName(payload.username)) {
    throw { status: 400, body: { username: ["This username is taken."] } };
  }
  const user: MockUser = {
    id: id(),
    username: payload.username,
    email: payload.email,
    password: payload.password,
    bgg_username: null,
    bgg_verified: false,
    // Demo affordance: registered users can organize so the full lifecycle is
    // walkable from a fresh account in mock mode.
    is_organizer: true,
  };
  users.push(user);
  window.localStorage.setItem(SESSION_KEY, String(user.id));
  return user;
}

export function logout() {
  window.localStorage.removeItem(SESSION_KEY);
}

// ---- Serializers (mock -> wire shape) ----

function profileOf(u: MockUser): UserProfile {
  return {
    user_id: u.id,
    username: u.username,
    email: u.email,
    bgg_username: u.bgg_username,
    bgg_verified: u.bgg_verified,
    default_country: "",
    default_region: "EU",
    is_organizer: u.is_organizer,
    timezone: "UTC",
  };
}

function listingOf(l: MockListing): Listing {
  const owner = userById(l.owner);
  return {
    id: l.id,
    game: gameById(l.game_bgg_id),
    game_bgg_id: l.game_bgg_id,
    owner: l.owner,
    owner_username: owner.username,
    condition: l.condition,
    language: l.language,
    bgg_version_id: l.bgg_version_id,
    edition_note: l.edition_note,
    completeness: l.completeness,
    notes: l.notes,
    estimated_value: l.estimated_value,
    is_active: l.is_active,
    created_at: l.created_at,
    photos: l.photos,
  };
}

function entryOf(e: MockEntry): EventEntry {
  const l = listings.find((x) => x.id === e.listing)!;
  const owner = userById(l.owner);
  return {
    id: e.id,
    event: e.event,
    listing: e.listing,
    listing_detail: listingOf(l),
    item_token: e.item_token,
    status: e.status,
    owner: l.owner,
    owner_username: owner.username,
  };
}

function eventOf(e: MockEvent): TradeEvent {
  return { ...e, organizer_username: userById(e.organizer).username };
}

function statementOf(s: MockStatement): TradeStatement {
  return {
    id: s.id,
    event: s.event,
    owner: s.owner,
    owner_username: userById(s.owner).username,
    give_at_most: s.give_at_most,
    get_at_least: s.get_at_least,
    offer_entries: s.offer_entries,
    offer_entries_detail: s.offer_entries
      .map((eid) => entries.find((e) => e.id === eid))
      .filter(Boolean)
      .map((e) => entryOf(e as MockEntry)),
    want_games: s.want_games,
    want_games_detail: s.want_games.map(gameById),
    want_filters: s.want_filters,
    created_at: s.created_at,
  };
}

function assignmentOf(a: MockAssignment): Assignment {
  const entry = entries.find((e) => e.id === a.entry)!;
  const listing = listings.find((l) => l.id === entry.listing)!;
  return {
    id: a.id,
    match_result: a.match_result,
    entry: a.entry,
    entry_detail: entryOf(entry),
    recipient: a.recipient,
    recipient_username: userById(a.recipient).username,
    sender_username: userById(listing.owner).username,
  };
}

function matchResultOf(m: MockMatchResult): MatchResult {
  return {
    ...m,
    assignments: assignments
      .filter((a) => a.match_result === m.id)
      .map(assignmentOf),
  };
}

function shipmentOf(s: MockShipment, viewerId: number): Shipment {
  const assignment = assignments.find((a) => a.id === s.assignment)!;
  const entry = entries.find((e) => e.id === assignment.entry)!;
  const listing = listings.find((l) => l.id === entry.listing)!;
  return {
    id: s.id,
    assignment: s.assignment,
    assignment_detail: assignmentOf(assignment),
    status: s.status,
    tracking: s.tracking,
    shipped_at: s.shipped_at,
    received_at: s.received_at,
    disputed: s.disputed,
    notes: s.notes,
    role: listing.owner === viewerId ? "SENDER" : "RECIPIENT",
  };
}

// ---- Public API used by handlers ----

export const db = {
  profileOf,
  getCurrentUser,
  login,
  register,
  logout,

  bggLink(u: MockUser, bgg_username: string) {
    u.bgg_username = bgg_username;
    u.bgg_verified = false;
    return profileOf(u);
  },
  bggVerify(u: MockUser) {
    u.bgg_verified = true;
    return profileOf(u);
  },
  bggImport(u: MockUser) {
    // Create draft listings for two games the user doesn't already own.
    let created = 0;
    for (const g of games.slice(0, 2)) {
      const owns = listings.some(
        (l) => l.owner === u.id && l.game_bgg_id === g.bgg_id,
      );
      if (owns) continue;
      listings.push(mkListing(g.bgg_id, u.id, "GOOD", "EN", "0.00"));
      created++;
    }
    return { detail: "Collection import started.", created };
  },

  games(q?: string) {
    const lower = (q ?? "").toLowerCase();
    const filtered = lower
      ? games.filter((g) => g.name.toLowerCase().includes(lower))
      : games;
    return filtered.map((g) => ({
      ...g,
      available_count: listings.filter(
        (l) => l.game_bgg_id === g.bgg_id && l.is_active,
      ).length,
    }));
  },
  game: (bgg: number) => gameById(bgg),
  gameListings: (bgg: number) =>
    listings
      .filter((l) => l.game_bgg_id === bgg && l.is_active)
      .map(listingOf),

  listings: (ownerId?: number) =>
    listings
      .filter((l) => (ownerId ? l.owner === ownerId : true))
      .map(listingOf),
  listing: (lid: number) => {
    const l = listings.find((x) => x.id === lid);
    return l ? listingOf(l) : null;
  },
  searchBgg(q: string) {
    if (!q) return [];
    const lower = q.toLowerCase();
    // Search the full BGG dataset (not just the local catalog).
    return Array.from(bggIndex.values())
      .filter((g) => g.name.toLowerCase().includes(lower))
      .slice(0, 50);
  },

  createListing(owner: number, body: Partial<MockListing>) {
    // Sync game from BGG-only pool if not yet in catalog.
    if (body.game_bgg_id) syncGameIfNeeded(body.game_bgg_id);
    const l: MockListing = {
      id: id(),
      game_bgg_id: body.game_bgg_id!,
      owner,
      condition: (body.condition as Condition) ?? "GOOD",
      language: body.language ?? "EN",
      bgg_version_id: body.bgg_version_id ?? null,
      edition_note: body.edition_note ?? "",
      completeness: body.completeness ?? "COMPLETE",
      notes: body.notes ?? "",
      estimated_value: body.estimated_value ?? null,
      is_active: body.is_active ?? true,
      created_at: new Date().toISOString(),
      photos: [],
    };
    listings.push(l);
    return listingOf(l);
  },
  updateListing(lid: number, body: Partial<MockListing>) {
    const l = listings.find((x) => x.id === lid);
    if (!l) return null;
    Object.assign(l, body);
    return listingOf(l);
  },
  deleteListing(lid: number) {
    const i = listings.findIndex((x) => x.id === lid);
    if (i >= 0) listings.splice(i, 1);
  },
  addPhoto(lid: number, caption: string) {
    const l = listings.find((x) => x.id === lid);
    if (!l) return null;
    const photo: Photo = {
      id: id(),
      image: "",
      caption,
      order: l.photos.length,
    };
    l.photos.push(photo);
    return photo;
  },

  events: () => events.map(eventOf),
  event: (slug: string) => {
    const e = events.find((x) => x.slug === slug);
    return e ? eventOf(e) : null;
  },
  createEvent(organizer: number, body: Partial<MockEvent>) {
    const slug = (body.name ?? "event")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .concat(`-${id()}`);
    const e: MockEvent = {
      slug,
      name: body.name ?? "Untitled event",
      description: body.description ?? "",
      organizer,
      status: "DRAFT",
      region_rule: body.region_rule ?? "",
      allow_bundles: body.allow_bundles ?? true,
      submissions_close_at: body.submissions_close_at ?? null,
      wantlist_close_at: body.wantlist_close_at ?? null,
      max_listings_per_user: body.max_listings_per_user ?? null,
      created_at: new Date().toISOString(),
    };
    events.push(e);
    return eventOf(e);
  },
  updateEvent(slug: string, body: Partial<MockEvent>) {
    const e = events.find((x) => x.slug === slug);
    if (!e) return null;
    Object.assign(e, body);
    return eventOf(e);
  },
  transition(slug: string, to: TradeEvent["status"]) {
    const e = events.find((x) => x.slug === slug);
    if (!e) return null;
    const prev = e.status;
    e.status = to;
    runTransitionSideEffects(e, prev, to);
    return eventOf(e);
  },
  runMatch(slug: string) {
    const e = events.find((x) => x.slug === slug);
    if (!e) return { detail: "No such event." };
    runFakeMatcher(e);
    return { detail: "Match computed." };
  },

  entries: (slug: string) =>
    entries.filter((e) => e.event === slug).map(entryOf),
  enterListing(slug: string, listing: number) {
    const e: MockEntry = {
      id: id(),
      event: slug,
      listing,
      item_token: null,
      status: "ENTERED",
    };
    entries.push(e);
    return entryOf(e);
  },
  withdrawEntry(eid: number) {
    const i = entries.findIndex((e) => e.id === eid);
    if (i >= 0) entries.splice(i, 1);
  },

  statements: (slug: string) =>
    statements.filter((s) => s.event === slug).map(statementOf),
  statement: (sid: number) => {
    const s = statements.find((x) => x.id === sid);
    return s ? statementOf(s) : null;
  },
  createStatement(slug: string, owner: number, body: Partial<MockStatement>) {
    const s: MockStatement = {
      id: id(),
      event: slug,
      owner,
      give_at_most: body.give_at_most ?? 1,
      get_at_least: body.get_at_least ?? 1,
      offer_entries: body.offer_entries ?? [],
      want_games: body.want_games ?? [],
      want_filters: body.want_filters ?? null,
      created_at: new Date().toISOString(),
    };
    statements.push(s);
    return statementOf(s);
  },
  updateStatement(sid: number, body: Partial<MockStatement>) {
    const s = statements.find((x) => x.id === sid);
    if (!s) return null;
    Object.assign(s, body);
    return statementOf(s);
  },
  deleteStatement(sid: number) {
    const i = statements.findIndex((x) => x.id === sid);
    if (i >= 0) statements.splice(i, 1);
  },

  result(slug: string, viewerId: number): EventResult {
    const result = matchResults
      .filter((m) => m.event === slug)
      .sort((a, b) => b.id - a.id)[0];
    if (!result) return { result: null, my_assignments: [] };
    const full = matchResultOf(result);
    const mine = full.assignments.filter((a) => {
      const entry = entries.find((e) => e.id === a.entry)!;
      const listing = listings.find((l) => l.id === entry.listing)!;
      return a.recipient === viewerId || listing.owner === viewerId;
    });
    return { result: full, my_assignments: mine };
  },

  shipping(slug: string, viewerId: number): Shipment[] {
    const slugAssignments = assignments.filter((a) => {
      const r = matchResults.find((m) => m.id === a.match_result);
      return r?.event === slug;
    });
    return shipments
      .filter((s) => slugAssignments.some((a) => a.id === s.assignment))
      .map((s) => shipmentOf(s, viewerId))
      .filter((s) => {
        const a = assignments.find((x) => x.id === s.assignment)!;
        const entry = entries.find((e) => e.id === a.entry)!;
        const listing = listings.find((l) => l.id === entry.listing)!;
        return a.recipient === viewerId || listing.owner === viewerId;
      });
  },
  markShipped(sid: number, tracking: string, viewerId: number) {
    const s = shipments.find((x) => x.id === sid);
    if (!s) return null;
    s.status = "SHIPPED";
    s.tracking = tracking;
    s.shipped_at = new Date().toISOString();
    return shipmentOf(s, viewerId);
  },
  markReceived(sid: number, viewerId: number) {
    const s = shipments.find((x) => x.id === sid);
    if (!s) return null;
    s.status = "RECEIVED";
    s.received_at = new Date().toISOString();
    return shipmentOf(s, viewerId);
  },
};

// ---- Lifecycle side effects (PLAN.md §7) ----

function runTransitionSideEffects(
  e: MockEvent,
  prev: TradeEvent["status"],
  to: TradeEvent["status"],
) {
  // 1 -> 2: freeze entries, assign stable item tokens.
  if (prev === "OPEN_SUBMISSIONS" && to === "OPEN_WANTLIST") {
    const evEntries = entries.filter(
      (x) => x.event === e.slug && x.status === "ENTERED",
    );
    evEntries.forEach((entry, i) => {
      entry.item_token = tokenFor(i);
    });
  }
  // 5 -> 6: create Shipment rows for every assignment.
  if (prev === "FINALIZED" && to === "SHIPPING") {
    const slugResults = matchResults.filter((m) => m.event === e.slug);
    for (const m of slugResults) {
      for (const a of assignments.filter((x) => x.match_result === m.id)) {
        if (shipments.some((s) => s.assignment === a.id)) continue;
        shipments.push({
          id: id(),
          assignment: a.id,
          status: "PENDING",
          tracking: "",
          shipped_at: null,
          received_at: null,
          disputed: false,
          notes: "",
        });
      }
    }
  }
}

function tokenFor(i: number): string {
  // A..Z, then AA, AB, ... for larger events.
  let n = i;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

// ---- FakeMatcher (PLAN.md §8.4): greedy mutual 2-cycles ----

function runFakeMatcher(e: MockEvent) {
  const slugStatements = statements.filter((s) => s.event === e.slug);
  const slugEntries = entries.filter(
    (x) => x.event === e.slug && x.item_token,
  );

  const tokenToEntry = new Map<string, MockEntry>();
  for (const entry of slugEntries) tokenToEntry.set(entry.item_token!, entry);

  const ownerOf = (entry: MockEntry) =>
    listings.find((l) => l.id === entry.listing)!.owner;
  const gameOf = (entry: MockEntry) =>
    listings.find((l) => l.id === entry.listing)!.game_bgg_id;

  // For a statement, the set of tokens it would accept (wanted games, not its own).
  const wantedTokens = (s: MockStatement) =>
    slugEntries.filter(
      (entry) =>
        ownerOf(entry) !== s.owner && s.want_games.includes(gameOf(entry)),
    );

  const assigned = new Set<string>(); // tokens already moved
  const pairs: { token: string; to: number }[] = [];

  for (let i = 0; i < slugStatements.length; i++) {
    for (let j = i + 1; j < slugStatements.length; j++) {
      const s1 = slugStatements[i];
      const s2 = slugStatements[j];
      if (s1.owner === s2.owner) continue;

      // s1 offers a token s2 wants, and s2 offers a token s1 wants.
      const give1 = s1.offer_entries
        .map((eid) => entries.find((e) => e.id === eid)!)
        .find(
          (entry) =>
            entry &&
            !assigned.has(entry.item_token ?? "") &&
            wantedTokens(s2).some((w) => w.id === entry.id),
        );
      const give2 = s2.offer_entries
        .map((eid) => entries.find((e) => e.id === eid)!)
        .find(
          (entry) =>
            entry &&
            !assigned.has(entry.item_token ?? "") &&
            wantedTokens(s1).some((w) => w.id === entry.id),
        );

      if (give1?.item_token && give2?.item_token) {
        assigned.add(give1.item_token);
        assigned.add(give2.item_token);
        pairs.push({ token: give1.item_token, to: s2.owner });
        pairs.push({ token: give2.item_token, to: s1.owner });
      }
    }
  }

  // Build the canonical input (§8.2) for reproducibility.
  const input: MatchInput = {
    event: e.slug,
    items: slugEntries.map((entry) => ({
      token: entry.item_token!,
      owner: userById(ownerOf(entry)).username,
      bgg_id: gameOf(entry),
      name: gameById(gameOf(entry)).name,
    })),
    statements: slugStatements.map((s) => ({
      owner: userById(s.owner).username,
      offer: s.offer_entries
        .map((eid) => entries.find((e) => e.id === eid)?.item_token)
        .filter(Boolean) as string[],
      want: wantedTokens(s).map((w) => w.item_token!),
      give_at_most: s.give_at_most,
      get_at_least: s.get_at_least,
    })),
  };

  const tradingUsers = new Set<number>();
  pairs.forEach((p) => {
    tradingUsers.add(p.to);
    const entry = tokenToEntry.get(p.token)!;
    tradingUsers.add(ownerOf(entry));
  });

  const result: MockMatchResult = {
    id: id(),
    event: e.slug,
    input_json: input,
    input_text: matchInputToText(input),
    output_json: {
      event: e.slug,
      assignments: pairs.map((p) => ({
        token: p.token,
        to: userById(p.to).username,
      })),
      summary: {
        items_traded: pairs.length,
        users_trading: tradingUsers.size,
      },
    },
    status: "DONE",
    items_traded: pairs.length,
    users_trading: tradingUsers.size,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
  };
  matchResults.push(result);

  // Parse output -> Assignment rows.
  for (const p of pairs) {
    const entry = tokenToEntry.get(p.token)!;
    assignments.push({
      id: id(),
      match_result: result.id,
      entry: entry.id,
      recipient: p.to,
    });
  }
}

function matchInputToText(input: MatchInput): string {
  const items = input.items
    .map((i) => `${i.token}=${i.owner}/${i.name}`)
    .join(" ");
  const lines = input.statements.map((s) => {
    const body = `${s.offer.join(" ")} -> ${s.want.join(" ")}`;
    return `${body} (${s.give_at_most}-to-${s.get_at_least})`;
  });
  return [`# event: ${input.event} | items: ${items}`, ...lines].join("\n");
}
