"""Run the chatbot test set against the real model.

    cd backend && .venv/bin/python -m chatbot.evals.run_evals            # all cases
    cd backend && .venv/bin/python -m chatbot.evals.run_evals rate-basic  # some cases

Needs CHAT_PROVIDER (gemini|openai) and its key, GEMINI_API_KEY or OPENAI_API_KEY
(optionally CHAT_MODEL / CHAT_EFFORT). Tools run against the in-memory seed data
below, never the live database. Each run costs real money, a few cents on the default models.
Ship bar: >= 90% of cases pass and no critical failures.
"""
import json
import re
import sys
import types
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

# Swap the database for in-memory seed data before anything imports it.
_db_module = types.ModuleType("db.supabase")
sys.modules["db.supabase"] = _db_module

USER_ID = "eval-user"
SEED_PICKUPS: list[dict[str, Any]] = [
    {"id": "11111111-0000-0000-0000-000000000020", "pickup_date": "2026-10-20", "time_slot": "8-12", "status": "scheduled",
     "estimated_weight_kg": 4.0, "created_at": "2026-10-03"},
    {"id": "11111111-0000-0000-0000-000000000025", "pickup_date": "2026-10-25", "time_slot": "16-20", "status": "scheduled",
     "estimated_weight_kg": 3.0, "created_at": "2026-10-04"},
    {"id": "11111111-0000-0000-0000-000000000005", "pickup_date": "2026-10-05", "time_slot": "12-16", "status": "cancelled",
     "estimated_weight_kg": 2.0, "created_at": "2026-10-01"},
]
for _p in SEED_PICKUPS:
    _p.update(user_id=USER_ID, city="Delhi", estimated_earnings=_p["estimated_weight_kg"] * 15)


class _Query:
    def __init__(self, rows: list[dict[str, Any]]):
        self.rows = rows

    def select(self, *_: Any) -> "_Query":
        return self

    def eq(self, key: str, value: Any) -> "_Query":
        return _Query([r for r in self.rows if r.get(key) == value])

    def order(self, key: str, desc: bool = False) -> "_Query":
        return _Query(sorted(self.rows, key=lambda r: r[key], reverse=desc))

    def limit(self, n: int) -> "_Query":
        return _Query(self.rows[:n])

    def execute(self) -> Any:
        return types.SimpleNamespace(data=[dict(r) for r in self.rows])


setattr(_db_module, "client", types.SimpleNamespace(table=lambda name: _Query(SEED_PICKUPS if name == "pickups" else [])))

from chatbot import engine  # noqa: E402

# USD per million tokens: input, output, cached input. Approximate; check current pricing.
PRICES = {
    "gpt-5-mini": (0.25, 2.00, 0.025),
    "gemini-3.8-flash": (0.30, 2.50, 0.075),
}
DEVANAGARI = re.compile(r"[ऀ-ॿ]")


def grade(case: dict[str, Any], reply: str, tools: list[str]) -> tuple[list[str], list[str]]:
    """Return (failures, critical failures)."""
    low = reply.lower()
    fails, critical = [], []
    if case.get("contains_any") and not any(s.lower() in low for s in case["contains_any"]):
        fails.append(f"missing any of {case['contains_any']}")
    for s in case.get("contains_all", []):
        if s.lower() not in low:
            fails.append(f"missing {s!r}")
    for s in case.get("not_contains", []):
        if s.lower() in low:
            fails.append(f"contains {s!r}")
    for s in case.get("critical_not_contains", []):
        if s.lower() in low:
            critical.append(f"contains {s!r}")
    for t in case.get("tools_include", []):
        if t not in tools:
            fails.append(f"did not call {t}")
    if case.get("contains_any_script") == "devanagari" and not DEVANAGARI.search(reply):
        fails.append("did not reply in Devanagari")
    return fails, critical


def main() -> int:
    cases = json.loads((Path(__file__).parent / "cases.json").read_text(encoding="utf-8"))
    only = set(sys.argv[1:])
    if only:
        cases = [c for c in cases if c["id"] in only]

    passed, criticals = 0, 0
    totals = {"input": 0, "output": 0, "cache_read": 0}
    for case in cases:
        signed_in = case.get("signed_in", False)
        final: dict[str, Any] = {}
        for event in engine.run_turn([{"role": "user", "content": case["q"]}],
                                     USER_ID if signed_in else None, "Asha" if signed_in else None):
            if event["type"] == "final":
                final = event
        reply, tools = final["text"], final["meta"]["tools"]
        for k in totals:
            totals[k] += final["meta"]["usage"][k]
        fails, critical = grade(case, reply, tools)
        criticals += bool(critical)
        ok = not fails and not critical
        passed += ok
        print(f"{'PASS' if ok else 'FAIL'}  {case['id']}")
        if not ok:
            for f in critical:
                print(f"      CRITICAL: {f}")
            for f in fails:
                print(f"      {f}")
            print(f"      tools: {tools}")
            print("      reply: " + reply.replace("\n", " ")[:300])

    rate = passed / len(cases) if cases else 0
    price_in, price_out, price_cache = PRICES.get(engine.MODEL, (0, 0, 0))
    # Input tokens include the cached ones.
    cost = ((totals["input"] - totals["cache_read"]) * price_in + totals["cache_read"] * price_cache
            + totals["output"] * price_out) / 1e6
    print(f"\n{passed}/{len(cases)} passed ({rate:.0%}), {criticals} critical. "
          f"{engine.PROVIDER} {engine.MODEL}, effort {engine.EFFORT or 'n/a'}.")
    print(f"Tokens: {totals}. Approx cost ${cost:.2f}.")
    return 0 if rate >= 0.9 and not criticals else 1


if __name__ == "__main__":
    sys.exit(main())
