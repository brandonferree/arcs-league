"""Pure campaign rules — winner logic and validation. No I/O, no Streamlit, no SQL,
so this is trivially unit-testable.

A campaign is a dict:
    {"date": "2026-01-06", "vod": "...", "saved_at": "...", "players": [player, ...]}
A player is:
    {"name": "Chris",
     "act1": {"fate": "Advocate", "success": true, "score": 9},
     "act2": {"fate": "Advocate", "success": true, "score": 13},
     "act3": {"fate": "Planet Breaker", "score": 72}}   # act3 has no "success"
"""
from __future__ import annotations

from .config import A_SET, B_SET, C_SET


def campaign_winners(campaign: dict) -> list[str]:
    """Winner(s) = player(s) with the highest Act III score (ties share the win)."""
    players = campaign["players"]
    top = max(p["act3"]["score"] for p in players)
    return [p["name"] for p in players if p["act3"]["score"] == top]


def validate_campaign(players: list[dict]) -> list[str]:
    """Return a list of human-readable rule violations (empty list == valid)."""
    errors: list[str] = []

    # Player names must be unique within a game.
    names = [p["name"] for p in players]
    for nm in sorted({n for n in names if names.count(n) > 1}):
        errors.append(f"**{nm}** is listed more than once — each player must be unique.")

    # Per-player fate-sequence rules.
    for p in players:
        nm = p["name"]
        f1, s1 = p["act1"]["fate"], p["act1"]["success"]
        f2, s2 = p["act2"]["fate"], p["act2"]["success"]
        f3 = p["act3"]["fate"]

        # Tier act-legality.
        if f1 not in A_SET:
            errors.append(f"{nm}: Act I fate **{f1}** must be an A fate.")
        if f2 in C_SET:
            errors.append(f"{nm}: Act II fate **{f2}** is a C fate — C fates are Act III only.")

        # A fates can only appear after Act I as a continuation of the prior act.
        if f2 in A_SET and f2 != f1:
            errors.append(f"{nm}: Act II fate **{f2}** is an A fate — A fates can only appear "
                          "after Act I if continued from the prior act.")
        if f3 in A_SET and f3 != f2:
            errors.append(f"{nm}: Act III fate **{f3}** is an A fate — A fates can only appear "
                          "after Act I if continued from the prior act.")

        # Continuing a fate is only allowed after a success in the prior act.
        if f2 == f1 and not s1:
            errors.append(f"{nm}: kept **{f1}** into Act II but failed it in Act I — "
                          "a fate can only be continued after a success.")
        if f3 == f2 and not s2:
            errors.append(f"{nm}: kept **{f2}** into Act III but failed it in Act II — "
                          "a fate can only be continued after a success.")

        # Can't return to a fate once it has been dropped.
        if f2 != f1 and f3 == f1:
            errors.append(f"{nm}: returned to **{f1}** in Act III after leaving it — "
                          "a dropped fate can't be played again.")

    # A fate can belong to only one player across the whole game.
    owners: dict[str, set[str]] = {}
    for p in players:
        for fate in {p["act1"]["fate"], p["act2"]["fate"], p["act3"]["fate"]}:
            owners.setdefault(fate, set()).add(p["name"])
    for fate, who in sorted(owners.items()):
        if len(who) > 1:
            errors.append(f"Fate **{fate}** is shared by {', '.join(sorted(who))} — "
                          "a fate can belong to only one player per game.")

    return errors
