# ARCS League

League site for ARCS: The Blighted Reach campaign games. Read `docs/DESIGN.md` before doing anything: it is the agreed spec, including the build order and the list of open items.

- Stack: Next.js (App Router, TypeScript) on Vercel, Postgres on Neon, Vercel Blob, Discord OAuth, Discord bot as an HTTP interactions endpoint. Free tiers only; no always-on process.
- The fate-legality validator in `docs/reference/legacy-rules/` must be ported to TypeScript with all its tests before the campaign form is built.
- Theme is "Neon Reach" (`docs/DESIGN.md` section 8). Do not restyle it.
- Never commit secrets or Discord server, channel or role IDs; they are environment variables. Keep `.env.example` current.
- Card data and images come from Buried Giant Studios with permission: copy, credit, never hotlink, never auto-sync.
- The owner wants every change committed and pushed without being asked.
