import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { MAX_SUMMARY_BYTES } from "@/lib/import/act-summary";
import { appUrl } from "@/server/discord";
import { bearerMatches, importResponse, importSecret } from "@/server/import-http";
import { receiveImport } from "@/server/imports";

/**
 * meeples pushes each finished act here (docs/ACT_SUMMARY_FORMAT.md, "Push").
 * Server to server: authenticated by the shared MEEPLES_IMPORT_SECRET, never by
 * a session. Responses: 201 saved, 202 pending, 400 invalid, 401 unauthorized,
 * 409 conflict, 413 too large, 503 when pushes are not configured.
 */
export async function POST(req: NextRequest) {
  const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status });

  const secret = importSecret();
  if (!secret) return reply(503, { status: "disabled" });
  if (!bearerMatches(req.headers.get("authorization"), secret)) return reply(401, { status: "unauthorized" });

  if (Number(req.headers.get("content-length") ?? 0) > MAX_SUMMARY_BYTES) {
    return reply(413, { status: "invalid", errors: ["The summary is larger than 64 KB."] });
  }
  const text = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, { status: "invalid", errors: ["The summary is not valid JSON."] });
  }
  const platform = (body as { source?: { platform?: unknown } })?.source?.platform;
  if (platform !== "meeples") {
    return reply(400, { status: "invalid", errors: ['source.platform must be "meeples" for pushes.'] });
  }

  try {
    const outcome = await receiveImport(await getDb(), text);
    if (outcome.status === "saved") {
      revalidatePath("/");
      revalidatePath("/campaigns");
      revalidatePath(`/campaigns/${outcome.campaignId}`);
    }
    const res = importResponse(outcome, appUrl());
    return reply(res.status, res.body);
  } catch (err) {
    console.error("import push failed", err);
    return reply(500, { status: "error" });
  }
}
