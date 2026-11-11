"""Rule Wind Tunnel v0.1 tests (genlayer-test direct mode: in-memory, mocked model).

Run from the repository root:  python3 -m pytest tests/direct
The expected numbers come from a second, independent implementation of the metrics written with itertools.
"""

import hashlib
import itertools
import json
import math
import random
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import pytest

CONTRACT = "contracts/rule_wind_tunnel.py"
FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
T0 = "2026-10-23T10:00:00Z"
NAMES = {"C": "COMPLIES", "V": "VIOLATES", "U": "UNCLEAR"}


def ts(iso):
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(timezone.utc).timestamp())


def set_time(vm, stamp):
    vm.warp(stamp)
    module = sys.modules.get("genlayer.gl")
    if module is not None:
        module.message_raw["datetime"] = stamp


def at(vm, minutes):
    set_time(vm, datetime.fromtimestamp(ts(T0) + minutes * 60, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))


def deploy(vm, deploy_fn, owner):
    vm.sender = owner
    set_time(vm, T0)
    c = deploy_fn(CONTRACT)
    set_time(vm, T0)
    return c


# -- packs and mocks ---------------------------------------------------------------------------------------------

LETTERS = "ABCDE"


def make_pack(k=4, n=8, intents=None, label="Parcel rule", previous=None, tag=""):
    intents = intents or ["OPEN"] * n
    pack = {
        "label": label,
        "wordings": ["Judge every case by this rule, version WORDING_%s%s." % (LETTERS[i], tag) for i in range(k)],
        "cases": [{"text": "Case number %d%s: a parcel arrives and something specific happens." % (j + 1, tag), "intent": intents[j]}
                  for j in range(n)],
    }
    if previous is not None:
        pack["previous"] = previous
    return pack


def reply(row):
    return json.dumps({"verdicts": [NAMES[c] for c in row]})


def serve(vm, rows, tag="", replies=None):
    """The model answers wording i with rows[i] (a string of C/V/U), unless `replies` overrides it."""
    vm.clear_mocks()
    for i, row in enumerate(rows):
        vm.mock_llm("WORDING_%s%s\\." % (LETTERS[i], tag), replies[i] if replies and replies[i] is not None else reply(row))


def measure(c, pack):
    return c.measure(json.dumps(pack))


def report(c, pid):
    return json.loads(c.get_report_json(pid))


def pid_of(c, pack):
    return c.get_pack_id(json.dumps(pack))


# -- an independent implementation of the metrics --------------------------------------------------------------------

