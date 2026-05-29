import type { EventStatus } from "@/lib/api/types";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export function eventStatusTone(status: EventStatus): Tone {
  switch (status) {
    case "DRAFT":
      return "neutral";
    case "OPEN_SUBMISSIONS":
    case "OPEN_WANTLIST":
      return "info";
    case "MATCHING":
      return "warning";
    case "MATCH_REVIEW":
    case "FINALIZED":
      return "success";
    case "SHIPPING":
      return "info";
    case "ARCHIVED":
      return "neutral";
    default:
      return "neutral";
  }
}
