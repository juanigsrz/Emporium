"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { events } from "@/lib/api/resources";
import { qk } from "@/lib/api/queryKeys";
import { useAuth } from "@/components/auth-provider";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Spinner,
} from "@/components/ui/primitives";
import { capabilitiesFor } from "@/lib/lifecycle";

export default function ResultPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const { me } = useAuth();

  const event = useQuery({ queryKey: qk.event(slug), queryFn: () => events.get(slug) });
  const result = useQuery({
    queryKey: qk.result(slug),
    queryFn: () => events.result(slug),
    enabled: Boolean(event.data),
  });

  if (!event.data) return null;
  const isOrganizer = me?.user_id === event.data.organizer;
  const caps = capabilitiesFor(event.data.status, isOrganizer);

  if (!caps.resultsVisible) {
    return (
      <EmptyState
        title="Results not available yet"
        description="Results appear once the organizer has run the match and moved the event to review."
      />
    );
  }

  if (result.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }

  const data = result.data;
  if (!data?.result) {
    return (
      <EmptyState
        title="No match computed yet"
        description="The organizer hasn't produced a result for this event."
      />
    );
  }

  const r = data.result;
  const shipping = data.my_assignments.filter(
    (a) => a.sender_username === me?.username,
  );
  const receiving = data.my_assignments.filter(
    (a) => a.recipient === me?.user_id,
  );

  return (
    <div className="space-y-5">
      <Card>
        <CardBody className="flex flex-wrap items-center gap-6">
          <Stat label="Status" value={r.status} />
          <Stat label="Items traded" value={String(r.items_traded ?? "—")} />
          <Stat label="Users trading" value={String(r.users_trading ?? "—")} />
        </CardBody>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>You ship</CardTitle>
          </CardHeader>
          <CardBody>
            {shipping.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {shipping.map((a) => (
                  <li key={a.id} className="flex items-center gap-2">
                    {a.entry_detail.item_token && (
                      <Badge tone="info">{a.entry_detail.item_token}</Badge>
                    )}
                    <span className="font-medium">
                      {a.entry_detail.listing_detail.game.name}
                    </span>
                    <ArrowRight className="h-4 w-4 text-slate-400" />
                    <span>{a.recipient_username}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Nothing to ship.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>You receive</CardTitle>
          </CardHeader>
          <CardBody>
            {receiving.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {receiving.map((a) => (
                  <li key={a.id} className="flex items-center gap-2">
                    {a.entry_detail.item_token && (
                      <Badge tone="info">{a.entry_detail.item_token}</Badge>
                    )}
                    <span className="font-medium">
                      {a.entry_detail.listing_detail.game.name}
                    </span>
                    <span className="text-slate-400">from</span>
                    <span>{a.sender_username}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Nothing to receive.</p>
            )}
          </CardBody>
        </Card>
      </div>

      {isOrganizer && r.input_text && (
        <Card>
          <CardHeader>
            <CardTitle>Engine input (DSL mirror)</CardTitle>
          </CardHeader>
          <CardBody>
            <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
              {r.input_text}
            </pre>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
}