def ref_metrics(pack, rows):
    k, n = len(rows), len(rows[0])
    pairs = 0
    refs, hits, counted, boundary, classes = [], 0, 0, [], []
    for j in range(n):
        col = [r[j] for r in rows]
        pairs += sum(1 for a, b in itertools.combinations(col, 2) if a == b)
        top = Counter(col).most_common()
        majority = next((letter for letter, count in top if count * 2 > k), "")
        want = {"COMPLIES": "C", "VIOLATES": "V", "OPEN": ""}[pack["cases"][j]["intent"]]
        off = False
        if want:
            counted += 1
            hits += majority == want
            off = majority != want
        refs.append(want or majority)
        klass = "UNANIMOUS" if top[0][1] == k else ("MAJORITY" if majority else "SPLIT")
        classes.append(klass)
        if klass != "UNANIMOUS" or off:
            boundary.append(j)
    cons = 1000 * pairs // (n * math.comb(k, 2))
    fid = 1000 * hits // counted if counted else None
    score = cons if fid is None else min(cons, fid)
    grade = "STEADY" if score >= 900 else "USABLE" if score >= 750 else "SHAKY" if score >= 550 else "UNSTABLE"
    refcount = sum(1 for r in refs if r)
    align = [1000 * sum(1 for j in range(n) if refs[j] and row[j] == refs[j]) // refcount if refcount else 0 for row in rows]
    best = min(range(k), key=lambda i: (-align[i], i))
    return {"cons": cons, "fid": fid, "score": score, "grade": grade, "align": align, "best": best,
            "tied": align.count(align[best]) > 1, "boundary": boundary, "classes": classes}


def check_against_reference(c, pack, rows):
    pid = pid_of(c, pack)
    r = report(c, pid)["report"]
    ref = ref_metrics(pack, rows)
    assert r["consistency_permille"] == ref["cons"]
    assert r["fidelity_permille"] == ref["fid"]
    assert r["score_permille"] == ref["score"] and r["grade"] == ref["grade"]
    assert r["alignment_permille"] == ref["align"]
    assert r["best_wording"] == ref["best"] and r["best_tied"] == ref["tied"]
    assert r["boundary"] == ref["boundary"]
    assert [x["class"] for x in r["per_case"]] == ref["classes"]
    assert c.get_grade(pid) == ref["grade"]


# -- deployment and empty views ----------------------------------------------------------------------------------------

def test_deploy_is_empty(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    assert c.get_pack_count() == 0
    assert json.loads(c.get_packs_page(0, 10)) == {"items": [], "total": 0}
    assert c.get_report_json("a" * 64) == "NONE" and c.get_grade("a" * 64) == "NONE"
    assert json.loads(c.get_lineage_json("a" * 64)) == []
    assert c.compare_json("a" * 64, "b" * 64) == "NONE"


# -- measuring ----------------------------------------------------------------------------------------------------------

def test_a_perfectly_steady_pack(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    intents = ["COMPLIES", "COMPLIES", "VIOLATES", "VIOLATES", "COMPLIES", "VIOLATES", "OPEN", "OPEN"]
    row = "CCVVCVUC"
    pack = make_pack(intents=intents)
    serve(direct_vm, [row] * 4)
    out = json.loads(measure(c, pack))
    assert out == {"grade": "STEADY", "id": pid_of(c, pack), "score_permille": 1000}
    r = report(c, out["id"])
    assert r["report"]["consistency_permille"] == 1000 and r["report"]["fidelity_permille"] == 1000
    assert r["report"]["boundary"] == [] and r["drift_cells"] is None and len(r["runs"]) == 1
    assert r["runs"][0]["rows"] == [row] * 4 and r["runs"][0]["at"] == ts(T0)
    assert r["runs"][0]["by"] == str(direct_owner).lower() or r["runs"][0]["by"].startswith("0x")
    assert c.get_pack_count() == 1 and c.get_grade(out["id"]) == "STEADY"
    check_against_reference(c, pack, [row] * 4)


def test_a_split_pack_is_graded_and_its_boundary_listed(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    intents = ["COMPLIES", "COMPLIES", "VIOLATES", "VIOLATES", "COMPLIES", "VIOLATES", "OPEN", "OPEN"]
    rows = ["CCVVCVUC", "CCVVVVUC", "CVVVCVUV", "CCVCVVCC"]
    pack = make_pack(intents=intents)
    serve(direct_vm, rows)
    measure(c, pack)
    check_against_reference(c, pack, rows)
    r = report(c, pid_of(c, pack))["report"]
    assert 0 < len(r["boundary"]) < 8
    assert r["per_case"][0]["counts"] == {"C": 4, "V": 0, "U": 0} and r["per_case"][0]["class"] == "UNANIMOUS"


@pytest.mark.parametrize("seed", range(40))
def test_random_tables_match_the_reference(direct_vm, direct_deploy, direct_owner, seed):
    rnd = random.Random(seed)
    k, n = rnd.randint(3, 5), rnd.randint(6, 12)
    intents = [rnd.choice(["COMPLIES", "VIOLATES", "OPEN", "OPEN"]) for _ in range(n)]
    if seed % 5 == 0:
        intents = ["OPEN"] * n
    base = "".join(rnd.choice("CCCVVU") for _ in range(n))
    rows = ["".join(ch if rnd.random() < 0.7 else rnd.choice("CVU") for ch in base) for _ in range(k)]
    c = deploy(direct_vm, direct_deploy, direct_owner)
    pack = make_pack(k=k, n=n, intents=intents)
    serve(direct_vm, rows)
    measure(c, pack)
    check_against_reference(c, pack, rows)


@pytest.mark.parametrize("rows,expected", [
    (["CCCCCCCC"] * 4, "STEADY"),
    (["CCCCCCCC", "CCCCCCCC", "CCCCCCCC", "CCCCCCCV"], "STEADY"),
    (["CCCCCCCC", "CCCCCCCC", "CCCCCCVV", "CCCCCCVV"], "USABLE"),
    (["CCCCCCCC", "CCCCVVVV", "CCVVVVUU", "VVVVUUCC"], "UNSTABLE"),
])
def test_grades(direct_vm, direct_deploy, direct_owner, rows, expected):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    pack = make_pack()
    serve(direct_vm, rows)
    assert json.loads(measure(c, pack))["grade"] == expected == ref_metrics(pack, rows)["grade"]


def test_stable_but_wrong_scores_low_on_fidelity(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    pack = make_pack(intents=["VIOLATES"] * 8)
    rows = ["CCCCCCCC"] * 4
    serve(direct_vm, rows)
    out = json.loads(measure(c, pack))
    r = report(c, out["id"])["report"]
    assert r["consistency_permille"] == 1000 and r["fidelity_permille"] == 0 and out["grade"] == "UNSTABLE"
    assert r["boundary"] == list(range(8)) and all(x["off_intent"] for x in r["per_case"])


def test_without_intents_fidelity_is_none_and_the_score_is_consistency(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    pack = make_pack()
    rows = ["CCVVCCVV", "CCVVCCVV", "CCVVCCVV", "CCVVCCCC"]
    serve(direct_vm, rows)
    out = json.loads(measure(c, pack))
    r = report(c, out["id"])["report"]
    assert r["fidelity_permille"] is None and r["score_permille"] == r["consistency_permille"]


def test_best_wording_prefers_the_first_on_a_tie(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    pack = make_pack(intents=["COMPLIES"] * 4 + ["VIOLATES"] * 4)
    rows = ["CCCCVVVV", "CCCCVVVV", "CCCVVVVV", "VCCCVVVV"]
    serve(direct_vm, rows)
    measure(c, pack)
    r = report(c, pid_of(c, pack))["report"]
    assert r["best_wording"] == 0 and r["best_tied"] is True
    assert r["alignment_permille"] == [1000, 1000, 875, 875]


def test_best_wording_can_be_a_later_one(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    pack = make_pack(intents=["COMPLIES"] * 4 + ["VIOLATES"] * 4)
    rows = ["CVCCVVVV", "CCVCVVVV", "VVCCVVVV", "CCCCVVVV"]
    serve(direct_vm, rows)
    measure(c, pack)
    r = report(c, pid_of(c, pack))["report"]
    assert r["best_wording"] == 3 and r["best_tied"] is False


def test_open_cases_use_the_majority_as_their_reference(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    pack = make_pack()
    rows = ["CCCCCCCC", "CCCCCCCC", "CCCCCCCC", "VVVVVVVV"]
    serve(direct_vm, rows)
    measure(c, pack)
    r = report(c, pid_of(c, pack))["report"]
    assert r["alignment_permille"] == [1000, 1000, 1000, 0] and r["best_wording"] == 0


def test_an_even_split_has_no_majority(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    pack = make_pack(intents=["COMPLIES"] + ["OPEN"] * 7)
    rows = ["CCCCCCCC", "CCCCCCCC", "VCCCCCCC", "VCCCCCCC"]
    serve(direct_vm, rows)
    measure(c, pack)
    first = report(c, pid_of(c, pack))["report"]["per_case"][0]
    assert first["class"] == "SPLIT" and first["majority"] == "" and first["off_intent"] is True


def test_the_id_ignores_spacing_and_key_order(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    pack = make_pack()
    messy = json.loads(json.dumps(pack))
    messy["label"] = "  Parcel   rule\n"
    messy["wordings"] = ["  " + w.replace(" ", "   ") + "\t" for w in messy["wordings"]]
    shuffled = {"cases": messy["cases"], "wordings": messy["wordings"], "label": messy["label"], "previous": ""}
    assert pid_of(c, pack) == c.get_pack_id(json.dumps(shuffled))
    expected = hashlib.sha256(json.dumps({**pack, "previous": ""}, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    assert pid_of(c, pack) == expected


def test_any_change_changes_the_id(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    base = make_pack()
    ids = {pid_of(c, base)}
    for mutate in (lambda p: p["cases"][0].update(intent="COMPLIES"), lambda p: p["cases"][1].update(text="Another case that differs here."),
                   lambda p: p["wordings"].__setitem__(0, "A completely different wording of the rule."),
                   lambda p: p.update(label="Other label"), lambda p: p["cases"].reverse(), lambda p: p["wordings"].reverse(),
                   lambda p: p.update(previous="b" * 64)):
        other = json.loads(json.dumps(base))
        mutate(other)
        ids.add(pid_of(c, other))
    assert len(ids) == 8


# -- bad packs -------------------------------------------------------------------------------------------------------------

def bad(pack_mutation):
    pack = make_pack()
    pack_mutation(pack)
    return json.dumps(pack)


BAD_PACKS = [
    ("not json", "invalid pack"), ("[]", "invalid pack"), ("null", "invalid pack"), ("{}", "invalid pack"),
    (bad(lambda p: p.pop("label")), "invalid pack"), (bad(lambda p: p.pop("cases")), "invalid pack"),
    (bad(lambda p: p.pop("wordings")), "invalid pack"), (bad(lambda p: p.update(extra=1)), "invalid pack"),
    (bad(lambda p: p.update(label="ab")), "invalid label"), (bad(lambda p: p.update(label="x" * 61)), "invalid label"),
    (bad(lambda p: p.update(label=5)), "invalid label"), (bad(lambda p: p.update(label="bad\x01label")), "invalid label"),
    (bad(lambda p: p.update(previous="xyz")), "invalid previous"), (bad(lambda p: p.update(previous="A" * 64)), "invalid previous"),
    (bad(lambda p: p.update(previous=5)), "invalid previous"),
    (bad(lambda p: p.update(wordings=p["wordings"][:2])), "need 3 to 5 wordings"),
    (bad(lambda p: p.update(wordings=p["wordings"] + ["Extra wording number five here.", "Extra wording number six here."])), "need 3 to 5 wordings"),
    (bad(lambda p: p.update(wordings="text")), "need 3 to 5 wordings"),
    (bad(lambda p: p.update(cases=p["cases"][:5])), "need 6 to 12 cases"),
    (bad(lambda p: p.update(cases=p["cases"] * 2)), "need 6 to 12 cases"),
    (bad(lambda p: p.update(cases={})), "need 6 to 12 cases"),
    (bad(lambda p: p["wordings"].__setitem__(0, "too short")), "invalid wording"),
    (bad(lambda p: p["wordings"].__setitem__(0, "w" * 601)), "invalid wording"),
    (bad(lambda p: p["wordings"].__setitem__(0, 7)), "invalid wording"),
    (bad(lambda p: p["wordings"].__setitem__(0, p["wordings"][0] + "\x00")), "invalid wording"),
    (bad(lambda p: p["wordings"].__setitem__(1, p["wordings"][0].upper())), "wordings must differ"),
    (bad(lambda p: p["cases"][0].update(text="short")), "invalid case"),
    (bad(lambda p: p["cases"][0].update(text="c" * 401)), "invalid case"),
    (bad(lambda p: p["cases"][0].update(intent="MAYBE")), "invalid case"),
    (bad(lambda p: p["cases"][0].update(intent="complies")), "invalid case"),
    (bad(lambda p: p["cases"][0].pop("intent")), "invalid case"),
    (bad(lambda p: p["cases"][0].update(extra=1)), "invalid case"),
    (bad(lambda p: p["cases"].__setitem__(0, "plain string")), "invalid case"),
    (bad(lambda p: p["cases"][1].update(text=p["cases"][0]["text"].lower())), "cases must differ"),
    (json.dumps(make_pack()) + " " * 12000, "invalid pack"),
]


@pytest.mark.parametrize("text,message", BAD_PACKS)
def test_bad_packs_are_rejected(direct_vm, direct_deploy, direct_owner, text, message):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    serve(direct_vm, ["CCCCCCCC"] * 4)
    with direct_vm.expect_revert(message):
        c.measure(text)
    with direct_vm.expect_revert(message):
        c.get_pack_id(text)
    assert c.get_pack_count() == 0


def test_non_string_packs_are_rejected(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    with direct_vm.expect_revert("invalid pack"):
        c.get_pack_id(5)


def test_limits_are_inclusive(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    pack = make_pack(k=5, n=12, label="x" * 60)
    pack["wordings"][0] = "w" * 600
    pack["cases"][0]["text"] = "c" * 400
    pack["cases"][1]["text"] = "c" * 9 + "d"
    pack["wordings"][1] = "Judge every case by this rule, version WORDING_B."
    serve(direct_vm, ["CCCCCCCCCCCC"] * 5, replies=[reply("CCCCCCCCCCCC")] * 5)
    direct_vm.clear_mocks()
    direct_vm.mock_llm("BEGIN RULE", reply("CCCCCCCCCCCC"))
    assert json.loads(measure(c, pack))["grade"] == "STEADY"
    small = make_pack(k=3, n=6, label="abc")
    small["wordings"][0] = "w" * 20
    small["cases"][0]["text"] = "c" * 10
    direct_vm.clear_mocks()
    direct_vm.mock_llm("BEGIN RULE", reply("CCCCCC"))
    assert json.loads(measure(c, small))["grade"] == "STEADY"
    assert c.get_pack_count() == 2


# -- the model's answer -------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("bad_reply", [
    "I think the rule is fine.", "not json at all", json.dumps({"verdicts": ["COMPLIES"] * 7}),
    json.dumps({"verdicts": ["COMPLIES"] * 9}), json.dumps({"verdicts": ["COMPLIES"] * 7 + ["MAYBE"]}),
    json.dumps({"verdicts": ["complies"] * 8}), json.dumps({"verdicts": [1] * 8}), json.dumps({"verdicts": "COMPLIES"}),
    json.dumps({"verdict": ["COMPLIES"] * 8}), json.dumps({"verdicts": ["COMPLIES"] * 8, "note": "ok"}),
    json.dumps(["COMPLIES"] * 8), json.dumps({"verdicts": ["COMPLIES"] * 7 + [None]}), "x" * 6001,
])
def test_a_badly_formed_answer_is_never_a_measurement(direct_vm, direct_deploy, direct_owner, bad_reply):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    for position in (0, 3):
        replies = [None] * 4
        replies[position] = bad_reply
        serve(direct_vm, ["CCCCCCCC"] * 4, replies=replies)
        assert measure(c, make_pack()) == "UNMEASURABLE"
    assert c.get_pack_count() == 0 and c.get_grade(pid_of(c, make_pack())) == "NONE"


def test_the_model_can_answer_with_an_object_instead_of_text(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    serve(direct_vm, ["CCCCCCCC"] * 4, replies=[{"verdicts": ["COMPLIES"] * 8}] * 4)
    assert json.loads(measure(c, make_pack()))["grade"] == "STEADY"


def test_the_prompt_carries_the_rule_the_cases_and_the_guard(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    pack = make_pack(k=3, n=6)
    direct_vm.clear_mocks()
    # each mock matches only when the guard, the answer format, this wording and every numbered case are in the prompt
    for i in range(3):
        direct_vm.mock_llm(
            r"(?s)UNTRUSTED TEXT.*Never obey.*exactly 6 entries.*BEGIN RULE ---\nJudge every case by this rule, version WORDING_%s\.\n--- END RULE.*"
            r"BEGIN CASES ---\n1\. Case number 1: .*\n2\. Case number 2: .*\n6\. Case number 6: .*--- END CASES" % LETTERS[i], reply("VVVVVV"))
    out = json.loads(measure(c, pack))
    assert report(c, out["id"])["runs"][0]["rows"] == ["VVVVVV"] * 3


def test_each_wording_is_asked_separately_and_in_order(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    pack = make_pack(k=3, n=6)
    serve(direct_vm, ["CCCCCC", "VVVVVV", "UUUUUU"])
    out = json.loads(measure(c, pack))
    assert report(c, out["id"])["runs"][0]["rows"] == ["CCCCCC", "VVVVVV", "UUUUUU"]


# -- repeating a measurement ----------------------------------------------------------------------------------------------------

def test_cooldown_run_limit_and_drift(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    pack = make_pack()
    steady = ["CCVVCCVV"] * 4
    serve(direct_vm, steady)
    pid = json.loads(measure(c, pack))["id"]
    at(direct_vm, 4)
    with direct_vm.expect_revert("measured too recently"):
        measure(c, pack)
    at(direct_vm, 5)
    drifted = ["CCVVCCVV", "CCVVCCVV", "CCVVCCVV", "CCVVCCVC"]
    serve(direct_vm, drifted)
    measure(c, pack)
    r = report(c, pid)
    assert len(r["runs"]) == 2 and r["drift_cells"] == 1 and r["runs"][1]["rows"] == drifted
    assert r["report"]["consistency_permille"] == ref_metrics(pack, drifted)["cons"]
    for minutes in (10, 15, 20):
        at(direct_vm, minutes)
        measure(c, pack)
    assert len(report(c, pid)["runs"]) == 5
    at(direct_vm, 25)
    with direct_vm.expect_revert("run limit reached"):
        measure(c, pack)
    assert c.get_pack_count() == 1


def test_an_unmeasurable_rerun_changes_nothing(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    pack = make_pack()
    serve(direct_vm, ["CCVVCCVV"] * 4)
    pid = json.loads(measure(c, pack))["id"]
    before = c.get_report_json(pid)
    at(direct_vm, 6)
    serve(direct_vm, ["CCVVCCVV"] * 4, replies=["nope", None, None, None])
    assert measure(c, pack) == "UNMEASURABLE"
    assert c.get_report_json(pid) == before


def test_the_cooldown_counts_from_the_last_run(direct_vm, direct_deploy, direct_owner, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    pack = make_pack()
    serve(direct_vm, ["CCVVCCVV"] * 4)
    measure(c, pack)
    at(direct_vm, 5)
    direct_vm.sender = direct_alice
    measure(c, pack)                       # anyone may re-run a public pack
    runs = report(c, pid_of(c, pack))["runs"]
    assert runs[0]["by"] != runs[1]["by"]
    at(direct_vm, 9)
    with direct_vm.expect_revert("measured too recently"):
        measure(c, pack)


# -- lineage -------------------------------------------------------------------------------------------------------------------------

def test_a_revision_names_the_pack_it_replaces(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    v1 = make_pack(label="Rule v1", tag="x")
    serve(direct_vm, ["CCVVCCVV", "CVVVCCVV", "CCVCCCVV", "CCVVVCVV"], tag="x")
    id1 = json.loads(measure(c, v1))["id"]
    v2 = make_pack(label="Rule v2", previous=id1, tag="y")
    serve(direct_vm, ["CCVVCCVV"] * 4, tag="y")
    id2 = json.loads(measure(c, v2))["id"]
    chain = json.loads(c.get_lineage_json(id2))
    assert [x["id"] for x in chain] == [id2, id1] and [x["label"] for x in chain] == ["Rule v2", "Rule v1"]
    assert chain[0]["grade"] == "STEADY" and chain[1]["score_permille"] < chain[0]["score_permille"]
    assert set(chain[0]) == {"id", "label", "grade", "score_permille", "consistency_permille", "fidelity_permille", "runs", "at"}
    assert [x["id"] for x in json.loads(c.get_lineage_json(id1))] == [id1]
    cmp = json.loads(c.compare_json(id1, id2))
    assert cmp["delta"]["score_permille"] == chain[0]["score_permille"] - chain[1]["score_permille"] > 0
    assert cmp["first"]["label"] == "Rule v1" and cmp["second"]["grade"] == "STEADY" and cmp["delta"]["fidelity_permille"] is None
    assert cmp["delta"]["boundary_cases"] == cmp["second"]["boundary_cases"] - cmp["first"]["boundary_cases"] < 0


def test_an_unknown_previous_is_refused(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    serve(direct_vm, ["CCVVCCVV"] * 4)
    with direct_vm.expect_revert("unknown previous"):
        measure(c, make_pack(previous="c" * 64))
    assert c.get_pack_count() == 0


def test_a_previous_that_was_never_measured_is_refused_even_if_the_id_is_valid(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    serve(direct_vm, ["CCVVCCVV"] * 4)
    ghost = pid_of(c, make_pack(label="Never measured"))
    with direct_vm.expect_revert("unknown previous"):
        measure(c, make_pack(previous=ghost))


def test_lineage_is_capped_at_twelve(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    direct_vm.clear_mocks()
    direct_vm.mock_llm("BEGIN RULE", reply("CCVVCCVV"))
    previous = None
    last = None
    for i in range(14):
        pack = make_pack(label="Version %d" % i, previous=previous)
        last = json.loads(measure(c, pack))["id"]
        previous = last
    chain = json.loads(c.get_lineage_json(last))
    assert len(chain) == 12 and chain[0]["label"] == "Version 13" and chain[-1]["label"] == "Version 2"


def test_lineage_of_junk_is_empty(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    for junk in ("", "nope", "a" * 64, 5, None):
        assert json.loads(c.get_lineage_json(junk)) == []


def test_compare_with_intents_has_a_fidelity_delta(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    a, b = make_pack(label="A pack", intents=["COMPLIES"] * 8), make_pack(label="B pack", intents=["COMPLIES"] * 8, tag="b")
    serve(direct_vm, ["CCCCVVVV"] * 4)
    ida = json.loads(measure(c, a))["id"]
    serve(direct_vm, ["CCCCCCCC"] * 4, tag="b")
    idb = json.loads(measure(c, b))["id"]
    cmp = json.loads(c.compare_json(ida, idb))
    assert cmp["first"]["fidelity_permille"] == 500 and cmp["second"]["fidelity_permille"] == 1000
    assert cmp["delta"]["fidelity_permille"] == 500
    assert c.compare_json(ida, "z") == "NONE" and c.compare_json(5, idb) == "NONE"


# -- listing -----------------------------------------------------------------------------------------------------------------------------

def test_the_board_lists_packs_in_order(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    direct_vm.clear_mocks()
    direct_vm.mock_llm("BEGIN RULE", reply("CCVVCCVV"))
    for i in range(5):
        measure(c, make_pack(label="Pack %d" % i))
    page = json.loads(c.get_packs_page(1, 3))
    assert page["total"] == 5 and [x["label"] for x in page["items"]] == ["Pack 1", "Pack 2", "Pack 3"]
    assert set(page["items"][0]) == {"id", "label", "grade", "score_permille", "runs", "at", "previous"}
    assert len(json.loads(c.get_packs_page(3, 50))["items"]) == 2 and json.loads(c.get_packs_page(9, 5))["items"] == []


@pytest.mark.parametrize("offset,limit", [(-1, 5), (0, 0), (0, 51), (True, 5), (0, True), ("0", 5)])
def test_bad_page_arguments(direct_vm, direct_deploy, direct_owner, offset, limit):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    with direct_vm.expect_revert("bad page"):
        c.get_packs_page(offset, limit)


def test_the_board_limit(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    direct_vm.clear_mocks()
    direct_vm.mock_llm("BEGIN RULE", reply("CCVVCCVV"))
    for i in range(200):
        measure(c, make_pack(label="Pack %d" % i))
    assert c.get_pack_count() == 200
    with direct_vm.expect_revert("the board is full"):
        measure(c, make_pack(label="One too many"))
    at(direct_vm, 10)
    measure(c, make_pack(label="Pack 7"))               # a known pack can still be measured again
    assert len(report(c, pid_of(c, make_pack(label="Pack 7")))["runs"]) == 2


def test_views_tolerate_odd_keys(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    for junk in ("", "nope", 5, None):
        assert c.get_report_json(junk) == "NONE" and c.get_grade(junk) == "NONE"


def test_the_demo_packs_are_well_formed_and_linked(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    v1 = (FIXTURES / "refund-v1-vague.json").read_text()
    v2 = (FIXTURES / "refund-v2-precise.json").read_text()
    assert json.loads(v2)["previous"] == c.get_pack_id(v1)
    assert len(json.loads(v1)["wordings"]) == 4 and len(json.loads(v1)["cases"]) == 8
    direct_vm.clear_mocks()
    direct_vm.mock_llm("BEGIN RULE", reply("CCCVVVVU"))
    first = json.loads(c.measure(v1))
    second = json.loads(c.measure(v2))
    assert [x["id"] for x in json.loads(c.get_lineage_json(second["id"]))] == [second["id"], first["id"]]


# -- validator consensus -----------------------------------------------------------------------------------------------------------------

GRADES = ("UNSTABLE", "SHAKY", "USABLE", "STEADY")
BASE = ["CCVVCCVV", "CCVVCCVV", "CCVVCCVV", "CCVVCCVV"]


def canon(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def lead(rows):
    return canon({"state": "OK", "rows": rows})


def with_cells(rows, changes):
    out = [list(r) for r in rows]
    for i, j, letter in changes:
        out[i][j] = letter
    return ["".join(r) for r in out]


def leader_run(vm, deploy_fn, owner, pack=None, rows=None):
    c = deploy(vm, deploy_fn, owner)
    serve(vm, rows or BASE)
    measure(c, pack or make_pack())
    return c


def test_validator_accepts_the_identical_table(direct_vm, direct_deploy, direct_owner):
    leader_run(direct_vm, direct_deploy, direct_owner)
    assert direct_vm.run_validator() is True


def test_validator_accepts_one_flipped_cell_when_the_grade_holds(direct_vm, direct_deploy, direct_owner):
    leader_run(direct_vm, direct_deploy, direct_owner)
    assert direct_vm.run_validator(leader_result=lead(with_cells(BASE, [(2, 3, "C")]))) is True
    assert ref_metrics(make_pack(), with_cells(BASE, [(2, 3, "C")]))["grade"] == "STEADY"


WIDE = ["CCCCCCCCCCCC"] * 4 + ["VVVVVVCCCCCC"]          # 5 wordings x 12 cases, six cases with one dissenting wording


def test_validator_accepts_many_different_cells_when_the_grade_holds(direct_vm, direct_deploy, direct_owner):
    pack = make_pack(k=5, n=12)
    leader_run(direct_vm, direct_deploy, direct_owner, pack=pack, rows=WIDE)
    # ten cells differ (17% of 60) and two wordings differ in one case: the grade stays USABLE, so the reading is accepted
    ten = with_cells(WIDE, [(4, 0, "C"), (4, 1, "C"), (4, 2, "C"), (4, 3, "C"), (4, 4, "C"), (0, 6, "V"), (1, 7, "V"), (2, 8, "V"), (3, 9, "V"), (0, 10, "V")])
    assert ref_metrics(pack, ten)["grade"] == ref_metrics(pack, WIDE)["grade"]
    assert sum(a != b for ra, rb in zip(ten, WIDE) for a, b in zip(ra, rb)) == 10
    assert direct_vm.run_validator(leader_result=lead(ten)) is True


def test_validator_accepts_two_differences_in_one_case_when_the_grade_holds(direct_vm, direct_deploy, direct_owner):
    leader_run(direct_vm, direct_deploy, direct_owner)
    two = with_cells(BASE, [(0, 1, "V"), (1, 1, "V")])
    assert abs(GRADES.index(ref_metrics(make_pack(), two)["grade"]) - GRADES.index(ref_metrics(make_pack(), BASE)["grade"])) <= 1
    assert direct_vm.run_validator(leader_result=lead(two)) is True


def test_validator_accepts_a_grade_one_step_away_and_rejects_two_steps(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    pack = make_pack(k=3, n=6, tag="s")
    rows = ["CCVVCC"] * 3                                    # consistency 1000: STEADY
    serve(direct_vm, rows, tag="s")
    measure(c, pack)
    one = with_cells(rows, [(0, 0, "V")])                    # 1 step down
    two = with_cells(rows, [(0, 0, "V"), (1, 1, "V"), (2, 2, "C")])
    steps = lambda r: abs(GRADES.index(ref_metrics(pack, r)["grade"]) - GRADES.index(ref_metrics(pack, rows)["grade"]))
    assert steps(one) == 1
    assert steps(two) >= 2
    assert direct_vm.run_validator(leader_result=lead(one)) is True
    assert direct_vm.run_validator(leader_result=lead(two)) is False


REAL = {   # three independent readings of the vague refund rule by the Studionet validators' models, 2026-11-10
    "A": ["CCCVVCUU", "CVVVVCVV", "UUUUUUUU", "UUUUUUVU"],
    "B": ["CCUUVCVU", "CCUVVCVV", "CUUUVCVU", "UUUUUUVU"],
    "C": ["CCCUVCVU", "CUUUVCVU", "CUUVVCVV", "UUUUUUVU"],
}
REAL_PREFIXES = ["Approve a refund when", "A refund is valid only", "Refunds are granted", "The buyer may get a refund"]


def serve_real(vm, rows):
    vm.clear_mocks()
    for prefix, row in zip(REAL_PREFIXES, rows):
        vm.mock_llm("BEGIN RULE ---\\n" + prefix, reply(row))


@pytest.mark.parametrize("leader,validator", [("A", "B"), ("A", "C"), ("B", "C"), ("C", "A"), ("B", "A"), ("C", "B")])
def test_real_readings_of_a_vague_rule_settle(direct_vm, direct_deploy, direct_owner, leader, validator):
    """Real models differ in 19% to 38% of the cells on a vague rule; the validators must still settle on it."""
    pack = json.load(open(Path(__file__).resolve().parents[2] / "fixtures" / "refund-v1-vague.min.json"))
    c = deploy(direct_vm, direct_deploy, direct_owner)
    serve_real(direct_vm, REAL[leader])
    out = json.loads(measure(c, pack))
    assert out["grade"] == "UNSTABLE"
    serve_real(direct_vm, REAL[validator])
    assert direct_vm.run_validator() is True


def test_validator_rejects_a_table_that_would_be_a_different_grade_at_scale(direct_vm, direct_deploy, direct_owner):
    leader_run(direct_vm, direct_deploy, direct_owner)
    wild = ["CCVVCCVV", "VVCCVVCC", "CCVVCCVV", "VVCCVVCC"]
    assert direct_vm.run_validator(leader_result=lead(wild)) is False


def test_validator_rejects_an_error_when_it_can_measure(direct_vm, direct_deploy, direct_owner):
    leader_run(direct_vm, direct_deploy, direct_owner)
    assert direct_vm.run_validator(leader_result=canon({"state": "ERROR", "reason": "model"})) is False


def test_validator_rejects_a_table_when_its_own_model_fails(direct_vm, direct_deploy, direct_owner):
    c = leader_run(direct_vm, direct_deploy, direct_owner)
    serve(direct_vm, BASE, replies=["garbage", None, None, None])
    assert direct_vm.run_validator() is False


def test_validator_accepts_a_matching_error(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    serve(direct_vm, BASE, replies=["garbage", None, None, None])
    assert measure(c, make_pack()) == "UNMEASURABLE"
    assert direct_vm.run_validator() is True


def test_validator_rejects_bad_shapes(direct_vm, direct_deploy, direct_owner):
    leader_run(direct_vm, direct_deploy, direct_owner)
    good = lead(BASE)
    assert direct_vm.run_validator(leader_error=Exception("boom")) is False
    for result in (7, "nope", "[]", " " + good, "x" * 4001, canon({"state": "OK"}), canon({"state": "MAYBE", "rows": BASE}),
                   canon({"state": "ERROR", "reason": "http"}), canon({"state": "ERROR", "reason": "model", "x": 1}),
                   canon({"state": "OK", "rows": BASE, "x": 1}), json.dumps({"state": "OK", "rows": BASE})):
        assert direct_vm.run_validator(leader_result=result) is False, result
    for rows in (BASE[:3], BASE + ["CCVVCCVV"], [r[:7] for r in BASE], [r + "C" for r in BASE], ["CCVVCCVX"] * 4,
                 ["ccvvccvv"] * 4, [list(r) for r in BASE], "CCVVCCVV", None, [5] * 4):
        assert direct_vm.run_validator(leader_result=lead(rows)) is False, rows


def test_validator_does_not_trust_the_leaders_view_of_the_rule(direct_vm, direct_deploy, direct_owner):
    leader_run(direct_vm, direct_deploy, direct_owner)
    assert direct_vm.run_validator(leader_result=canon({"rows": BASE, "state": "OK", "grade": "STEADY"})) is False


# -- exact edges: limits, grade thresholds, tolerance, cooldown, clock ---------------------------------------------------------------------

def test_one_case_too_many_and_one_character_too_short(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    thirteen = make_pack(k=3, n=12)
    thirteen["cases"].append({"text": "Case number 13: one more than the contract allows.", "intent": "OPEN"})
    with direct_vm.expect_revert("need 6 to 12 cases"):
        c.get_pack_id(json.dumps(thirteen))
    short_wording = make_pack()
    short_wording["wordings"][0] = "w" * 19
    with direct_vm.expect_revert("invalid wording"):
        c.get_pack_id(json.dumps(short_wording))
    short_case = make_pack()
    short_case["cases"][0]["text"] = "c" * 9
    with direct_vm.expect_revert("invalid case"):
        c.get_pack_id(json.dumps(short_case))


def test_the_size_of_the_submitted_text_is_capped_exactly(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    base = json.dumps(make_pack(), separators=(",", ":"))
    ok = base + " " * (12000 - len(base))
    assert len(ok) == 12000 and len(c.get_pack_id(ok)) == 64
    with direct_vm.expect_revert("invalid pack"):
        c.get_pack_id(ok + " ")


@pytest.mark.parametrize("previous", ["a" * 63, "a" * 65, "g" * 64])
def test_a_previous_id_has_to_be_exactly_sixty_four_hex_characters(direct_vm, direct_deploy, direct_owner, previous):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    with direct_vm.expect_revert("invalid previous"):
        c.get_pack_id(json.dumps(make_pack(previous=previous)))


EDGE_TABLES = [
    (["CCCCCCCCCC", "CCCCCCCCCC", "CCCCCCCCCC", "CCCCCCCCCV", "CCCCCCCCVV"], 900, "STEADY"),
    (["CCCCCCCCCC", "CCCCCCCCCC", "CCCCCCCCCV", "CCCCCCCVVV", "CCCCCCVVUU"], 750, "USABLE"),
    (["CCCCCCCCCC", "CCCCCCCCCC", "CCCCCCVVVV", "CCCCVVVVVV", "CCCCVUUUUU"], 550, "SHAKY"),
]


@pytest.mark.parametrize("rows,score,grade", EDGE_TABLES)
def test_a_score_exactly_on_a_threshold_takes_the_higher_grade(direct_vm, direct_deploy, direct_owner, rows, score, grade):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    pack = make_pack(k=5, n=10)
    assert ref_metrics(pack, rows)["score"] == score
    serve(direct_vm, rows)
    out = json.loads(measure(c, pack))
    assert out["score_permille"] == score and out["grade"] == grade


def test_the_grade_distance_is_exactly_one_step(direct_vm, direct_deploy, direct_owner):
    # STEADY leader table against validator tables that are one, two and three grades lower
    leader_run(direct_vm, direct_deploy, direct_owner)
    pack = make_pack()
    steps = {}
    for name, rows in {"same": BASE, "one": ["CCVVCCVV", "CCVVCCVV", "CCVVCCVV", "CCVVCCCC"], "two": ["CCVVCCVV", "CCVVCCVV", "CCVVCCVV", "VVCCVVVV"],
                       "three": ["CCVVCCVV", "VVCCVVCC", "CCVVCCVV", "VVCCVVCC"]}.items():
        steps[name] = GRADES.index(ref_metrics(pack, BASE)["grade"]) - GRADES.index(ref_metrics(pack, rows)["grade"])
    assert (steps["same"], steps["one"], steps["two"], steps["three"]) == (0, 1, 2, 3)
    serve(direct_vm, BASE)
    for name, rows in {"one": ["CCVVCCVV", "CCVVCCVV", "CCVVCCVV", "CCVVCCCC"], "two": ["CCVVCCVV", "CCVVCCVV", "CCVVCCVV", "VVCCVVVV"],
                       "three": ["CCVVCCVV", "VVCCVVCC", "CCVVCCVV", "VVCCVVCC"]}.items():
        expected = steps[name] <= 1
        assert direct_vm.run_validator(leader_result=lead(rows)) is expected, name


def test_the_cooldown_is_exactly_three_hundred_seconds(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    serve(direct_vm, ["CCVVCCVV"] * 4)
    measure(c, make_pack())
    set_time(direct_vm, "2026-10-23T10:04:59Z")
    with direct_vm.expect_revert("measured too recently"):
        measure(c, make_pack())
    set_time(direct_vm, "2026-10-23T10:05:00Z")
    measure(c, make_pack())
    assert len(report(c, pid_of(c, make_pack()))["runs"]) == 2


def test_the_transaction_clock_is_read_with_its_offset(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    serve(direct_vm, ["CCVVCCVV"] * 4)
    set_time(direct_vm, "2026-10-23T13:00:00.250+03:00")
    pid = json.loads(measure(c, make_pack()))["id"]
    assert report(c, pid)["runs"][0]["at"] == ts(T0)
    set_time(direct_vm, "2026-10-23T10:00:00-02:00")
    other = json.loads(measure(c, make_pack(label="Second")))["id"]
    assert report(c, other)["runs"][0]["at"] == ts(T0) + 2 * 3600


@pytest.mark.parametrize("stamp", ["2026-02-30T10:00:00Z", "2026-13-01T10:00:00Z", "1969-12-31T10:00:00Z", "2026-10-23T25:00:00Z",
                                   "2026-10-23T10:00:00+0300", "nonsense", "2026-10-23T10:00:00X"])
def test_an_unreadable_transaction_clock_stops_the_measurement(direct_vm, direct_deploy, direct_owner, stamp):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    serve(direct_vm, ["CCVVCCVV"] * 4)
    set_time(direct_vm, stamp)
    with direct_vm.expect_revert("unreadable timestamp"):
        measure(c, make_pack())


def test_a_leader_error_with_a_bad_reason_is_not_accepted_even_when_the_validator_also_fails(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    serve(direct_vm, BASE, replies=["garbage"] * 4)
    assert measure(c, make_pack()) == "UNMEASURABLE"
    assert direct_vm.run_validator() is True
    assert direct_vm.run_validator(leader_result=canon({"state": "ERROR", "reason": "http"})) is False
    assert direct_vm.run_validator(leader_result=canon({"state": "ERROR", "reason": "model", "extra": 1})) is False


def test_the_unicode_demo_pack_has_the_id_the_web_page_computes(direct_vm, direct_deploy, direct_owner):
    """tests/browser/logic.test.mjs computes the same id in JavaScript; both must equal this value."""
    c = deploy(direct_vm, direct_deploy, direct_owner)
    text = (FIXTURES / "unicode-pack.json").read_text(encoding="utf-8")
    assert c.get_pack_id(text) == "b3993bc83ae6e6f36533e9ad1e75a825264d238a5a94de842282fba13bbf7f2f"
    assert c.get_pack_id((FIXTURES / "refund-v1-vague.json").read_text()) == "976df62ae598c0a1c04a07a325d5aa5e54a6697b001e357353317e68f1fcb2b3"
    assert c.get_pack_id((FIXTURES / "refund-v2-precise.json").read_text()) == "ad2fccd96e6e3536fe98afa7e268d979a384e2bd190f88c839eee882e87d0542"


# -- a wording whose answer is unusable is asked once more, and only once ------------------------------------------------------------------

def scripted_model(monkeypatch, script):
    """Replace the model with a function that plays `script` call by call (a string or an exception); returns the call log."""
    import genlayer.gl as gl_module
    log = []

    def fake(prompt, **kwargs):
        index = len(log)
        log.append(prompt)
        item = script[index] if index < len(script) else script[-1]
        if isinstance(item, Exception):
            raise item
        return item

    monkeypatch.setattr(gl_module.nondet, "exec_prompt", fake)
    return log


GOOD6 = json.dumps({"verdicts": ["COMPLIES"] * 6})
GOOD6_V = json.dumps({"verdicts": ["VIOLATES"] * 6})


def small_pack():
    return make_pack(k=3, n=6, tag="r")


@pytest.mark.parametrize("bad", ["garbage", "", json.dumps({"verdicts": ["COMPLIES"] * 5}), json.dumps({"verdicts": ["MAYBE"] * 6}),
                                 json.dumps({"verdicts": ["COMPLIES"] * 6, "x": 1}), RuntimeError("model unavailable")])
def test_a_wording_with_an_unusable_first_answer_is_asked_again(direct_vm, direct_deploy, direct_owner, monkeypatch, bad):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    log = scripted_model(monkeypatch, [bad, GOOD6, GOOD6, GOOD6, GOOD6])
    out = json.loads(measure(c, small_pack()))
    assert out["grade"] == "STEADY"
    assert len(log) == 4                                   # wording 1 twice, wordings 2 and 3 once


def test_two_unusable_answers_in_a_row_fail_the_measurement_after_exactly_two_tries(direct_vm, direct_deploy, direct_owner, monkeypatch):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    log = scripted_model(monkeypatch, ["garbage", "garbage", GOOD6, GOOD6, GOOD6])
    assert measure(c, small_pack()) == "UNMEASURABLE"
    assert len(log) == 2                                   # no third try, and the other wordings are not asked
    assert c.get_pack_count() == 0


def test_the_second_try_can_be_the_last_wording(direct_vm, direct_deploy, direct_owner, monkeypatch):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    log = scripted_model(monkeypatch, [GOOD6, GOOD6, "garbage", GOOD6_V])
    out = json.loads(measure(c, small_pack()))
    assert len(log) == 4
    assert report(c, out["id"])["runs"][0]["rows"] == ["CCCCCC", "CCCCCC", "VVVVVV"]


def test_a_validator_whose_model_needs_a_second_try_still_agrees(direct_vm, direct_deploy, direct_owner, monkeypatch):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    scripted_model(monkeypatch, [GOOD6])
    measure(c, small_pack())
    scripted_model(monkeypatch, ["garbage", GOOD6, "garbage", GOOD6, "garbage", GOOD6])
    assert direct_vm.run_validator() is True


def test_the_leading_comment_block_is_exactly_the_runner_json():
    """GenVM reads the whole contiguous run of '#' lines at the top of the file as ONE JSON document (genlayer-docs
    issue 487). A second comment line directly under the runner line made the Bradbury deployment fail with
    'invalid_contract runner malformed' while genvm-lint and these tests still passed."""
    root = Path(__file__).resolve().parents[2]
    leading = []
    for line in (root / CONTRACT).read_text().split("\n"):
        if not line.startswith("#"):
            break
        leading.append(line[1:])
    parsed = json.loads("\n".join(leading))
    assert list(parsed) == ["Depends"] and parsed["Depends"].startswith("py-genlayer:")
    assert len(leading) == 1
