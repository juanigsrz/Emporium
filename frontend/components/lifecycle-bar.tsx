"use client";

import { EVENT_STATUSES, EVENT_STATUS_LABELS, type EventStatus } from "@/lib/api/types";
import { capabilitiesFor, statusOrder } from "@/lib/lifecycle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function LifecycleBar({
  status,
  isOrganizer,
  onTransition,
  transitioning,
}: {
  status: EventStatus;
  isOrganizer: boolean;
  onTransition: (to: EventStatus) => void;
  transitioning?: boolean;
}) {
  const current = statusOrder(status);
  const caps = capabilitiesFor(status, isOrganizer);

  return (
    <div className="space-y-3">
      <ol className="flex flex-wrap gap-1">
        {EVENT_STATUSES.map((s, i) => (
          <li
            key={s}
            className={cn(
              "rounded px-2 py-1 text-xs font-medium",
              i < current && "bg-slate-100 text-slate-400",
              i === current && "bg-slate-900 text-white",
              i > current && "bg-slate-50 text-slate-400",
            )}
          >
            {EVENT_STATUS_LABELS[s]}
          </li>
        ))}
      </ol>

      {isOrganizer && caps.organizerTransitions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-500">Move to:</span>
          {caps.organizerTransitions.map((to) => (
            <Button
              key={to}
              size="sm"
              variant={statusOrder(to) > current ? "primary" : "secondary"}
              disabled={transitioning}
              onClick={() => onTransition(to)}
            >
              {EVENT_STATUS_LABELS[to]}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
