"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { copyCardImagesAction } from "./actions";

/** Copies card images batch by batch, showing progress, until none are left. */
export function CopyImages({ waiting, total }: { waiting: number; total: number }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [left, setLeft] = useState(waiting);
  const [failed, setFailed] = useState<{ id: string; name: string; error: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    const skip: string[] = [];
    const failures: typeof failed = [];
    try {
      for (;;) {
        const r = await copyCardImagesAction(skip);
        if (!r.ok) {
          setError(r.error);
          break;
        }
        failures.push(...r.failed);
        skip.push(...r.failed.map((f) => f.id));
        setFailed([...failures]);
        setLeft(r.remaining);
        if (r.remaining <= skip.length || (r.copied === 0 && r.failed.length === 0)) break;
      }
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  return (
    <div className="photo-acts">
      <p style={{ margin: 0 }}>
        Card images: {total - left} of {total} copied.
        {left ? ` ${left} waiting.` : ""}
      </p>
      {left > 0 ? (
        <div>
          <button className="btn btn--cyan" type="button" onClick={run} disabled={running}>
            {running ? `Copying… ${left} left` : "Copy card images"}
          </button>
          <p className="small muted" style={{ margin: "8px 0 0" }}>
            Downloads each image once from Buried Giant and keeps our own copy, about 200 KB per card. Keep this page
            open until it finishes.
          </p>
        </div>
      ) : null}
      {error ? (
        <p className="photo-upload__error" role="alert">
          {error}
        </p>
      ) : null}
      {failed.length ? (
        <p className="photo-upload__error" role="alert">
          Could not copy {failed.length}: {failed.slice(0, 10).map((f) => `${f.name} (${f.error})`).join(", ")}
          {failed.length > 10 ? "…" : ""}. They stay waiting; try again later.
        </p>
      ) : null}
    </div>
  );
}
