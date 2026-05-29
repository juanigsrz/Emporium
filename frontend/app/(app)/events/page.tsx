"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { events, type EventWrite } from "@/lib/api/resources";
import { qk } from "@/lib/api/queryKeys";
import { ApiError } from "@/lib/api/client";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  Badge,
  Card,
  CardBody,
  CardTitle,
  EmptyState,
  ErrorState,
  Spinner,
} from "@/components/ui/primitives";
import { FormField, Input, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { EVENT_STATUS_LABELS } from "@/lib/api/types";
import { eventStatusTone } from "@/components/event-status-badge";

export default function EventsPage() {
  const qc = useQueryClient();
  const { me } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", region_rule: "" });

  const query = useQuery({ queryKey: qk.events(), queryFn: () => events.list() });

  const create = useMutation({
    mutationFn: (body: EventWrite) => events.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      setOpen(false);
      setForm({ name: "", description: "", region_rule: "" });
      toast("Event created.", "success");
    },
  });

  const fe = (create.error as ApiError | null)?.fieldErrors ?? {};

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Events</h1>
          <p className="text-slate-500">Math-trade events you can join or run.</p>
        </div>
        {me?.is_organizer && (
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> New event
          </Button>
        )}
      </div>

      {query.isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-6 w-6" />
        </div>
      ) : query.isError ? (
        <ErrorState message="Could not load events." />
      ) : query.data && query.data.results.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {query.data.results.map((e) => (
            <Link key={e.slug} href={`/events/${e.slug}`}>
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardBody className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle>{e.name}</CardTitle>
                    <Badge tone={eventStatusTone(e.status)}>
                      {EVENT_STATUS_LABELS[e.status]}
                    </Badge>
                  </div>
                  <p className="line-clamp-2 text-sm text-slate-500">
                    {e.description || "No description."}
                  </p>
                  <p className="text-xs text-slate-400">
                    Organized by {e.organizer_username}
                  </p>
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title="No events yet" description="Check back later." />
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title="Create event">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(form);
          }}
        >
          <FormField label="Name" error={fe.name}>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </FormField>
          <FormField label="Description" error={fe.description}>
            <Textarea
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
            />
          </FormField>
          <FormField label="Region rule" error={fe.region_rule} hint="e.g. EU, US-48, LATAM">
            <Input
              value={form.region_rule}
              onChange={(e) =>
                setForm((f) => ({ ...f, region_rule: e.target.value }))
              }
            />
          </FormField>
          {(create.error as ApiError | null)?.detail && (
            <p className="text-sm text-red-600">
              {(create.error as ApiError).detail}
            </p>
          )}
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create event"}
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
