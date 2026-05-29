"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { games } from "@/lib/api/resources";
import { qk } from "@/lib/api/queryKeys";
import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  Spinner,
} from "@/components/ui/primitives";
import { CONDITION_LABELS, COMPLETENESS_LABELS } from "@/lib/api/types";
import { formatValue } from "@/lib/utils";

export default function GameDetailPage({
  params,
}: {
  params: Promise<{ bggId: string }>;
}) {
  const { bggId } = use(params);

  const game = useQuery({
    queryKey: qk.game(bggId),
    queryFn: () => games.get(bggId),
  });
  const listings = useQuery({
    queryKey: qk.gameListings(bggId),
    queryFn: () => games.listings(bggId),
  });

  if (game.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (game.isError || !game.data) {
    return <ErrorState message="Game not found." />;
  }

  const g = game.data;

  return (
    <div className="space-y-6">
      <Link
        href="/games"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Back to games
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {g.name}
            {g.year_published && (
              <span className="ml-2 text-lg font-normal text-slate-400">
                ({g.year_published})
              </span>
            )}
          </h1>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {g.min_players && g.max_players && (
              <Badge>
                {g.min_players}–{g.max_players} players
              </Badge>
            )}
            {g.playing_time && <Badge>{g.playing_time} min</Badge>}
            {g.weight != null && <Badge>weight {g.weight.toFixed(1)}</Badge>}
            {g.avg_rating != null && (
              <Badge tone="info">★ {g.avg_rating.toFixed(1)}</Badge>
            )}
            <Badge tone="neutral">BGG #{g.bgg_id}</Badge>
          </div>
        </div>
      </div>

      {g.description && (
        <Card>
          <CardBody>
            <p className="text-sm leading-relaxed text-slate-600">
              {g.description}
            </p>
          </CardBody>
        </Card>
      )}

      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">
          Available copies
        </h2>
        {listings.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : listings.data && listings.data.length > 0 ? (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 text-left text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Owner</th>
                    <th className="px-4 py-2 font-medium">Condition</th>
                    <th className="px-4 py-2 font-medium">Language</th>
                    <th className="px-4 py-2 font-medium">Completeness</th>
                    <th className="px-4 py-2 font-medium">Edition</th>
                    <th className="px-4 py-2 text-right font-medium">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {listings.data.map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-2 font-medium text-slate-800">
                        {l.owner_username}
                      </td>
                      <td className="px-4 py-2">{CONDITION_LABELS[l.condition]}</td>
                      <td className="px-4 py-2">{l.language}</td>
                      <td className="px-4 py-2">
                        {COMPLETENESS_LABELS[l.completeness]}
                      </td>
                      <td className="px-4 py-2 text-slate-500">
                        {l.edition_note || "—"}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {formatValue(l.estimated_value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <EmptyState
            title="No copies listed"
            description="Be the first to list a copy of this game."
          />
        )}
      </div>
    </div>
  );
}
