# Handoff: send halved scores for Acts I and II

For the meeples repo. Tell Claude Code there: "Read this and do it", with this file's text or its link:
`https://raw.githubusercontent.com/brandonferree/arcs-league/main/docs/handoff/MEEPLES_HALVED_SCORE.md`

---

The owner changed what an act's score means (2026-11-14). For Acts I and II, ARCS League now stores the power a player **starts the next act with**: power after the failed-objective penalty **and after** the intermission halving. Act III is unchanged (final power).

The game's halving (`IntermissionInitiativePowerAction` in `haunt-roll-fail/arcs/game-blight.scala`): if power is above 1 it becomes `power /↑ 2` (half, rounded up); 1, 0 and negative power stay as they are. Example from a live game: 36→18, 29→15, 4→2, −5→−5.

## Change

1. In `cf-pages/arcs-br/meeples-arcs-export.js`, in the `act-end` branch (Acts I and II), the hook runs before fates resolve and before the halving, so compute both steps:

   ```js
   const afterPenalty = power - Math.max(progress, 0);
   p.score = afterPenalty > 1 ? Math.ceil(afterPenalty / 2) : afterPenalty;
   p.scoreBeforeHalving = afterPenalty;
   ```

   Keep `powerBeforePenalty` and `objectiveShortfall` as they are. Do not change the Act III branch.
2. Re-download the format spec into `docs/ACT_SUMMARY_FORMAT.md` from
   `https://raw.githubusercontent.com/brandonferree/arcs-league/main/docs/ACT_SUMMARY_FORMAT.md`
   (the `score` row now says this, and it lists the 413 and 503 responses).
3. Update the `score` row in `docs/ARCS_LEAGUE_EXPORT.md`, and halve the Act I and II scores in `docs/samples/` the same way (keeping the old value as `scoreBeforeHalving`).
4. Check it against a replayed game: each player's `score` in an Act I or II export must equal their power on the board at the start of the next act.
5. Commit, push, and redeploy: `npx wrangler pages deploy cf-pages --project-name=meeples --branch=main`.

## Acts already sent

The league never overwrites a saved act from an import, so "Send again" for an act already saved with unhalved scores comes back as a conflict. A league moderator corrects those acts by hand on the site instead; no meeples work is needed for them.
