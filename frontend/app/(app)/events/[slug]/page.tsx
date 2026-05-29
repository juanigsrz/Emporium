"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { events } from "@/lib/api/resources";
import { qk } from "@/lib/api/queryKeys";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { formatDate } from "@/lib/utils";

export default function EventOverviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const query = useQuery({
    queryKey: qk.event(slug),
    queryFn: () => events.get(slug),
  });
  const event = query.data;
  if (!event) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Event details</CardTitle>
      </CardHeader>
      <CardBody className="grid gap-2 text-sm sm:grid-cols-2">
        <Row label="Organizer" value={event.organizer_username} />
        <Row label="Region rule" value={event.region_rule || "—"} />
        <Row label="Bundles (M-to-N)" value={event.allow_bundles ? "Allowed" : "Not allowed"} />
        <Row
          label="Max copies / user"
          value={event.max_listings_per_user?.toString() ?? "Unlimited"}
        />
        <Row label="Submissions close" value={formatDate(event.submissions_close_at)} />
        <Row label="Want list closes" value={formatDate(event.wantlist_close_at)} />
        <Row label="Created" value={formatDate(event.created_at)} />
      </CardBody>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-slate-50 py-1.5">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800">{value}</span>
    </div>
  );
}
