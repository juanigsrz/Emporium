"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { listings, type ListingWrite } from "@/lib/api/resources";
import { qk } from "@/lib/api/queryKeys";
import { ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ListingForm } from "@/components/listing-form";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Spinner,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { CONDITION_LABELS } from "@/lib/api/types";
import { formatValue } from "@/lib/utils";

export default function ListingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const query = useQuery({
    queryKey: qk.listings({ mine: true }),
    queryFn: () => listings.list({ mine: true }),
  });

  const create = useMutation({
    mutationFn: (body: ListingWrite) => listings.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["listings"] });
      qc.invalidateQueries({ queryKey: ["games"] });
      setOpen(false);
      toast("Copy added.", "success");
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">My copies</h1>
          <p className="text-slate-500">Copies you own and can offer in trades.</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Add copy
        </Button>
      </div>

      {query.isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-6 w-6" />
        </div>
      ) : query.isError ? (
        <ErrorState message="Could not load your copies." />
      ) : query.data && query.data.results.length > 0 ? (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Game</th>
                  <th className="px-4 py-2 font-medium">Condition</th>
                  <th className="px-4 py-2 font-medium">Language</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {query.data.results.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium text-slate-800">
                      <Link href={`/listings/${l.id}`} className="hover:underline">
                        {l.game.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{CONDITION_LABELS[l.condition]}</td>
                    <td className="px-4 py-2">{l.language}</td>
                    <td className="px-4 py-2">
                      {l.is_active ? (
                        <Badge tone="success">Active</Badge>
                      ) : (
                        <Badge>Inactive</Badge>
                      )}
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
          title="No copies yet"
          description="Add a copy you own, or import your BGG collection from your profile."
          action={<Button onClick={() => setOpen(true)}>Add copy</Button>}
        />
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title="Add a copy">
        <ListingForm
          submitting={create.isPending}
          error={create.error as ApiError | null}
          onSubmit={(body) => create.mutate(body)}
        />
      </Dialog>
    </div>
  );
}
