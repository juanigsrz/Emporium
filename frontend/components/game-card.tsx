import Link from "next/link";
import { Card, CardBody, Badge } from "@/components/ui/primitives";
import type { Game } from "@/lib/api/types";

export function GameCard({ game }: { game: Game }) {
  return (
    <Link href={`/games/${game.bgg_id}`}>
      <Card className="h-full transition-shadow hover:shadow-md">
        <CardBody className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold leading-tight text-slate-900">
              {game.name}
            </h3>
            {game.year_published && (
              <span className="shrink-0 text-sm text-slate-400">
                {game.year_published}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {game.min_players && game.max_players && (
              <Badge>
                {game.min_players}–{game.max_players} players
              </Badge>
            )}
            {game.playing_time && <Badge>{game.playing_time} min</Badge>}
            {game.weight != null && <Badge>weight {game.weight.toFixed(1)}</Badge>}
          </div>
          {game.available_count != null && (
            <p className="text-sm text-slate-500">
              {game.available_count} cop{game.available_count === 1 ? "y" : "ies"}{" "}
              available
            </p>
          )}
        </CardBody>
      </Card>
    </Link>
  );
}
