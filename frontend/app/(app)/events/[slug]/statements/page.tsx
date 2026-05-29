"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import {
  entries,
  events,
  statements,
  type StatementWrite,
} from "@/lib/api/resources";
import { qk } from "@/lib/api/queryKeys";
import { useAuth } from "@/components/auth-provider";
import { StatementBuilder } from "@/components/statement-builder";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  Spinner,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { capabilitiesFor } from "@/lib/lifecycle";
import type { TradeStatement } from "@/lib/api/types";

export default function StatementsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const qc = useQueryClient();
  const { me } = useAuth();
  const { toast } = useToast();
  const [editing, setEditing] = useState<TradeStatement | "new" | null>(null);

  const event = useQuery({ queryKey: qk.event(slug), queryFn: () => events.get(slug) });
  const stmtList = useQuery({
    queryKey: qk.statements(slug),
    queryFn: () => statements.list(slug),
  });
  const entryList = useQuery({
    queryKey: qk.entries(slug),
    queryFn: () => entries.list(slug),
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: qk.statements(slug) });

  const create = useMutation({
    mutationFn: (body: StatementWrite) => statements.create(slug, body),
    onSuccess: () => {
      invalidate();
      setEditing(null);
      toast("Statement saved.", "success");
    },
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: StatementWrite }) =>
      statements.update(slug, id, body),
    onSuccess: () => {
      invalidate();
      setEditing(null);
      toast("Statement updated.", "success");
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => statements.remove(slug, id),
    onSuccess: () => {
      invalidate();
      toast("Statement deleted.", "success");
    },
  });

  if (!event.data) return null;
  const caps = capabilitiesFor(event.data.status, me?.user_id === event.data.organizer);

  const myEntries = entryList.data?.filter((e) => e.owner === me?.user_id) ?? [];
  const myStatements =
    stmtList.data?.filter((s) => s.owner === me?.user_id) ?? [];

  return (
    <div className="space-y-5">
      {caps.canEditStatements ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
            Build your want list. Each statement says “give at most M of these, get
            at least N of those.”
          </p>
          <Button onClick={() => setEditing("new")} disabled={myEntries.length === 0}>
            <Plus className="h-4 w-4" /> New statement
          </Button>
        </div>
      ) : (
        <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">
          Want lists are {event.data.status === "DRAFT" || event.data.status === "OPEN_SUBMISSIONS" ? "not open yet" : "frozen"} for this event stage.
        </p>
      )}

      {stmtList.isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : myStatements.length > 0 ? (
        <div className="space-y-3">
          {myStatements.map((s) => (
            <Card key={s.id}>
              <CardBody className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm">
                      <span className="text-slate-500">Give ≤ {s.give_at_most}:</span>
                      {s.offer_entries_detail.map((e) => (
                        <Badge key={e.id}>
                          {e.item_token ? `${e.item_token} · ` : ""}
                          {e.listing_detail.game.name}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-sm">
                      <span className="text-slate-500">Get ≥ {s.get_at_least}:</span>
                      {s.want_games_detail.map((g) => (
                        <Badge key={g.bgg_id} tone="info">
                          {g.name}
                        </Badge>
                      ))}
                    </div>
                    {s.want_filters && Object.keys(s.want_filters).length > 0 && (
                      <p className="text-xs text-slate-400">
                        Filters: {JSON.stringify(s.want_filters)}
                      </p>
                    )}
                  </div>
                  {caps.canEditStatements && (
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(s)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (confirm("Delete this statement?")) remove.mutate(s.id);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No statements yet"
          description={
            caps.canEditStatements
              ? myEntries.length === 0
                ? "Enter some of your copies first, then author a want list."
                : "Create your first want list or bundle."
              : "You authored no statements for this event."
          }
        />
      )}

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New statement" : "Edit statement"}
        className="max-w-2xl"
      >
        {editing !== null && (
          <StatementBuilder
            myEntries={myEntries}
            allowBundles={event.data.allow_bundles}
            initial={editing === "new" ? undefined : editing}
            submitting={create.isPending || update.isPending}
            onCancel={() => setEditing(null)}
            onSubmit={(body) =>
              editing === "new"
                ? create.mutate(body)
                : update.mutate({ id: editing.id, body })
            }
          />
        )}
      </Dialog>
    </div>
  );
}
