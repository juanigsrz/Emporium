"use client";

import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { games } from "@/lib/api/resources";
import { qk } from "@/lib/api/queryKeys";
import { Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/primitives";
import type { BggSearchResult, Game } from "@/lib/api/types";

function stubGame(r: BggSearchResult): Game {
  return {
    bgg_id: r.bgg_id,
    name: r.name,
    year_published: r.year_published,
    thumbnail_url: "",
    image_url: "",
    min_players: null,
    max_players: null,
    playing_time: null,
    weight: null,
    avg_rating: null,
    description: "",
    last_synced_at: "",
  };
}

/** Search the catalog (instant) + BGG (debounced) and pick a single game. */
export function GamePicker({
  selected,
  onSelect,
}: {
  selected?: Game | null;
  onSelect: (game: Game) => void;
}) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounce BGG search to avoid hammering the API.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 450);
    return () => clearTimeout(t);
  }, [q]);

  // Close on outside click.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const enabled = open && q.length > 0;

  // Local catalog — responds to every keystroke.
  const catalog = useQuery({
    queryKey: qk.games({ q, picker: true }),
    queryFn: () => games.list({ q }),
    enabled,
    placeholderData: keepPreviousData,
  });

  // BGG search — only fires after debounce.
  const bggQuery = useQuery({
    queryKey: qk.gamesBgg(debouncedQ),
    queryFn: () => games.searchBgg(debouncedQ),
    enabled: enabled && debouncedQ.length > 1,
    placeholderData: keepPreviousData,
  });

  const catalogIds = new Set(catalog.data?.results.map((g) => g.bgg_id) ?? []);
  // Only show BGG results not already in catalog.
  const bggOnly = (bggQuery.data?.results ?? []).filter(
    (r) => !catalogIds.has(r.bgg_id),
  );

  const catalogResults = catalog.data?.results ?? [];
  const hasAny = catalogResults.length > 0 || bggOnly.length > 0;
  const debouncing = q !== debouncedQ && q.length > 1;
  const loading = catalog.isFetching || bggQuery.isFetching || debouncing;

  function pick(game: Game) {
    onSelect(game);
    setOpen(false);
    setQ("");
  }

  if (selected) {
    return (
      <div className="flex items-center justify-between rounded-md border border-slate-300 px-3 py-2 text-sm">
        <span className="font-medium text-slate-800">
          {selected.name}
          {selected.year_published ? ` (${selected.year_published})` : ""}
          {!selected.last_synced_at && (
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
              Not synced
            </span>
          )}
        </span>
        <button
          type="button"
          className="text-slate-500 hover:underline"
          onClick={() => {
            setOpen(true);
            onSelect(undefined as unknown as Game);
          }}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={q}
        placeholder="Search games…"
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        autoComplete="off"
      />

      {open && q.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {/* Catalog section */}
          {catalogResults.length > 0 && (
            <section>
              <p className="px-3 pb-0.5 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                In catalog
              </p>
              {catalogResults.map((g) => (
                <button
                  key={g.bgg_id}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => pick(g)}
                >
                  {g.name}
                  {g.year_published && (
                    <span className="text-slate-400"> ({g.year_published})</span>
                  )}
                </button>
              ))}
            </section>
          )}

          {/* BGG-only section */}
          {bggOnly.length > 0 && (
            <section>
              <p className="px-3 pb-0.5 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                BoardGameGeek
              </p>
              {bggOnly.map((r) => (
                <button
                  key={r.bgg_id}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => pick(stubGame(r))}
                >
                  <span>{r.name}</span>
                  {r.year_published && (
                    <span className="text-slate-400"> ({r.year_published})</span>
                  )}
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                    Not synced
                  </span>
                </button>
              ))}
            </section>
          )}

          {/* Status footer */}
          {loading && (
            <div className="flex items-center justify-center gap-2 p-3 text-xs text-slate-400">
              <Spinner className="h-3 w-3" />
              {debouncing ? "Searching BGG…" : "Loading…"}
            </div>
          )}

          {!loading && !hasAny && (
            <p className="p-3 text-sm text-slate-500">No games found.</p>
          )}
        </div>
      )}
    </div>
  );
}
