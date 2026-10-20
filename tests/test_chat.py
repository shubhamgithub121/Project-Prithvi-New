import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx
import openai

import pytest
from fastapi.testclient import TestClient

import chat
from chatbot import engine, tools
from server import app


class FakeQuery:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.payload = db, table, [], "select", None
        self.order_key, self.desc, self.limit_n = None, False, None

    def select(self, *_):
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def order(self, key, desc=False):
        self.order_key, self.desc = key, desc
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    def insert(self, row):
        self.op, self.payload = "insert", row
        return self

    def update(self, values):
        self.op, self.payload = "update", values
        return self

    def execute(self):
        rows = self.db.setdefault(self.table, [])
        if self.op == "insert":
            rows.append(dict(self.payload))
            return SimpleNamespace(data=[self.payload])
        matched = [r for r in rows if all(r.get(k) == v for k, v in self.filters)]
        if self.op == "update":
            for r in matched:
                r.update(self.payload)
            return SimpleNamespace(data=matched)
        if self.order_key:
            matched = sorted(matched, key=lambda r: r[self.order_key], reverse=self.desc)
        if self.limit_n:
            matched = matched[: self.limit_n]
        return SimpleNamespace(data=[dict(r) for r in matched])


class FakeSupabase:
    def __init__(self):
        self.db = {}

    def table(self, name):
        return FakeQuery(self.db, name)


