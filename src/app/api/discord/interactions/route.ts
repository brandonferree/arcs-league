import { revalidatePath } from "next/cache";
import { after, NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { appUrl } from "@/server/discord";
import { botConfig, restApi, verifyDiscordRequest } from "@/server/bot/discord-api";
import { handleInteraction, type Interaction } from "@/server/bot/interactions";

/**
 * Discord's interactions endpoint (spec section 2): slash commands, buttons and
 * autocomplete arrive here as signed requests. Set this URL as the
 * application's "Interactions Endpoint URL" (docs/SETUP.md step 7).
 */
export async function POST(req: NextRequest) {
  const cfg = botConfig();
  if (!cfg) return NextResponse.json({ error: "The Discord bot is not configured." }, { status: 503 });

  const body = await req.text();
  const ok = verifyDiscordRequest(
    cfg.publicKey,
    req.headers.get("x-signature-ed25519"),
    req.headers.get("x-signature-timestamp"),
    body,
  );
  if (!ok) return NextResponse.json({ error: "Bad request signature." }, { status: 401 });

  let interaction: Interaction;
  try {
    interaction = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Not JSON." }, { status: 400 });
  }

  const handled = await handleInteraction({ db: getDb, api: restApi(cfg), cfg, base: appUrl() }, interaction);
  if (handled.work) {
    const work = handled.work;
    after(async () => {
      await work();
      // A lobby start creates a campaign; keep the site's lists fresh.
      try {
        revalidatePath("/");
        revalidatePath("/campaigns");
      } catch (err) {
        console.error("discord bot: revalidate failed", err);
      }
    });
  }
  return NextResponse.json(handled.response);
}
