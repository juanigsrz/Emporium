"use client";

import { use } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Play } from "lucide-react";
import { events } from "@/lib/api/resources";
import { qk } from "@/lib/api/queryKeys";
import { useAuth } from "@/components/auth-provider";
import { LifecycleBar } from "@/components/lifecycle-bar";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardBody, ErrorState, Spinner } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { EVENT_STATUS_LABELS, type EventStatus } from "@/lib/api/types";
import { capabilitiesFor } from "@/lib/lifecycle";
import { eventStatusTone } from "@/components/event-status-badge";
import { cn } from "@/lib/utils";

const TABS = [
  { seg: "", label: "Overview" },
  { seg: "entries", label: "Copies" },
  { seg: "statements", label: "Want list" },
  { seg: "result", label: "Results" },
  { seg: "shipping", label: "Shipping" },
];

export default function EventLayout({
  params,
  children,
}: {
  params: Promise<{ slug: string }>;
  children: React.ReactNode;
}) {
  const { slug } = use(params);
  const pathname = usePathname();
  const qc = useQueryClient();
  const { me } = useAuth();
  const { toast } = useToast();

  const query = useQuery({
    queryKey: qk.event(slug),
    queryFn: () => events.get(slug),
  });

  const transition = useMutation({
    mutationFn: (to: EventStatus) => events.transition(slug, to),
    onSuccess: (e) => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: qk.event(slug) });
      qc.invalidateQueries({ queryKey: ["events", "detail", slug] });
      toast(`Moved to “${EVENT_STATUS_LABELS[e.status]}”.`, "success");
    },
    onError: () => toast("Transition failed.", "error"),
  });

  const runMatch = useMutation({
    mutationFn: () => events.runMatch(slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.result(slug) });
      toast("Match computed. Review the results tab.", "success");
    },
    onError: () => toast("Run failed.", "error"),
  });

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return <ErrorState message="Event not found." />;
  }

  const event = query.data;
  const isOrganizer = me?.user_id === event.organizer;
  const caps = capabilitiesFor(event.status, isOrganizer);
  const base = `/events/${slug}`;

  return (
    <div className="space-y-6">
      <Link
        href="/events"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Back to events
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-slate-900">{event.name}</h1>
            <Badge tone={eventStatusTone(event.status)}>
              {EVENT_STATUS_LABELS[event.status]}
            </Badge>
            {isOrganizer && <Badge tone="info">You organize</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {event.description || "No description."}
          </p>
        </div>
        {caps.canRunMatch && (
          <Button disabled={runMatch.isPending} onClick={() => runMatch.mutate()}>
            <Play className="h-4 w-4" />
            {runMatch.isPending ? "Running…" : "Run match"}
          </Button>
        )}
      </div>

      <Card>
        <CardBody>
          <LifecycleBar
            status={event.status}
            isOrganizer={isOrganizer}
            transitioning={transition.isPending}
            onTransition={(to) => transition.mutate(to)}
          />
        </CardBody>
      </Card>

      <nav className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => {
          const href = t.seg ? `${base}/${t.seg}` : base;
          const active = pathname === href;
          return (
            <Link
              key={t.seg}
              href={href}
              className={cn(
                "border-b-2 px-3 py-2 text-sm font-medium",
                active
                  ? "border-slate-900 text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-800",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      <div>{children}</div>
    </div>
  );
}
