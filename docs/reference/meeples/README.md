# meeples act summary samples

Act summaries produced by the meeples export (`brandonferree/meeples`, commit `95aa68a`), for the league importer's tests. Format: `docs/ACT_SUMMARY_FORMAT.md`.

- `arcs-act1.json`, `arcs-act2.json`: a real meeples campaign, replayed locally and captured as the worker sent them. Scores, fate results and favors were checked against the game's log in meeples.
- `arcs-act3-synthetic.json`: **not a real result.** No meeples campaign had finished Act III, so meeples ran its Act III export on the start-of-Act-III state with a stand-in winner. Use it for the Act III shape only.

Anonymised for this public repo (owner, 2026-11-14): player names are `Player 1`–`Player 4` (by Act I seat), the game id is `samplegame0001`, the URL points at `meeples.example`, and the game's title in `notes` is "Sample campaign". Everything else is as exported, including a negative Act II score (−5) and the extra fields `powerBeforePenalty` and `objectiveShortfall`, which the importer ignores.

**Scores halved by hand (2026-11-14).** These were exported before `score` was redefined as power after the halving between acts. In Acts I and II, `score` has been halved the way the game does it (above 1 becomes half, rounded up) and the exported value kept as `scoreBeforeHalving`, so the files match what meeples sends from now on.
