"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { entries, events, listings } from "@/lib/api/resources";
import { qk } from "@/lib/api/queryKeys";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  Spinner,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { capabilitiesFor } from "@/lib/lifecycle";

export default function EntriesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const qc = useQueryClient();
  const { me } = useAuth();
  const { toast } = useToast();
  const [pick, setPick] = useState("");

  const event = useQuery({ queryKey: qk.event(slug), queryFn: () => events.get(slug) });
  const entryList = useQuery({
    queryKey: qk.entries(slug),
    queryFn: () => entries.list(slug),
  });
  const myListings = useQuery({
    queryKey: qk.listings({ mine: true }),
    queryFn: () => listings.list({ mine: true }),
  });

  const enter = useMutation({
    mutationFn: (listingId: number) => entries.enter(slug, listingId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.entries(slug) });
      setPick("");
      toast("Copy entered.", "success");
    },
  });
  const withdraw = useMutation({
    mutationFn: (entryId: number) => entries.withdraw(slug, entryId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.entries(slug) });
      toast("Copy withdrawn.", "success");
    },
  });

  if (!event.data) return null;
  const caps = capabilitiesFor(event.data.status, me?.user_id === event.data.organizer);

  const enteredListingIds = new Set(entryList.data?.map((e) => e.listing));
  const available =
    myListings.data?.results.filter((l) => !enteredListingIds.has(l.id)) ?? [];

  return (
    <div className="space-y-5">
      {caps.canManageEntries ? (
        <Card>
          <CardBody className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-60">
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Enter one of your copies
              </label>
              <Select value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Select a copy…</option>
                {available.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.game.name} — {l.condition}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              disabled={!pick || enter.isPending}
              onClick={() => enter.mutate(Number(pick))}
            >
              Enter copy
            </Button>
          </CardBody>
        </Card>
      ) : (
        <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">
          Submissions are frozen for this event stage. Entered copies are shown
          below
          {caps.tokensPublished ? " with their item tokens." : "."}
        </p>
      )}

      {entryList.isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : entryList.data && entryList.data.length > 0 ? (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-slate-500">
                <tr>
                  {caps.tokensPublished && (
                    <th className="px-4 py-2 font-medium">Token</th>
                  )}
                  <th className="px-4 py-2 font-medium">Game</th>
                  <th className="px-4 py-2 font-medium">Owner</th>
                  <th className="px-4 py-2 font-medium">Condition</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entryList.data.map((e) => {
                  const mine = e.owner === me?.user_id;
                  return (
                    <tr key={e.id}>
                      {caps.tokensPublished && (
                        <td className="px-4 py-2">
                          {e.item_token ? (
                            <Badge tone="info">{e.item_token}</Badge>
                          ) : (
                            "—"
                          )}
                        </td>
                      )}
                      <td className="px-4 py-2 font-medium text-slate-800">
                        {e.listing_detail.game.name}
                      </td>
                      <td className="px-4 py-2">
                        {e.owner_username}
                        {mine && <span className="text-slate-400"> (you)</span>}
                      </td>
                      <td className="px-4 py-2">{e.listing_detail.condition}</td>
                      <td className="px-4 py-2 text-right">
                        {mine && caps.canManageEntries && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={withdraw.isPending}
                            onClick={() => withdraw.mutate(e.id)}
                          >
                            Withdraw
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <EmptyState
          title="No copies entered yet"
          description={
            caps.canManageEntries
              ? "Enter one of your copies above to join this trade."
              : "Nothing was entered into this event."
          }
        />
      )}
    </div>
  );
}
