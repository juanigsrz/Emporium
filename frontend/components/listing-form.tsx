"use client";

import { useState } from "react";
import { GamePicker } from "@/components/game-picker";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select, Textarea } from "@/components/ui/field";
import {
  COMPLETENESS,
  COMPLETENESS_LABELS,
  CONDITIONS,
  CONDITION_LABELS,
  type Game,
  type Listing,
} from "@/lib/api/types";
import type { ListingWrite } from "@/lib/api/resources";
import type { ApiError } from "@/lib/api/client";

export function ListingForm({
  initial,
  lockedGame,
  submitting,
  error,
  onSubmit,
}: {
  initial?: Partial<Listing>;
  lockedGame?: Game | null;
  submitting?: boolean;
  error?: ApiError | null;
  onSubmit: (body: ListingWrite) => void;
}) {
  const [game, setGame] = useState<Game | null>(
    lockedGame ?? initial?.game ?? null,
  );
  const [condition, setCondition] = useState(initial?.condition ?? "GOOD");
  const [language, setLanguage] = useState(initial?.language ?? "EN");
  const [completeness, setCompleteness] = useState(
    initial?.completeness ?? "COMPLETE",
  );
  const [editionNote, setEditionNote] = useState(initial?.edition_note ?? "");
  const [estimatedValue, setEstimatedValue] = useState(
    initial?.estimated_value ?? "",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!game) {
      setLocalError("Pick a game first.");
      return;
    }
    setLocalError(null);
    onSubmit({
      game_bgg_id: game.bgg_id,
      condition,
      language,
      completeness,
      edition_note: editionNote,
      estimated_value: estimatedValue || null,
      notes,
    });
  }

  const fe = error?.fieldErrors ?? {};

  return (
    <form onSubmit={submit} className="space-y-4">
      <FormField label="Game" error={fe.game_bgg_id}>
        {lockedGame ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium">
            {lockedGame.name}
          </div>
        ) : (
          <GamePicker selected={game} onSelect={setGame} />
        )}
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Condition" error={fe.condition}>
          <Select
            value={condition}
            onChange={(e) => setCondition(e.target.value as typeof condition)}
          >
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABELS[c]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Completeness" error={fe.completeness}>
          <Select
            value={completeness}
            onChange={(e) =>
              setCompleteness(e.target.value as typeof completeness)
            }
          >
            {COMPLETENESS.map((c) => (
              <option key={c} value={c}>
                {COMPLETENESS_LABELS[c]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Language" error={fe.language}>
          <Input value={language} onChange={(e) => setLanguage(e.target.value)} />
        </FormField>
        <FormField label="Estimated value" error={fe.estimated_value}>
          <Input
            type="number"
            step="0.01"
            value={estimatedValue ?? ""}
            onChange={(e) => setEstimatedValue(e.target.value)}
            placeholder="0.00"
          />
        </FormField>
      </div>

      <FormField label="Edition note" error={fe.edition_note}>
        <Input
          value={editionNote}
          onChange={(e) => setEditionNote(e.target.value)}
          placeholder="e.g. 2nd edition, German printing"
        />
      </FormField>

      <FormField label="Notes" error={fe.notes}>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </FormField>

      {(localError || error?.detail) && (
        <p className="text-sm text-red-600">{localError || error?.detail}</p>
      )}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Saving…" : "Save copy"}
      </Button>
    </form>
  );
}
