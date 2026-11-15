# ARCS League: Blighted Reach Chronicle

An unofficial fan site for logging and analysing campaign games of ARCS: The Blighted Reach. Campaigns are opened from Discord, recorded act by act on the web, and turned into leaderboards, fate and card statistics, and records.

**Status:** phases 1–5 built: campaign logging with the fate-legality validator, stats pages, the Discord bot, photos and cards; plus meeples imports. Phase 6 (public API) is next. Reports are in [`docs/`](docs/).

- Spec: [`docs/DESIGN.md`](docs/DESIGN.md)
- Accounts, credentials and local development: [`docs/SETUP.md`](docs/SETUP.md)

Quick start (no accounts needed; uses an embedded Postgres):

```bash
npm install
```

```bash
npm run dev
```

Set `DEV_AUTH_STUB=1` in `.env.local` to sign in locally without Discord. Run the tests with `npm test`.

ARCS is published by Leder Games. Card data and images are from Buried Giant Studios' card database, used with permission. This project is not affiliated with either.
