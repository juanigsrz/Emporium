"use client";

import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { games } from "@/lib/api/resources";
import { qk } from "@/lib/api/queryKeys";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select } from "@/components/ui/field";
import { Badge } from "@/components/ui/primitives";
import {
  CONDITIONS,
  CONDITION_LABELS,
  type EventEntry,
  type Game,
  type TradeStatement,
  type WantFilters,
} from "@/lib/api/types";
import type { StatementWrite } from "@/lib/api/resources";
import {
  isClassicWantList,
  validateStatement,
} from "@/lib/statement-validation";

export function StatementBuilder({
  myEntries,
  allowBundles,
  initial,
  submitting,
  onSubmit,
  onCancel,
}: {
  myEntries: EventEntry[];
  allowBundles: boolean;
  initial?: TradeStatement;
  submitting?: boolean;
  onSubmit: (body: StatementWrite) => void;
  onCancel?: () => void;
}) {
  const [offer, setOffer] = useState<number[]>(initial?.offer_entries ?? []);
  const [wantGames, setWantGames] = useState<Game[]>(
    initial?.want_games_detail ?? [],
  );
  const [giveAtMost, setGiveAtMost] = useState(initial?.give_at_most ?? 1);
  const [getAtLeast, setGetAtLeast] = useState(initial?.get_at_least ?? 1);
  const [filters, setFilters] = useState<WantFilters>(
    initial?.want_filters ?? {},
  );
  const [showFilters, setShowFilters] = useState(
    Boolean(initial?.want_filters && Object.keys(initial.want_filters).length),
  );
  const [gameQuery, setGameQuery] = useState("");

  const gameResults = useQuery({
    queryKey: qk.games({ q: gameQuery, want: true }),
    queryFn: () => games.list({ q: gameQuery || undefined }),
    placeholderData: keepPreviousData,
  });

  const input = useMemo(
    () => ({
      offer_entries: offer,
      want_games: wantGames.map((g) => g.bgg_id),
      give_at_most: giveAtMost,
      get_at_least: getAtLeast,
    }),
    [offer, wantGames, giveAtMost, getAtLeast],
  );
  const validation = useMemo(() => validateStatement(input), [input]);
  const classic = isClassicWantList(input);

  function toggleOffer(id: number) {
    setOffer((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      // Keep M within [1, offer count].
      if (giveAtMost > next.length) setGiveAtMost(Math.max(next.length, 1));
      return next;
    });
  }

  function addWant(g: Game) {
    setWantGames((cur) =>
      cur.some((x) => x.bgg_id === g.bgg_id) ? cur : [...cur, g],
    );
  }
  function removeWant(bggId: number) {
    setWantGames((cur) => cur.filter((g) => g.bgg_id !== bggId));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validation.ok) return;
    const want_filters =
      showFilters && Object.values(filters).some(Boolean) ? filters : null;
    onSubmit({ ...input, want_filters });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {/* Offer side */}
      <FormField
        label="You give (offer)"
        error={validation.errors.offer_entries ? [validation.errors.offer_entries] : undefined}
      >
        {myEntries.length === 0 ? (
          <p className="text-sm text-slate-500">
            You have no copies entered in this event yet.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {myEntries.map((e) => {
              const selected = offer.includes(e.id);
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => toggleOffer(e.id)}
                  className={
                    "rounded-md border px-3 py-1.5 text-sm " +
                    (selected
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")
                  }
                >
                  {e.item_token && <span className="font-mono">{e.item_token} </span>}
                  {e.listing_detail.game.name}
                </button>
              );
            })}
          </div>
        )}
      </FormField>

      {/* Want side */}
      <FormField
        label="You want (any of these games)"
        error={validation.errors.want_games ? [validation.errors.want_games] : undefined}
      >
        <div className="space-y-2">
          {wantGames.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {wantGames.map((g) => (
                <Badge key={g.bgg_id} tone="info" className="cursor-pointer">
                  <span>{g.name}</span>
                  <button
                    type="button"
                    className="ml-1.5 text-blue-500 hover:text-blue-800"
                    onClick={() => removeWant(g.bgg_id)}
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <Input
            value={gameQuery}
            onChange={(e) => setGameQuery(e.target.value)}
            placeholder="Search games to want…"
          />
          {gameQuery && (
            <div className="max-h-40 overflow-auto rounded-md border border-slate-200">
              {gameResults.data?.results.map((g) => (
                <button
                  key={g.bgg_id}
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                  onClick={() => addWant(g)}
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </FormField>

      {/* Bounds */}
      {allowBundles ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Give at most (M)"
            error={validation.errors.give_at_most ? [validation.errors.give_at_most] : undefined}
            hint={`of your ${offer.length || 0} offered cop${offer.length === 1 ? "y" : "ies"}`}
          >
            <Input
              type="number"
              min={1}
              max={Math.max(offer.length, 1)}
              value={giveAtMost}
              onChange={(e) => setGiveAtMost(Number(e.target.value))}
            />
          </FormField>
          <FormField
            label="Get at least (N)"
            error={validation.errors.get_at_least ? [validation.errors.get_at_least] : undefined}
          >
            <Input
              type="number"
              min={1}
              value={getAtLeast}
              onChange={(e) => setGetAtLeast(Number(e.target.value))}
            />
          </FormField>
        </div>
      ) : (
        <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-500">
          This event only allows classic (1-to-1) want lists.
        </p>
      )}

      <div className="text-sm text-slate-500">
        {classic ? (
          <Badge tone="neutral">Classic want list (1-to-1)</Badge>
        ) : (
          <Badge tone="warning">
            Bundle: give ≤ {giveAtMost}, get ≥ {getAtLeast}
          </Badge>
        )}
      </div>

      {/* Optional want filters */}
      <div>
        <button
          type="button"
          className="text-sm text-slate-600 hover:underline"
          onClick={() => setShowFilters((s) => !s)}
        >
          {showFilters ? "Hide" : "Add"} want filters
        </button>
        {showFilters && (
          <div className="mt-2 grid gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-3">
            <FormField label="Min condition">
              <Select
                value={filters.min_condition ?? ""}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    min_condition: (e.target.value || undefined) as
                      | (typeof CONDITIONS)[number]
                      | undefined,
                  }))
                }
              >
                <option value="">Any</option>
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {CONDITION_LABELS[c]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Language">
              <Input
                value={filters.language ?? ""}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, language: e.target.value || undefined }))
                }
                placeholder="EN"
              />
            </FormField>
            <FormField label="Region">
              <Input
                value={filters.region ?? ""}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, region: e.target.value || undefined }))
                }
                placeholder="EU"
              />
            </FormField>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={submitting || !validation.ok}>
          {submitting ? "Saving…" : "Save statement"}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
