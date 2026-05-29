"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { games } from "@/lib/api/resources";
import { qk } from "@/lib/api/queryKeys";
import { Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/primitives";
import type { Game } from "@/lib/api/types";

/** Search the catalog and pick a single game. */
export function GamePicker({
  selected,
  onSelect,
}: {
  selected?: Game | null;
  onSelect: (game: Game) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const query = useQuery({
    queryKey: qk.games({ q, picker: true }),
    queryFn: () => games.list({ q: q || undefined }),
    enabled: open,
    placeholderData: keepPreviousData,
  });

  if (selected) {
    return (
      <div className="flex items-center justify-between rounded-md border border-slate-300 px-3 py-2 text-sm">
        <span className="font-medium text-slate-800">
          {selected.name}
          {selected.year_published ? ` (${selected.year_published})` : ""}
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
    <div className="relative">
      <Input
        value={q}
        placeholder="Search BGG games…"
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {query.isFetching ? (
            <div className="flex justify-center p-3">
              <Spinner />
            </div>
          ) : query.data && query.data.results.length > 0 ? (
            query.data.results.map((g) => (
              <button
                key={g.bgg_id}
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => {
                  onSelect(g);
                  setOpen(false);
                }}
              >
                {g.name}
                {g.year_published && (
                  <span className="text-slate-400"> ({g.year_published})</span>
                )}
              </button>
            ))
          ) : (
            <p className="p-3 text-sm text-slate-500">No games found.</p>
          )}
        </div>
      )}
    </div>
  );
}
