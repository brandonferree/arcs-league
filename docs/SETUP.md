# Setup: accounts, credentials and environment variables

Everything here is free tier. You need three things: a **Discord application** (for sign-in), a **Neon Postgres database** and a **Vercel project**. Nothing in this file is secret; the values you collect are. Put them only in Vercel's environment variables (and your own `.env.local`), never in the repository.

At the end you will have set these variables in Vercel:

| Variable | Where it comes from | Secret? |
| --- | --- | --- |
| `DATABASE_URL` | Neon (step 2) | Yes |
| `APP_URL` | Your Vercel address (step 3) | No |
| `SESSION_SECRET` | You generate it (step 3) | Yes |
| `DISCORD_CLIENT_ID` | Discord application, OAuth2 page (step 1) | No, but keep it out of the repo |
| `DISCORD_CLIENT_SECRET` | Discord application, OAuth2 page (step 1) | Yes |
| `DISCORD_GUILD_ID` | Your Discord server (step 1) | Keep private |
| `DISCORD_MOD_ROLE_ID` | The moderator role in your server (step 1) | Keep private |
| `BLOB_READ_WRITE_TOKEN` | Added by Vercel when you connect a Blob store (step 4, photos) | Yes |
| `MEEPLES_IMPORT_SECRET` | You generate it (step 6, meeples imports) | Yes |
| `DISCORD_PUBLIC_KEY` | Discord application, General Information page (step 7, bot) | No, but keep it out of the repo |
| `DISCORD_BOT_TOKEN` | Discord application, Bot page (step 7) | Yes |
| `DISCORD_ARCS_CHANNEL_ID` | The `#arcs` channel in your server (step 7) | Keep private |

**Never set `DEV_AUTH_STUB` on Vercel.** (It is ignored in production builds anyway.)

---

## 1. Discord application (sign-in)

1. Go to <https://discord.com/developers/applications> and sign in with your Discord account.
2. Click **New Application**, name it `ARCS League`, accept the terms, click **Create**.
3. Optional: on **General Information**, upload an icon. This is what members see on the sign-in consent screen.
4. Open **OAuth2** in the left menu.
   - Copy **Client ID** → this is `DISCORD_CLIENT_ID`.
   - Click **Reset Secret**, confirm, and copy the secret → this is `DISCORD_CLIENT_SECRET`. Discord shows it only once; if you lose it, reset it again and update Vercel.
   - Under **Redirects**, click **Add Redirect** and add, exactly:
     - `https://YOUR-PROJECT.vercel.app/api/auth/callback` (use the real address from step 3; you can come back and add it)
     - `http://localhost:3000/api/auth/callback` (for testing real sign-in on your own machine)
   - Click **Save Changes**.
   - You do not need the URL generator or any bot permissions for sign-in. The site asks for the `identify` and `guilds.members.read` scopes itself: your name and avatar, and your membership and roles in the league's server only.
5. Get the server and role IDs:
   - In the Discord app: **User Settings → Advanced → Developer Mode** on.
   - Right-click the server icon → **Copy Server ID** → `DISCORD_GUILD_ID`.
   - If there is no moderator role yet: **Server Settings → Roles → Create Role**, name it `ARCS Mod`, give it to the moderators. It needs no permissions; the site only checks that members hold it.
   - **Server Settings → Roles**, right-click `ARCS Mod` → **Copy Role ID** → `DISCORD_MOD_ROLE_ID`.

Membership and the moderator role are checked when someone signs in. If you add or remove the role, that person needs to sign out and in again for it to take effect.

## 2. Neon database

Easiest route: create it from inside Vercel (step 3, option A), which sets `DATABASE_URL` for you. If you prefer to create it directly:

1. Go to <https://neon.tech> and sign up (the GitHub sign-in is fine). Choose the **Free** plan.
2. Create a project: name `arcs-league`, Postgres version as offered, region **AWS US East (N. Virginia)** (`us-east-1`), which is next to Vercel's default function region.
3. On the project dashboard, click **Connect**. Turn **Connection pooling** on, and copy the connection string. It looks like `postgresql://USER:PASSWORD@ep-something-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require`. That is `DATABASE_URL`.

You do not need to create any tables: every Vercel build runs the migrations (`npm run db:migrate`) before building, which creates the tables and seeds the 24 fates.