@pytest.fixture
def db(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(chat, "supabase", fake)
    monkeypatch.setattr(tools, "supabase", fake)
    chat._hits.clear()
    return fake


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def as_user(monkeypatch):
    def _login(user_id="u1", name="Asha"):
        user = SimpleNamespace(id=user_id, email=f"{name.lower()}@x.com", user_metadata={"full_name": name})
        monkeypatch.setattr(chat, "get_current_user", lambda auth: user)
        return {"Authorization": "Bearer t"}
    return _login


def events_of(resp):
    return [json.loads(line[6:]) for line in resp.text.splitlines() if line.startswith("data: ")]


def pickup(id_, user_id="u1", status="scheduled", kg=4.0, created="2026-10-01"):
    return {"id": id_, "user_id": user_id, "status": status, "pickup_date": "2026-10-20", "time_slot": "8-12",
            "city": "Delhi", "estimated_weight_kg": kg, "estimated_earnings": kg * 15, "created_at": created}


class TestChatEndpoint:
    def test_flows_list(self, client, db):
        flows = client.get("/api/chat/flows").json()
        assert {"id": "schedule", "label": "Schedule a pickup", "primary": True} in flows

    def test_static_flow_skips_model_and_saves_both_messages(self, client, db, monkeypatch):
        monkeypatch.setattr(engine, "run_turn", MagicMock(side_effect=AssertionError("model called")))
        resp = client.post("/api/chat", json={"flow": "plastics"})
        events = events_of(resp)
        assert events[0]["type"] == "session"
        assert "PET" in events[1]["text"]
        assert events[-1]["type"] == "done" and events[-1]["message_id"]
        roles = [m["role"] for m in db.db["chat_messages"]]
        assert roles == ["user", "assistant"]
        assert db.db["chat_sessions"][0]["user_id"] is None

    def test_rejects_unknown_flow_empty_and_long_messages(self, client, db):
        assert client.post("/api/chat", json={"flow": "nope"}).status_code == 400
        assert client.post("/api/chat", json={"message": "   "}).status_code == 400
        assert client.post("/api/chat", json={"message": "x" * 501}).status_code == 422

    def test_message_streams_model_events_and_passes_history(self, client, db, as_user, monkeypatch):
        headers = as_user("u1", "Asha")
        seen = {}

        def fake_turn(history, user_id, user_name):
            seen.update(history=history, user_id=user_id, user_name=user_name)
            yield {"type": "text", "text": "Hi Asha"}
            yield {"type": "final", "text": "Hi Asha", "meta": {"model": "m"}}

        monkeypatch.setattr(engine, "run_turn", fake_turn)
        first = events_of(client.post("/api/chat", json={"message": "hello"}, headers=headers))
        session_id = first[0]["session_id"]
        assert seen == {"history": [{"role": "user", "content": "hello"}], "user_id": "u1", "user_name": "Asha"}

        client.post("/api/chat", json={"message": "again", "session_id": session_id}, headers=headers)
        assert seen["history"] == [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "Hi Asha"},
            {"role": "user", "content": "again"},
        ]

    def test_prompt_flow_sends_prompt_to_model(self, client, db, monkeypatch):
        seen = {}

        def fake_turn(history, user_id, user_name):
            seen["last"] = history[-1]["content"]
            yield {"type": "final", "text": "ok", "meta": {}}

        monkeypatch.setattr(engine, "run_turn", fake_turn)
        client.post("/api/chat", json={"flow": "track"})
        assert seen["last"] == "Show my pickups and their status."
        assert db.db["chat_messages"][0]["content"] == "Track my pickup"

    def test_cannot_use_another_users_session(self, client, db, as_user):
        db.db["chat_sessions"] = [{"id": "11111111-1111-1111-1111-111111111111", "user_id": "u2"}]
        headers = as_user("u1")
        events = events_of(client.post("/api/chat", json={"flow": "about", "session_id": "11111111-1111-1111-1111-111111111111"}, headers=headers))
        assert events[0]["session_id"] != "11111111-1111-1111-1111-111111111111"
        assert client.get("/api/chat/history", params={"session_id": "11111111-1111-1111-1111-111111111111"}, headers=headers).status_code == 404

    def test_guest_session_is_claimed_on_sign_in(self, client, db, as_user):
        sid = events_of(client.post("/api/chat", json={"flow": "about"}))[0]["session_id"]
        client.post("/api/chat", json={"flow": "about", "session_id": sid}, headers=as_user("u1"))
        assert db.db["chat_sessions"][0]["user_id"] == "u1"

    def test_rate_limit(self, client, db, monkeypatch):
        monkeypatch.setattr(chat, "RATE_LIMITS", [(60, 2)])
        assert client.post("/api/chat", json={"flow": "about"}).status_code == 200
        assert client.post("/api/chat", json={"flow": "about"}).status_code == 200
        assert client.post("/api/chat", json={"flow": "about"}).status_code == 429

    def test_feedback_only_on_own_assistant_message(self, client, db, as_user):
        events = events_of(client.post("/api/chat", json={"flow": "about"}, headers=as_user("u1")))
        sid, mid = events[0]["session_id"], events[-1]["message_id"]
        ok = client.post("/api/chat/feedback", json={"session_id": sid, "message_id": mid, "rating": "up"}, headers=as_user("u1"))
        assert ok.status_code == 200
        assert [m["feedback"] for m in db.db["chat_messages"] if m["id"] == mid] == ["up"]
        other = client.post("/api/chat/feedback", json={"session_id": sid, "message_id": mid, "rating": "down"}, headers=as_user("u2"))
        assert other.status_code == 404


