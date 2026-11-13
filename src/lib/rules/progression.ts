/**
 * Progression colour key for campaign detail: how each act's fate relates to the
 * player's previous act.
 */
import type { ActEntry } from "./validate";

export type ProgressionStep = "started" | "kept" | "changed-after-success" | "changed-after-failure";

export const PROGRESSION_LABELS: Record<ProgressionStep, string> = {
  started: "Started",
  kept: "Kept",
  "changed-after-success": "Changed after success",
  "changed-after-failure": "Changed after failure",
};

/** One step per act present, in act order. Stops at the first missing act. */
export function progressionSteps(acts: ReadonlyArray<ActEntry | null | undefined>): ProgressionStep[] {
  const steps: ProgressionStep[] = [];
  for (let i = 0; i < acts.length; i++) {
    const cur = acts[i];
    if (!cur?.fate) break;
    if (i === 0) {
      steps.push("started");
      continue;
    }
    const prev = acts[i - 1]!;
    if (cur.fate === prev.fate) steps.push("kept");
    else steps.push(prev.success ? "changed-after-success" : "changed-after-failure");
  }
  return steps;
}
