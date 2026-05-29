"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { listings, type ListingWrite } from "@/lib/api/resources";
import { qk } from "@/lib/api/queryKeys";
import { ApiError } from "@/lib/api/client";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { ListingForm } from "@/components/listing-form";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  ErrorState,
  Spinner,
} from "@/components/ui/primitives";
import { FormField, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

export default function ListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const qc = useQueryClient();
  const router = useRouter();
  const { me } = useAuth();
  const { toast } = useToast();
  const [caption, setCaption] = useState("");

  const query = useQuery({
    queryKey: qk.listing(id),
    queryFn: () => listings.get(id),
  });

  const update = useMutation({
    mutationFn: (body: ListingWrite) => listings.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["listings"] });
      qc.invalidateQueries({ queryKey: qk.listing(id) });
      toast("Copy updated.", "success");
    },
  });

  const remove = useMutation({
    mutationFn: () => listings.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["listings"] });
      toast("Copy deleted.", "success");
      router.push("/listings");
    },
  });

  const addPhoto = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.set("caption", caption);
      return listings.addPhoto(id, fd);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.listing(id) });
      setCaption("");
      toast("Photo added.", "success");
    },
  });

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return <ErrorState message="Copy not found." />;
  }

  const listing = query.data;
  const isOwner = me?.user_id === listing.owner;

  return (
    <div className="max-w-2xl space-y-6">
      <Link
        href="/listings"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Back to my copies
      </Link>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">
          {listing.game.name}
        </h1>
        {isOwner && (
          <Button
            variant="danger"
            size="sm"
            disabled={remove.isPending}
            onClick={() => {
              if (confirm("Delete this copy?")) remove.mutate();
            }}
          >
            Delete
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{isOwner ? "Edit copy" : "Details"}</CardTitle>
        </CardHeader>
        <CardBody>
          {isOwner ? (
            <ListingForm
              initial={listing}
              lockedGame={listing.game}
              submitting={update.isPending}
              error={update.error as ApiError | null}
              onSubmit={(body) => update.mutate(body)}
            />
          ) : (
            <p className="text-sm text-slate-500">
              This copy belongs to {listing.owner_username}.
            </p>
          )}
        </CardBody>
      </Card>

      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle>Photos</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {listing.photos.length > 0 ? (
              <ul className="space-y-1 text-sm text-slate-600">
                {listing.photos.map((p) => (
                  <li key={p.id}>📷 {p.caption || "Untitled photo"}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No photos yet.</p>
            )}
            <div className="flex items-end gap-2">
              <FormField label="Add a photo caption" htmlFor="caption">
                <Input
                  id="caption"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Front of box"
                />
              </FormField>
              <Button
                variant="secondary"
                disabled={addPhoto.isPending}
                onClick={() => addPhoto.mutate()}
              >
                Add
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              Image upload is multipart; the caption-only form here keeps the demo
              simple.
            </p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
