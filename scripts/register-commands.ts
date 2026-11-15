/**
 * Registers the bot's slash commands on the league's server. Needs
 * DISCORD_CLIENT_ID, DISCORD_BOT_TOKEN and DISCORD_GUILD_ID in .env.local (or
 * the environment). Moderators can do the same from /admin/discord on the site.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { inviteUrl, registerCommands } from "../src/server/bot/register";

const applicationId = process.env.DISCORD_CLIENT_ID?.trim();
const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
const guildId = process.env.DISCORD_GUILD_ID?.trim();

if (!applicationId || !botToken || !guildId) {
  console.error("Set DISCORD_CLIENT_ID, DISCORD_BOT_TOKEN and DISCORD_GUILD_ID first (see docs/SETUP.md step 7).");
  process.exit(1);
}

registerCommands({ applicationId, botToken, guildId })
  .then((names) => console.log(`Registered: /${names.join(", /")}`))
  .catch((err: Error) => {
    console.error(err.message);
    console.error(`Invite link: ${inviteUrl(applicationId)}`);
    process.exit(1);
  });