class TestTools:
    def test_estimate_earnings(self, db):
        result, ui = tools.run_tool("estimate_earnings", {"weight_kg": 4}, None)
        assert json.loads(result)["estimated_earnings_rs"] == 60
        assert ui is None
        for bad in ({"weight_kg": 0.2}, {"weight_kg": "4"}, {"weight_kg": True}, {}):
            with pytest.raises(tools.ToolError):
                tools.run_tool("estimate_earnings", bad, None)

    def test_user_tools_require_sign_in(self, db):
        with pytest.raises(tools.ToolError, match="not signed in"):
            tools.run_tool("get_my_pickups", {}, None)

    def test_get_my_pickups_only_returns_own_rows(self, db):
        db.db["pickups"] = [pickup("a"), pickup("b", user_id="u2")]
        result, ui = tools.run_tool("get_my_pickups", {}, "u1")
        assert [p["id"] for p in json.loads(result)["pickups"]] == ["a"]
        assert ui["type"] == "pickups" and ui["pickups"][0]["time_slot"] == "8 AM - 12 PM"

    def test_impact_skips_cancelled_and_reports_tier(self, db):
        db.db["pickups"] = [pickup("a", kg=4), pickup("b", kg=2), pickup("c", kg=50, status="cancelled")]
        impact = json.loads(tools.run_tool("get_my_impact", {}, "u1")[0])
        assert impact["total_kg"] == 6
        assert impact["tier"] == "Sprout" and impact["next_tier"] == "Tree" and impact["kg_to_next_tier"] == 14

    def test_request_cancel_shows_confirm_without_cancelling(self, db):
        db.db["pickups"] = [pickup("a")]
        _, ui = tools.run_tool("request_cancel_pickup", {"pickup_id": "a"}, "u1")
        assert ui == {"type": "confirm_cancel", "pickup": tools._pickup_card(pickup("a"))}
        assert db.db["pickups"][0]["status"] == "scheduled"

    def test_request_cancel_rejects_other_users_and_cancelled(self, db):
        db.db["pickups"] = [pickup("a", user_id="u2"), pickup("b", status="cancelled")]
        with pytest.raises(tools.ToolError, match="No pickup"):
            tools.run_tool("request_cancel_pickup", {"pickup_id": "a"}, "u1")
        with pytest.raises(tools.ToolError, match="already cancelled"):
            tools.run_tool("request_cancel_pickup", {"pickup_id": "b"}, "u1")


def chunk(content=None, tool_calls=None, finish_reason=None):
    delta = SimpleNamespace(content=content, tool_calls=tool_calls)
    return SimpleNamespace(choices=[SimpleNamespace(delta=delta, finish_reason=finish_reason)], usage=None)


def usage_chunk():
    usage = SimpleNamespace(prompt_tokens=10, completion_tokens=5, prompt_tokens_details=SimpleNamespace(cached_tokens=4))
    return SimpleNamespace(choices=[], usage=usage)


def tool_call_delta(index, id=None, name=None, arguments=None, extra=None):
    return SimpleNamespace(index=index, id=id, function=SimpleNamespace(name=name, arguments=arguments), model_extra=extra)


