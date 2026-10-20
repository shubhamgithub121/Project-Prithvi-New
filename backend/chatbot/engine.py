"""Model tool loop for one chat turn, yielding events for the widget.

Talks to OpenAI, or to Gemini through its OpenAI-compatible endpoint, picked by CHAT_PROVIDER.
"""
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Iterator, Optional, cast

import openai
from openai.types.chat import ChatCompletionMessageParam

from chatbot.prompt import SYSTEM_PROMPT, request_context
from chatbot.tools import STATUS_TEXT, TOOLS, ToolError, run_tool

logger = logging.getLogger(__name__)

# provider: (api key env var, base url, default model, default fallback models)
PROVIDERS: dict[str, tuple[str, Optional[str], str, str]] = {
    "openai": ("OPENAI_API_KEY", None, "gpt-5-mini", ""),
    "gemini": ("GEMINI_API_KEY", "https://generativelanguage.googleapis.com/v1beta/openai/", "gemini-3.8-flash",
               "gemini-3.7-flash,gemini-3.5-flash,gemini-3.1-flash-lite"),
}
PROVIDER = os.environ.get("CHAT_PROVIDER", "gemini").lower()
if PROVIDER not in PROVIDERS:
    raise ValueError(f"CHAT_PROVIDER must be one of {sorted(PROVIDERS)}, got {PROVIDER!r}")
KEY_ENV, BASE_URL, DEFAULT_MODEL, DEFAULT_FALLBACKS = PROVIDERS[PROVIDER]
MODEL = os.environ.get("CHAT_MODEL", DEFAULT_MODEL)
# Tried in order when a model is out of quota or retired (e.g. Gemini's free tier caps each model per day).
FALLBACK_MODELS = [m.strip() for m in os.environ.get("CHAT_FALLBACK_MODELS", DEFAULT_FALLBACKS).split(",") if m.strip()]
MODELS = [MODEL, *(m for m in FALLBACK_MODELS if m != MODEL)]
# Reasoning effort for reasoning models; set CHAT_EFFORT="" for models that reject the parameter.
EFFORT = os.environ.get("CHAT_EFFORT", "low")
MAX_TOOL_ROUNDS = 5

SORRY = "Sorry, I couldn't finish that. Please try again, or contact support at sgoswami6420@gmail.com."
REFUSAL = "Sorry, I can't help with that. I can help with pickups, recycling, rewards and the Eco Shop."

_client: Optional[openai.OpenAI] = None
_cooldown_until: dict[str, float] = {}  # model -> time it may be retried


def _get_client() -> openai.OpenAI:
    global _client
    if _client is None:
        # One retry only: quota errors are handled by switching model, not by waiting.
        _client = openai.OpenAI(api_key=os.environ.get(KEY_ENV), base_url=BASE_URL, timeout=60.0, max_retries=1)
    return _client


def _open_stream(**kwargs: Any) -> tuple[Any, str]:
    """Start a streamed completion on the first model that isn't out of quota. Returns (stream, model)."""
    now = time.time()
    candidates = [m for m in MODELS if _cooldown_until.get(m, 0) <= now] or MODELS
    for i, model in enumerate(candidates):
        try:
            return _get_client().chat.completions.create(model=model, **kwargs), model
        except (openai.RateLimitError, openai.NotFoundError) as e:
            if i == len(candidates) - 1:
                raise
            daily = "PerDay" in str(e) or isinstance(e, openai.NotFoundError)
            _cooldown_until[model] = now + (3600 if daily else 60)
            logger.warning(f"{model} unavailable ({e.status_code}), falling back to {candidates[i + 1]}")
    raise AssertionError("unreachable")


def _parse_args(raw: str) -> Any:
    try:
        return json.loads(raw or "{}")
    except json.JSONDecodeError:
        return None  # run_tool rejects non-dict input as a ToolError


