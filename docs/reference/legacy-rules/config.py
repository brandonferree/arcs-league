"""Static configuration: fates, their tiers, players, and persistence settings.

Fate tiers decide which acts a fate is legal in:
    A fates -> any act        B fates -> Act II or III        C fates -> Act III only
"""
from __future__ import annotations

from pathlib import Path

A_FATES = ["Steward", "Founder", "Magnate", "Advocate",
           "Caretaker", "Partisan", "Admiral", "Believer"]
B_FATES = ["Pathfinder", "Hegemon", "Planet Breaker", "Pirate",
           "Blight Speaker", "Pacifist", "Peacekeeper", "Warden"]
C_FATES = ["Overlord", "Survivalist", "Redeemer", "Guardian",
           "Naturalist", "Gate Wraith", "Conspirator", "Judge"]

A_SET, B_SET, C_SET = set(A_FATES), set(B_FATES), set(C_FATES)

# Which fates may be selected in each act's dropdown.
ACT1_FATES = A_FATES
ACT2_FATES = A_FATES + B_FATES
ACT3_FATES = A_FATES + B_FATES + C_FATES


DATA_FILE = "campaigns.json"          # filename, also the path used in the GitHub API
# Absolute path to the local store, resolved relative to the repo so it works from any cwd.
LOCAL_DATA_PATH = str(Path(__file__).resolve().parents[1] / DATA_FILE)

# GitHub is used as durable storage only when the app runs hosted (Streamlit Cloud's
# filesystem is ephemeral). Locally we just read/write campaigns.json directly.
# The token lives in Streamlit secrets; owner/repo/branch can be overridden there too.
GITHUB_DEFAULTS = {
    "GITHUB_OWNER": "brandonferree",
    "GITHUB_REPO": "ARCS-Campaign",
    "GITHUB_BRANCH": "main",
}


def fate_tier(fate: str) -> str:
    """Return 'A', 'B', or 'C' for a fate name ('?' if unknown)."""
    if fate in A_SET:
        return "A"
    if fate in B_SET:
        return "B"
    if fate in C_SET:
        return "C"
    return "?"
