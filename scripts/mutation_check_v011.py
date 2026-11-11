"""Mutation check of the v0.1.1 changes (grade-distance agreement and the second try). Run from the repository root:
python3 scripts/mutation_check_v011.py  -- each change is made on a disposable copy and the direct tests must fail."""
import shutil, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = "contracts/rule_wind_tunnel.py"
MUTANTS = [
    ("grade distance 0", "MAX_GRADE_STEPS = 1 ", "MAX_GRADE_STEPS = 0 ", 1),
    ("grade distance 2", "MAX_GRADE_STEPS = 1 ", "MAX_GRADE_STEPS = 2 ", 1),
    ("distance strict", "<= MAX_GRADE_STEPS", "< MAX_GRADE_STEPS", 1),
    ("distance not absolute", "return abs(GRADES.index(_metrics(pack, a)[\"grade\"]) - GRADES.index(_metrics(pack, b)[\"grade\"]))", "return (GRADES.index(_metrics(pack, a)[\"grade\"]) - GRADES.index(_metrics(pack, b)[\"grade\"]))", 1),
    ("grades out of order", 'GRADES = ("UNSTABLE", "SHAKY", "USABLE", "STEADY")', 'GRADES = ("UNSTABLE", "USABLE", "SHAKY", "STEADY")', 1),
    ("always close", "return abs(GRADES.index", "return True or abs(GRADES.index", 1),
    ("one try", "MODEL_TRIES = 2 ", "MODEL_TRIES = 1 ", 1),
    ("three tries", "MODEL_TRIES = 2 ", "MODEL_TRIES = 3 ", 1),
    ("no retry on failure", "        except Exception as exc:\n            last = exc\n", "        except Exception as exc:\n            raise\n", 1),
    ("failure swallowed", 'raise ValueError("no usable answer: " + str(last))', "return ''", 1),
    ("rows not checked for error", 'if parsed["state"] != mine["state"]:', "if False:", 1),
]


def run(directory):
    r = subprocess.run([sys.executable, "-m", "pytest", "tests/direct", "-q", "-x", "-p", "no:cacheprovider"], cwd=directory, capture_output=True, text=True)
    return r.returncode == 0


def main():
    with tempfile.TemporaryDirectory(prefix="mut-") as tmp:
        work = Path(tmp)
        shutil.copytree(ROOT / "contracts", work / "contracts")
        shutil.copytree(ROOT / "tests", work / "tests", ignore=shutil.ignore_patterns("browser", "glsim", "__pycache__"))
        shutil.copytree(ROOT / "fixtures", work / "fixtures")
        source = (ROOT / CONTRACT).read_text()
        if not run(work):
            print("base fails"); return 2
        print("base: tests pass on the unmodified contract")
        survived = []
        for label, old, new, nth in MUTANTS:
            if source.count(old) < nth:
                print("ANCHOR MISSING:", label); return 3
            parts = source.split(old)
            (work / CONTRACT).write_text(old.join(parts[:nth]) + new + old.join(parts[nth:]))
            if run(work):
                survived.append(label); print("SURVIVED:", label)
        print("mutants: %d, killed: %d, survived: %d" % (len(MUTANTS), len(MUTANTS) - len(survived), len(survived)))
        return 0


if __name__ == "__main__":
    sys.exit(main())