## 3. Vercel project

1. Go to <https://vercel.com/signup> and sign up with GitHub (the **Hobby** plan is free).
2. **Add New… → Project**, find `brandonferree/arcs-league` and click **Import**. If it is not listed, click **Adjust GitHub App Permissions** and give Vercel access to that repository.
3. Project name `arcs-league` (your address becomes `https://arcs-league.vercel.app` if the name is free; otherwise Vercel shows the address it chose). Framework preset: **Next.js** (detected). Leave the build and install commands as they are.
4. Open **Environment Variables** on the import screen and add (all environments are fine):
   - `APP_URL` = `https://arcs-league.vercel.app` (your real address, no trailing slash)
   - `SESSION_SECRET` = a random string of at least 32 characters. Generate one with:
     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
     ```
   - `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_GUILD_ID`, `DISCORD_MOD_ROLE_ID` from step 1
   - `DATABASE_URL` from step 2, **unless** you use option A below
5. Click **Deploy**.
   - **Option A (database from Vercel):** if you skipped step 2, the first deploy fails because there is no database. In the project, open **Storage → Create Database → Neon**, accept the defaults (free plan, region `iad1`/US East), and connect it to the project. It adds `DATABASE_URL` automatically. Then **Deployments → ⋯ → Redeploy**.
6. Go back to the Discord application (step 1.4) and make sure the redirect `https://YOUR-ADDRESS/api/auth/callback` matches your real address exactly.
7. Open the site and click **Sign in with Discord**. You should come back signed in. If you hold `ARCS Mod`, a **Mod** badge shows next to your name.

### Notes

- **Preview deployments** (from branches) also run migrations against the same database, and their sign-in redirects back to `APP_URL` (production). Both are fine for a site this size. If you later want isolated preview databases, the Vercel–Neon integration can create a database branch per preview.
- If sign-in says the account is not a member, check `DISCORD_GUILD_ID`. If it says sign-in failed, check the client secret and that the redirect URL matches exactly (`https`, no trailing slash).
- If there is no **Mod** badge: you must hold the `ARCS Mod` role yourself (owning or administering the server does not count), and `DISCORD_MOD_ROLE_ID` must be the role's numeric ID, not its name. Roles are read at sign-in, so sign out and in again; after changing a variable in Vercel, redeploy.
- When connecting Neon from Vercel's Storage tab, set the custom prefix to `DATABASE` so the variable is named `DATABASE_URL`.

## 4. Photo storage (phase 4)

Photos live in a **private** Vercel Blob store. The site serves them itself, checking who is asking, so members-only photos stay members-only.

1. In the Vercel project, open **Storage → Create Database → Blob** (it may be listed as **Blob** under "Vercel" storage).
2. Name it `arcs-league-photos`, choose **Private** access, pick the region nearest your Neon database (US East), and create it.
3. Connect it to the `arcs-league` project for all environments. Vercel adds `BLOB_READ_WRITE_TOKEN` (or, on newer setups, `BLOB_STORE_ID`) itself; either works. Leave the variable prefix as `BLOB`.
4. **Deployments → ⋯ → Redeploy** so the running site picks up the new variable.
5. Open a campaign with a recorded act, add a photo in the **Photos** panel, and check it shows.

Until the store is connected, adding a photo on the live site says "Photo storage is not set up yet"; everything else works.

Storage is the free tier's first limit (spec section 11). Each photo is roughly 0.3–1 MB after shrinking, so a full four-player campaign (15 photos) is roughly 5–15 MB. Watch **Storage → arcs-league-photos → Usage**.

## 5. Cards (phase 5)

No account needed, but photo storage (step 4) must be set up first. Once deployed, sign in as a moderator, open **Cards → Card import**, click **Check Buried Giant for changes**, then **Import these changes**, then **Copy card images** and keep the page open until it says all are copied (about a minute). Repeat whenever Buried Giant updates their cards; the site never checks on its own, and only new or changed cards' images are copied again.

The images take about 100 MB of Blob storage and about 920 Blob uploads the first time (Hobby allows 2,000 a month).

## 6. meeples imports

meeples pushes each finished act to `/api/import/act` (see `docs/ACT_SUMMARY_FORMAT.md`). Until this is set, the endpoint answers 503 and meeples falls back to its download button.

