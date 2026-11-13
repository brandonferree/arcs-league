"""Tests for the pure domain rules."""
from arcs.domain import campaign_winners, validate_campaign


def _player(name, f1, f2, f3, s1=True, s2=True, sc=(5, 10, 70)):
    return {
        "name": name,
        "act1": {"fate": f1, "success": s1, "score": sc[0]},
        "act2": {"fate": f2, "success": s2, "score": sc[1]},
        "act3": {"fate": f3, "score": sc[2]},
    }


def test_valid_campaign_has_no_errors():
    players = [
        _player("Brandon", "Steward", "Steward", "Steward"),     # A continued
        _player("Mark", "Founder", "Pathfinder", "Overlord"),    # A -> B -> C
    ]
    assert validate_campaign(players) == []


def test_act1_must_be_a_fate():
    players = [_player("Brandon", "Pathfinder", "Pathfinder", "Overlord")]
    errs = validate_campaign(players)
    assert any("Act I fate" in e for e in errs)


def test_cannot_continue_after_failure():
    players = [_player("Brandon", "Steward", "Steward", "Magnate", s1=False)]
    errs = validate_campaign(players)
    assert any("can only be continued after a success" in e for e in errs)


def test_fate_cannot_be_shared():
    players = [
        _player("Brandon", "Steward", "Steward", "Steward"),
        _player("Mark", "Steward", "Founder", "Overlord"),
    ]
    errs = validate_campaign(players)
    assert any("can belong to only one player" in e for e in errs)


def test_winner_is_highest_act3():
    c = {"players": [
        _player("Brandon", "Steward", "Steward", "Steward", sc=(5, 10, 60)),
        _player("Mark", "Founder", "Pathfinder", "Overlord", sc=(5, 10, 80)),
    ]}
    assert campaign_winners(c) == ["Mark"]


def test_ties_share_the_win():
    c = {"players": [
        _player("Brandon", "Steward", "Steward", "Steward", sc=(5, 10, 70)),
        _player("Mark", "Founder", "Pathfinder", "Overlord", sc=(5, 10, 70)),
    ]}
    assert set(campaign_winners(c)) == {"Brandon", "Mark"}
