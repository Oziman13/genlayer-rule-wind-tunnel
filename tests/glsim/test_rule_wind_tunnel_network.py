"""Rule Wind Tunnel on a local GenLayer network (glsim, 5 validators): real leader/validator rounds, model mocked.

Every validator of the local network gets the same mocked model answers, so these tests show that the contract
runs through real consensus rounds, not how steady a real model is. glsim keeps mocks for the whole run, so each
test uses its own simulator and its own wording tokens.
"""
import json

import pytest

from rpc import RpcError, Sim

SENDER = "0x1111111111111111111111111111111111111111"
T0 = "2026-10-23T10:00:00Z"
T1 = "2026-10-23T10:10:00Z"
NAMES = {"C": "COMPLIES", "V": "VIOLATES", "U": "UNCLEAR"}


@pytest.fixture
def sim():
    simulator = Sim()
    try:
        yield simulator
    finally:
        simulator.close()


def pack(label="Parcel rule", previous=None, intents=None, tag=""):
    intents = intents or ["COMPLIES", "COMPLIES", "VIOLATES", "VIOLATES", "OPEN", "OPEN", "COMPLIES", "VIOLATES"]
    out = {"label": label,
           "wordings": ["Judge every case by this rule, version WORDING_%s%s." % (ch, tag) for ch in "ABCD"],
           "cases": [{"text": "Case number %d: a parcel arrives and something specific happens." % (i + 1), "intent": v}
                     for i, v in enumerate(intents)]}
    if previous:
        out["previous"] = previous
    return out


def serve(sim, rows, raw=None, tag=""):
    mocks = {}
    for i, row in enumerate(rows):
        mocks["WORDING_%s%s\\." % ("ABCD"[i], tag)] = (raw or {}).get(i) or json.dumps({"verdicts": [NAMES[c] for c in row]})
    sim.rpc("sim_installMocks", web_mocks={}, llm_mocks=mocks)


def deploy(sim):
    sim.set_time(T0)
    return sim.deploy("contracts/rule_wind_tunnel.py", [], SENDER)


def run(sim, tunnel, p):
    return sim.call(tunnel, "measure", [json.dumps(p)], SENDER)


def test_a_steady_pack_is_measured_by_five_validators(sim):
    tunnel = deploy(sim)
    row = "CCVVCUCV"
    serve(sim, [row] * 4)
    out = json.loads(run(sim, tunnel, pack()))
    assert out["grade"] == "STEADY" and out["score_permille"] == 1000
    report = sim.read_json(tunnel, "get_report_json", [out["id"]])
    assert report["runs"][0]["rows"] == [row] * 4 and report["report"]["boundary"] == []
    assert report["pack"]["wordings"][0].endswith("WORDING_A.")
    assert sim.read(tunnel, "get_pack_count") == 1 and sim.read(tunnel, "get_grade", [out["id"]]) == "STEADY"
    assert sim.read(tunnel, "get_pack_id", [json.dumps(pack())]) == out["id"]


def test_a_wobbly_pack_lists_its_boundary_cases(sim):
    tunnel = deploy(sim)
    serve(sim, ["CCVVCUCV", "CCVVVUCV", "CVVVCUCC", "CCVCCUVV"])
    out = json.loads(run(sim, tunnel, pack()))
    report = sim.read_json(tunnel, "get_report_json", [out["id"]])["report"]
    assert out["grade"] in ("SHAKY", "UNSTABLE", "USABLE") and out["grade"] != "STEADY"
    assert report["boundary"] and report["consistency_permille"] < 1000
    assert [c["class"] for c in report["per_case"]].count("UNANIMOUS") < 8


def test_a_malformed_answer_is_never_a_measurement(sim):
    tunnel = deploy(sim)
    serve(sim, ["CCVVCUCV"] * 4, raw={2: "I cannot decide."})
    assert run(sim, tunnel, pack()) == "UNMEASURABLE"
    assert sim.read(tunnel, "get_pack_count") == 0


def test_a_revision_links_back_and_the_numbers_compare(sim):
    tunnel = deploy(sim)
    serve(sim, ["CCVVCUCV", "CCVVVUCV", "CVVVCUCC", "CCVCCUVV"])
    first = json.loads(run(sim, tunnel, pack(label="Rule v1")))
    # mocks accumulate and the first match wins, so the revised wordings carry their own token
    serve(sim, ["CCVVCUCV"] * 4, tag="x")
    second = json.loads(run(sim, tunnel, pack(label="Rule v2", previous=first["id"], tag="x")))
    chain = sim.read_json(tunnel, "get_lineage_json", [second["id"]])
    assert [x["id"] for x in chain] == [second["id"], first["id"]]
    assert second["score_permille"] > first["score_permille"]
    cmp = sim.read_json(tunnel, "compare_json", [first["id"], second["id"]])
    assert cmp["delta"]["score_permille"] == second["score_permille"] - first["score_permille"] > 0


def test_a_rerun_waits_for_the_cooldown_and_counts_drift(sim):
    tunnel = deploy(sim)
    serve(sim, ["CCVVCUCV"] * 4)
    out = json.loads(run(sim, tunnel, pack()))
    with pytest.raises(RpcError):
        run(sim, tunnel, pack())                      # too soon
    sim.set_time(T1)
    again = json.loads(run(sim, tunnel, pack()))
    assert again["id"] == out["id"]
    report = sim.read_json(tunnel, "get_report_json", [out["id"]])
    assert len(report["runs"]) == 2 and report["drift_cells"] == 0
    page = sim.read_json(tunnel, "get_packs_page", [0, 10])
    assert page["total"] == 1 and page["items"][0]["runs"] == 2


def test_a_bad_pack_is_refused_before_any_model_call(sim):
    tunnel = deploy(sim)
    serve(sim, ["CCVVCUCV"] * 4)
    with pytest.raises(RpcError):
        sim.call(tunnel, "measure", ["{}"], SENDER)
    with pytest.raises(RpcError):
        run(sim, tunnel, pack(previous="d" * 64))       # a previous that was never measured
    assert sim.read(tunnel, "get_pack_count") == 0
