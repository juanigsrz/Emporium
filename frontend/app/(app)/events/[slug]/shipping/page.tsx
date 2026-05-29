"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { events, shipments } from "@/lib/api/resources";
import { qk } from "@/lib/api/queryKeys";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  Spinner,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { capabilitiesFor } from "@/lib/lifecycle";
import type { ShipmentStatus } from "@/lib/api/types";

const STATUS_TONE: Record<ShipmentStatus, "neutral" | "info" | "success"> = {
  PENDING: "neutral",
  SHIPPED: "info",
  RECEIVED: "success",
};

export default function ShippingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const qc = useQueryClient();
  const { me } = useAuth();
  const { toast } = useToast();
  const [tracking, setTracking] = useState<Record<number, string>>({});

  const event = useQuery({ queryKey: qk.event(slug), queryFn: () => events.get(slug) });
  const shipList = useQuery({
    queryKey: qk.shipping(slug),
    queryFn: () => events.shipping(slug),
    enabled: Boolean(event.data),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: qk.shipping(slug) });

  const markShipped = useMutation({
    mutationFn: ({ id, t }: { id: number; t: string }) =>
      shipments.markShipped(id, t),
    onSuccess: () => {
      invalidate();
      toast("Marked as shipped.", "success");
    },
  });
  const markReceived = useMutation({
    mutationFn: (id: number) => shipments.markReceived(id),
    onSuccess: () => {
      invalidate();
      toast("Marked as received.", "success");
    },
  });

  if (!event.data) return null;
  const caps = capabilitiesFor(event.data.status, me?.user_id === event.data.organizer);

  if (!caps.shippingActive) {
    return (
      <EmptyState
        title="Shipping not active yet"
        description="Shipping obligations appear once the event reaches the shipping stage."
      />
    );
  }

  return (
    <div className="space-y-3">
      {shipList.isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : shipList.data && shipList.data.length > 0 ? (
        shipList.data.map((s) => {
          const a = s.assignment_detail;
          const isSender = s.role === "SENDER";
          return (
            <Card key={s.id}>
              <CardBody className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge tone={isSender ? "warning" : "info"}>
                      {isSender ? "You ship" : "You receive"}
                    </Badge>
                    {a.entry_detail.item_token && (
                      <Badge tone="info">{a.entry_detail.item_token}</Badge>
                    )}
                    <span className="font-medium text-slate-800">
                      {a.entry_detail.listing_detail.game.name}
                    </span>
                    <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
                  </div>
                  <p className="text-sm text-slate-500">
                    {isSender
                      ? `To ${a.recipient_username}`
                      : `From ${a.sender_username}`}
                    {s.tracking && ` · tracking ${s.tracking}`}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {isSender && s.status === "PENDING" && (
                    <>
                      <Input
                        value={tracking[s.id] ?? ""}
                        onChange={(e) =>
                          setTracking((t) => ({ ...t, [s.id]: e.target.value }))
                        }
                        placeholder="Tracking #"
                        className="h-9 w-36"
                      />
                      <Button
                        size="sm"
                        disabled={markShipped.isPending}
                        onClick={() =>
                          markShipped.mutate({ id: s.id, t: tracking[s.id] ?? "" })
                        }
                      >
                        Mark shipped
                      </Button>
                    </>
                  )}
                  {!isSender && s.status !== "RECEIVED" && (
                    <Button
                      size="sm"
                      disabled={markReceived.isPending}
                      onClick={() => markReceived.mutate(s.id)}
                    >
                      Mark received
                    </Button>
                  )}
                </div>
              </CardBody>
            </Card>
          );
        })
      ) : (
        <EmptyState
          title="No shipments"
          description="You have nothing to ship or receive in this event."
        />
      )}
    </div>
  );
}