1. Generate a secret of at least 32 characters:

   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

2. In the Vercel project, add it as `MEEPLES_IMPORT_SECRET` (Production; Preview too if you test there), and redeploy. Check that `APP_URL` is the site's real address: the links sent back to meeples are built from it.
3. In meeples' Cloudflare Pages project, set the **same value** as `ARCS_LEAGUE_SECRET`, and `ARCS_LEAGUE_URL` to the site's address (no trailing slash):

   ```
   npx wrangler pages secret put ARCS_LEAGUE_SECRET --project-name=meeples
   npx wrangler pages secret put ARCS_LEAGUE_URL --project-name=meeples
   ```

4. Finish an act on meeples (or press "Send again"). The first act of a campaign appears at **/imports** for a player to say who is who; after that, acts save on their own.

To change the secret, set the new value in both places.

## 7. Discord bot (phase 3)

The bot uses the same Discord application as sign-in. It has no always-on process: Discord sends commands and button presses to the site, and the site posts with the bot's token.

1. In <https://discord.com/developers/applications>, open the `ARCS League` application.
2. **General Information**: copy **Public Key** → `DISCORD_PUBLIC_KEY`. (Leave *Interactions Endpoint URL* for step 6 below.)
3. **Bot** in the left menu:
   - Click **Reset Token**, confirm, and copy it → `DISCORD_BOT_TOKEN`. Discord shows it only once.
   - Turn **Public Bot** off, so only you can add it to servers.
   - Leave every *Privileged Gateway Intent* off; the bot does not need them.
4. In Discord, right-click the `#arcs` channel → **Copy Channel ID** → `DISCORD_ARCS_CHANNEL_ID` (Developer Mode must be on, as in step 1.5).
5. In Vercel, add `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN` and `DISCORD_ARCS_CHANNEL_ID` (Production), and **redeploy**. `DISCORD_CLIENT_ID` and `DISCORD_GUILD_ID` from step 1 are reused.
6. Sign in to the site as a moderator and open **Bot** in the menu (`/admin/discord`). It shows which variables are missing, the endpoint address, the invite link and a register button. Then:
   - Back on the application's **General Information** page, set **Interactions Endpoint URL** to `https://YOUR-ADDRESS/api/discord/interactions` and click **Save Changes**. Discord sends test requests when you save; if it says the address could not be verified, check `DISCORD_PUBLIC_KEY` and that you redeployed after adding it.
   - Click **Add the bot to your server** on the Bot page, choose the league's server and authorise. It asks for: View Channels, Send Messages, Embed Links, Read Message History, Create Public Threads and Send Messages in Threads. If `#arcs` is a private channel, also add the bot's role to it.
   - Click **Register slash commands**. The commands appear in the server straight away. (Or run `npm run discord:register` locally with the same variables in `.env.local`.)
7. In `#arcs`, run `/campaign status`. The bot should answer "No campaigns are in progress".

Commands work only in the league's server, in `#arcs` and its threads. To keep members from even seeing them elsewhere, use **Server Settings → Integrations → ARCS League** and limit the commands to `#arcs`.

If the bot stops answering, check **Vercel → Logs** for lines starting `discord bot:`. A result card that failed to post is not retried on its own; saving the act again (any edit) posts or updates it.

## Local development

No accounts needed. The app uses an embedded Postgres (PGlite) stored in `.pglite/` when `DATABASE_URL` is empty, and creates its tables on first start.

```bash
npm install
```

```bash
cp .env.example .env.local
```

Set `DEV_AUTH_STUB=1` in `.env.local`, then:

```bash
npm run dev
```

Photos are saved to `.photos-local/` (ignored by git) when `BLOB_READ_WRITE_TOKEN` is empty.

Open <http://localhost:3000/sign-in> and use **Development sign-in** to sign in as any name, optionally as a moderator. The stub works only on localhost, only with that flag, and never in a production build.

To test real Discord sign-in locally, also fill the four `DISCORD_*` sign-in variables in `.env.local` and keep `APP_URL=http://localhost:3000`.

Tests and checks:

```bash
npm test
```

```bash
npm run typecheck
```

To reset the local database, stop the dev server and delete the `.pglite` folder.