def run_turn(
    history: list[ChatCompletionMessageParam], user_id: Optional[str], user_name: Optional[str]
) -> Iterator[dict[str, Any]]:
    """Run one assistant turn over `history` (text-only user/assistant messages).

    Yields widget events: {"type": "text"|"status"|"pickups"|"confirm_cancel"|"replace", ...}, and
    finally {"type": "final", "text": <full reply>, "meta": {...}}.
    """
    # Frozen prompt first so the provider's automatic prefix caching can reuse it.
    system = SYSTEM_PROMPT + "\n\n" + request_context(user_name, datetime.now(timezone.utc).date())
    messages: list[ChatCompletionMessageParam] = [{"role": "system", "content": system}, *history]
    parts: list[str] = []
    tools_used: list[str] = []
    usage = {"input": 0, "output": 0, "cache_read": 0}
    rounds = 0
    extra: dict[str, Any] = {"reasoning_effort": EFFORT} if EFFORT else {}
    model = MODEL

    def finish(text: str = "") -> dict[str, Any]:
        if text:
            parts.append(text)
        return {"type": "final", "text": "".join(parts).strip(),
                "meta": {"provider": PROVIDER, "model": model, "tools": tools_used, "usage": usage}}

    while True:
        round_text: list[str] = []
        calls: dict[int, dict[str, Any]] = {}
        finish_reason: Optional[str] = None
        try:
            stream, model = _open_stream(messages=messages, tools=TOOLS, stream=True,
                                         stream_options={"include_usage": True}, **extra)
            for chunk in stream:
                if chunk.usage:
                    usage["input"] += chunk.usage.prompt_tokens or 0
                    usage["output"] += chunk.usage.completion_tokens or 0
                    details = chunk.usage.prompt_tokens_details
                    usage["cache_read"] += (details.cached_tokens or 0) if details else 0
                if not chunk.choices:
                    continue
                choice = chunk.choices[0]
                delta = choice.delta
                if delta.content:
                    parts.append(delta.content)
                    round_text.append(delta.content)
                    yield {"type": "text", "text": delta.content}
                for tc in delta.tool_calls or []:
                    # Gemini sends each call whole with no index; OpenAI streams pieces under one index.
                    call = calls.setdefault(tc.index if tc.index is not None else len(calls),
                                            {"id": "", "name": "", "arguments": ""})
                    if tc.id:
                        call["id"] = tc.id
                    extra_content = (tc.model_extra or {}).get("extra_content")
                    if extra_content:
                        call["extra_content"] = extra_content  # Gemini thought_signature; must be sent back
                    if tc.function and tc.function.name:
                        call["name"] += tc.function.name
                    if tc.function and tc.function.arguments:
                        call["arguments"] += tc.function.arguments
                finish_reason = choice.finish_reason or finish_reason
        except openai.APIError as e:
            logger.error(f"{PROVIDER} API error: {e}")
            yield {"type": "text", "text": SORRY}
            yield finish(SORRY)
            return

        if finish_reason == "content_filter":
            # A block can arrive mid-reply; tell the widget to replace any partial text.
            parts.clear()
            yield {"type": "replace", "text": REFUSAL}
            yield finish(REFUSAL)
            return

        if not calls:
            yield finish()
            return
        if finish_reason == "length" or rounds >= MAX_TOOL_ROUNDS:
            yield {"type": "text", "text": SORRY}
            yield finish(SORRY)
            return
        rounds += 1

        tool_calls = [calls[i] for i in sorted(calls)]
        for i, call in enumerate(tool_calls):
            call["id"] = call["id"] or f"call_{rounds}_{i}"  # some providers omit ids
        assistant: dict[str, Any] = {
            "role": "assistant",
            "content": "".join(round_text) or None,
            "tool_calls": [{"id": c["id"], "type": "function",
                            "function": {"name": c["name"], "arguments": c["arguments"] or "{}"},
                            **({"extra_content": c["extra_content"]} if "extra_content" in c else {})} for c in tool_calls],
        }
        messages.append(cast(ChatCompletionMessageParam, assistant))  # extra_content isn't in the SDK's types
        for call in tool_calls:
            tools_used.append(call["name"])
            yield {"type": "status", "text": STATUS_TEXT.get(call["name"], "Working…")}
            try:
                content, ui_event = run_tool(call["name"], _parse_args(call["arguments"]), user_id)
                if ui_event:
                    yield ui_event
            except ToolError as e:
                content = f"Error: {e}"
            except Exception as e:  # database or other unexpected failure
                logger.error(f"Tool {call['name']} failed: {e}")
                content = "Error: the tool failed. Apologise and suggest trying again later."
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": content})
        if parts and not parts[-1].endswith(("\n", " ")):
            parts.append("\n\n")
            yield {"type": "text", "text": "\n\n"}