class TestEngine:
    def fake_client(self, monkeypatch, streams):
        calls = []

        def create(**kwargs):
            calls.append(kwargs)
            return iter(streams.pop(0))

        monkeypatch.setattr(engine, "_client", SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))))
        monkeypatch.setattr(engine, "_cooldown_until", {})
        return calls

    def test_falls_back_when_model_out_of_quota(self, monkeypatch, db):
        monkeypatch.setattr(engine, "MODELS", ["main", "backup"])
        response = httpx.Response(429, request=httpx.Request("POST", "http://x"))
        quota = openai.RateLimitError("GenerateRequestsPerDayPerProjectPerModel-FreeTier", response=response, body=None)
        streams = [[chunk("Hi!", finish_reason="stop")], [chunk("Again.", finish_reason="stop")]]
        models = []

        def create(**kwargs):
            models.append(kwargs["model"])
            if kwargs["model"] == "main":
                raise quota
            return iter(streams.pop(0))

        monkeypatch.setattr(engine, "_client", SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))))
        monkeypatch.setattr(engine, "_cooldown_until", {})
        events = list(engine.run_turn([{"role": "user", "content": "x"}], None, None))
        assert events[-1]["text"] == "Hi!" and events[-1]["meta"]["model"] == "backup"
        list(engine.run_turn([{"role": "user", "content": "x"}], None, None))
        assert models == ["main", "backup", "backup"]  # main is skipped while cooling down

    def test_all_models_out_of_quota_says_sorry(self, monkeypatch, db):
        monkeypatch.setattr(engine, "MODELS", ["main", "backup"])
        response = httpx.Response(429, request=httpx.Request("POST", "http://x"))

        def create(**kwargs):
            raise openai.RateLimitError("PerDay", response=response, body=None)

        monkeypatch.setattr(engine, "_client", SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))))
        monkeypatch.setattr(engine, "_cooldown_until", {})
        events = list(engine.run_turn([{"role": "user", "content": "x"}], None, None))
        assert events[-1]["text"] == engine.SORRY

    def test_tool_round_then_answer(self, monkeypatch, db):
        db.db["pickups"] = [pickup("a")]
        calls = self.fake_client(monkeypatch, [
            [chunk("Let me check."),
             chunk(tool_calls=[tool_call_delta(0, id="t1", name="get_my_pickups", arguments="{")]),
             chunk(tool_calls=[tool_call_delta(0, arguments="}")], finish_reason="tool_calls"),
             usage_chunk()],
            [chunk("You have 1 pickup.", finish_reason="stop"), usage_chunk()],
        ])
        events = list(engine.run_turn([{"role": "user", "content": "track"}], "u1", "Asha"))
        types = [e["type"] for e in events]
        assert types == ["text", "status", "pickups", "text", "text", "final"]
        assert events[-1]["text"] == "Let me check.\n\nYou have 1 pickup."
        assert events[-1]["meta"]["tools"] == ["get_my_pickups"]
        assert events[-1]["meta"]["usage"] == {"input": 20, "output": 10, "cache_read": 8}
        second = calls[1]["messages"]
        assert second[0]["role"] == "system" and second[0]["content"].startswith(engine.SYSTEM_PROMPT)
        assert second[-2]["tool_calls"][0]["function"] == {"name": "get_my_pickups", "arguments": "{}"}
        assert second[-1]["role"] == "tool" and second[-1]["tool_call_id"] == "t1"

    def test_gemini_parallel_calls_keep_thought_signature(self, monkeypatch, db):
        sig = {"google": {"thought_signature": "abc"}}
        calls = self.fake_client(monkeypatch, [
            [chunk(tool_calls=[tool_call_delta(None, id="g1", name="estimate_earnings", arguments='{"weight_kg": 5}',
                                               extra={"extra_content": sig})]),
             chunk(tool_calls=[tool_call_delta(None, id="g2", name="estimate_earnings", arguments='{"weight_kg": 2}')],
                   finish_reason="tool_calls")],
            [chunk("Done.", finish_reason="stop")],
        ])
        list(engine.run_turn([{"role": "user", "content": "x"}], None, None))
        sent = calls[1]["messages"]
        assert [c["id"] for c in sent[-3]["tool_calls"]] == ["g1", "g2"]
        assert sent[-3]["tool_calls"][0]["extra_content"] == sig
        assert "extra_content" not in sent[-3]["tool_calls"][1]
        assert [m["tool_call_id"] for m in sent[-2:]] == ["g1", "g2"]

    def test_bad_tool_json_becomes_error_result(self, monkeypatch, db):
        calls = self.fake_client(monkeypatch, [
            [chunk(tool_calls=[tool_call_delta(0, name="estimate_earnings", arguments="{oops")], finish_reason="tool_calls")],
            [chunk("Sorry.", finish_reason="stop")],
        ])
        events = list(engine.run_turn([{"role": "user", "content": "x"}], None, None))
        tool_msg = calls[1]["messages"][-1]
        assert tool_msg["content"].startswith("Error:") and tool_msg["tool_call_id"] == "call_1_0"
        assert events[-1]["text"] == "Sorry."

    def test_content_filter_replaces_partial_text(self, monkeypatch, db):
        self.fake_client(monkeypatch, [[chunk("partial", finish_reason="content_filter")]])
        events = list(engine.run_turn([{"role": "user", "content": "x"}], None, None))
        assert events[-2] == {"type": "replace", "text": engine.REFUSAL}
        assert events[-1]["text"] == engine.REFUSAL
