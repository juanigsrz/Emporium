"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { games } from "@/lib/api/resources";
import { qk } from "@/lib/api/queryKeys";
import { GameCard } from "@/components/game-card";
import { Input } from "@/components/ui/field";
import { EmptyState, ErrorState, Spinner } from "@/components/ui/primitives";

export default function GamesPage() {
  const [q, setQ] = useState("");
  const [available, setAvailable] = useState(false);

  const query = useQuery({
    queryKey: qk.games({ q, available }),
    queryFn: () => games.list({ q: q || undefined, available }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Games</h1>
        <p className="text-slate-500">
          Browse the catalog. Each game groups every owner&apos;s copies.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-60">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search games…"
            className="pl-9"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={available}
            onChange={(e) => setAvailable(e.target.checked)}
          />
          With available copies only
        </label>
      </div>

      {query.isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-6 w-6" />
        </div>
      ) : query.isError ? (
        <ErrorState message="Could not load games." />
      ) : query.data && query.data.results.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {query.data.results.map((g) => (
            <GameCard key={g.bgg_id} game={g} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="No games found"
          description="Try a different search term."
        />
      )}
    </div>
  );
}
