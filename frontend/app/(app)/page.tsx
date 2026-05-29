"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-provider";
import { events, listings } from "@/lib/api/resources";
import { qk } from "@/lib/api/queryKeys";
import { Card, CardBody, CardTitle } from "@/components/ui/primitives";
import { EVENT_STATUS_LABELS } from "@/lib/api/types";

export default function DashboardPage() {
  const { me } = useAuth();
  const myListings = useQuery({
    queryKey: qk.listings({ mine: true }),
    queryFn: () => listings.list({ mine: true }),
  });
  const allEvents = useQuery({
    queryKey: qk.events(),
    queryFn: () => events.list(),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          Welcome back, {me?.username}
        </h1>
        <p className="text-slate-500">
          Browse games, manage your copies, and join trade events.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="/listings">
          <Card className="transition-shadow hover:shadow-md">
            <CardBody>
              <CardTitle>My copies</CardTitle>
              <p className="mt-1 text-3xl font-bold text-slate-900">
                {myListings.data?.count ?? "—"}
              </p>
            </CardBody>
          </Card>
        </Link>
        <Link href="/events">
          <Card className="transition-shadow hover:shadow-md">
            <CardBody>
              <CardTitle>Events</CardTitle>
              <p className="mt-1 text-3xl font-bold text-slate-900">
                {allEvents.data?.count ?? "—"}
              </p>
            </CardBody>
          </Card>
        </Link>
        <Link href="/me">
          <Card className="transition-shadow hover:shadow-md">
            <CardBody>
              <CardTitle>BGG link</CardTitle>
              <p className="mt-1 text-sm text-slate-600">
                {me?.bgg_username
                  ? `${me.bgg_username}${me.bgg_verified ? " ✓" : " (unverified)"}`
                  : "Not linked"}
              </p>
            </CardBody>
          </Card>
        </Link>
      </div>

      <Card>
        <CardBody>
          <CardTitle>Recent events</CardTitle>
          <ul className="mt-3 divide-y divide-slate-100">
            {allEvents.data?.results.map((e) => (
              <li key={e.slug} className="py-2">
                <Link
                  href={`/events/${e.slug}`}
                  className="flex items-center justify-between hover:underline"
                >
                  <span className="font-medium text-slate-800">{e.name}</span>
                  <span className="text-sm text-slate-500">
                    {EVENT_STATUS_LABELS[e.status]}
                  </span>
                </Link>
              </li>
            ))}
            {allEvents.data?.results.length === 0 && (
              <li className="py-2 text-sm text-slate-500">No events yet.</li>
            )}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
