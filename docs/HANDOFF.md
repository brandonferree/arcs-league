# Handoff: build phase 1

Read `docs/DESIGN.md` and `CLAUDE.md` in full first. Nothing is built: there is no package.json, no database, no Discord application and no Vercel project. Build **phase 1** from section 10 of the spec.

Work in this order, committing and pushing to `main` as each piece lands:

1. Scaffold Next.js (App Router, TypeScript) in the repo root with a test runner and a `.env.example`.
2. Port the fate-legality validator and winner logic from `docs/reference/legacy-rules/domain.py` and `config.py` to TypeScript, and port every test in `test_domain.py`. Add tests for the new rules in section 3 of the spec (3–4 players only, explicit winner override). All tests must pass.
3. Design the Postgres schema for sections 3–5 of the spec: players (Discord accounts and guests), campaigns, acts, per-player act results, fates, seasons, audit log. Leave room for photos, cards and card tags from later phases without building them. Use migrations. Seed the 24 fates with tier and act.
4. Implement the theme from section 8 as design tokens and shared layout (nav, panels, tables, tier badges, filled fate-progression chips), including the two agreed changes from the mockup, reduced-motion handling, and phone-width behaviour.
5. Build Home, Campaigns list, Campaign detail (three-act progression per player with the progression colour key) and the act-by-act form with live validation, the 24-hour edit window, moderator edit, and audit logging.
6. Implement Discord OAuth sign-in with server-membership and moderator-role checks driven by environment variables.

## Credentials

None exist yet. Build and verify everything possible without them:

- run the tests
- run the app locally against a local or throwaway Postgres
- add a development-only sign-in stub that works solely on localhost behind an environment flag, so the form and pages can be exercised
- check the pages in a browser

When real credentials become necessary (Discord application, Neon database, Vercel project), stop and give the owner exact step-by-step instructions for creating each one and which value goes in which environment variable. Do not create accounts yourself. The Discord server and `#arcs` channel IDs come from the owner; never commit them.

## Done means

- tests pass and the app runs locally
- a campaign can be created and all three acts logged, with rule violations blocked in the form
- list and detail pages render in the Neon Reach theme
- everything is pushed to `main`
- the owner has the credential setup instructions
- a report of what was verified and what was not

Do not start phases 2–6. Ask the owner about the `ARCSdiscord` open item in section 11 of the spec before designing any write API.
