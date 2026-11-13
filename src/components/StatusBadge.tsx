import type { CampaignStatus } from "@/db/schema";

const LABEL: Record<CampaignStatus | "stalled", string> = {
  in_progress: "In progress",
  closed: "Closed",
  void: "Void",
  stalled: "Stalled",
};

export function StatusBadge({ status, stalled }: { status: CampaignStatus; stalled?: boolean }) {
  const key = stalled ? "stalled" : status;
  return <span className={`badge badge--${key}`}>{LABEL[key]}</span>;
}
