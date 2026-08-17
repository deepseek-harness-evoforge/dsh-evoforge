"""Exercise Hermes' production Telegram approval adapter without network."""

from __future__ import annotations

import asyncio
import json
import os
import sys
import types
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch


def install_httpx_import_stub() -> None:
    module = types.ModuleType("httpx")

    class AsyncBaseTransport:
        pass

    class AsyncHTTPTransport:
        def __init__(self, **_kwargs):
            pass

        async def aclose(self) -> None:
            pass

    class Limits:
        def __init__(self, **_kwargs):
            pass

    class TransportError(Exception):
        pass

    module.AsyncBaseTransport = AsyncBaseTransport
    module.AsyncHTTPTransport = AsyncHTTPTransport
    module.AsyncClient = MagicMock
    module.Limits = Limits
    module.Timeout = MagicMock
    module.Request = MagicMock
    module.Response = MagicMock
    module.ConnectError = TransportError
    module.ConnectTimeout = TransportError
    sys.modules["httpx"] = module


def install_telegram_transport_stub() -> None:
    class InlineKeyboardButton:
        def __init__(self, text: str, callback_data: str):
            self.text = text
            self.callback_data = callback_data

    class InlineKeyboardMarkup:
        def __init__(self, rows):
            self.inline_keyboard = rows

    module = MagicMock()
    module.ext.ContextTypes.DEFAULT_TYPE = type(None)
    module.constants.ParseMode.MARKDOWN = "Markdown"
    module.constants.ParseMode.MARKDOWN_V2 = "MarkdownV2"
    module.constants.ParseMode.HTML = "HTML"
    module.constants.ChatType.PRIVATE = "private"
    module.constants.ChatType.GROUP = "group"
    module.constants.ChatType.SUPERGROUP = "supergroup"
    module.constants.ChatType.CHANNEL = "channel"
    module.InlineKeyboardButton = InlineKeyboardButton
    module.InlineKeyboardMarkup = InlineKeyboardMarkup
    module.error.NetworkError = type("NetworkError", (OSError,), {})
    module.error.TimedOut = type("TimedOut", (OSError,), {})
    module.error.BadRequest = type("BadRequest", (Exception,), {})
    for name in ("telegram", "telegram.ext", "telegram.constants", "telegram.request"):
        sys.modules[name] = module
    sys.modules["telegram.error"] = module.error


def callback(data: str, user_id: int, first_name: str) -> MagicMock:
    query = MagicMock()
    query.data = data
    query.message = SimpleNamespace(
        chat_id=1001,
        chat=SimpleNamespace(type="private"),
        message_thread_id=None,
    )
    query.from_user = SimpleNamespace(id=user_id, first_name=first_name)
    query.answer = AsyncMock()
    query.edit_message_text = AsyncMock()
    update = MagicMock()
    update.callback_query = query
    return update


async def exercise(hermes_repo: Path) -> dict:
    install_httpx_import_stub()
    install_telegram_transport_stub()
    sys.path.insert(0, str(hermes_repo))

    from gateway.config import PlatformConfig
    from plugins.platforms.telegram.adapter import TelegramAdapter

    adapter = TelegramAdapter(PlatformConfig(enabled=True, token="transport-stub-token"))
    adapter._bot = AsyncMock()
    adapter._app = MagicMock()
    adapter._message_handler = None
    adapter._bot.send_message = AsyncMock(
        return_value=SimpleNamespace(message_id=44)
    )

    sent = await adapter.send_exec_approval(
        chat_id="1001",
        command="deploy protected artifact",
        session_key="agent:main:telegram:dm:1001",
        description="Protected production action.",
        allow_permanent=False,
        allow_session=False,
    )
    approval_ids = list(adapter._approval_state)
    if len(approval_ids) != 1:
        raise RuntimeError(f"expected one Hermes approval state, got {approval_ids}")
    send_kwargs = adapter._bot.send_message.call_args.kwargs
    data = send_kwargs["reply_markup"].inline_keyboard[0][0].callback_data
    unauthorized = callback(data, 9999, "Wrong User")
    authorized = callback(data, 2002, "Exact User")
    replay = callback(data, 2002, "Exact User")
    resolver_calls: list[tuple[str, str]] = []

    def resolve(session_key: str, choice: str) -> int:
        resolver_calls.append((session_key, choice))
        return 1

    previous_allowlist = os.environ.get("TELEGRAM_ALLOWED_USERS")
    os.environ["TELEGRAM_ALLOWED_USERS"] = "2002"
    try:
        with patch("tools.approval.resolve_gateway_approval", side_effect=resolve):
            await adapter._handle_callback_query(unauthorized, MagicMock())
            calls_after_unauthorized = len(resolver_calls)
            state_after_unauthorized = len(adapter._approval_state)
            await adapter._handle_callback_query(authorized, MagicMock())
            calls_after_authorized = len(resolver_calls)
            state_after_authorized = len(adapter._approval_state)
            await adapter._handle_callback_query(replay, MagicMock())
            calls_after_replay = len(resolver_calls)
    finally:
        if previous_allowlist is None:
            os.environ.pop("TELEGRAM_ALLOWED_USERS", None)
        else:
            os.environ["TELEGRAM_ALLOWED_USERS"] = previous_allowlist

    return {
        "promptSent": sent.success is True,
        "promptChatIdExact": send_kwargs.get("chat_id") == 1001,
        "allowOnceCallbackShape": data == f"ea:once:{approval_ids[0]}",
        "resolverCallsAfterUnauthorized": calls_after_unauthorized,
        "pendingAfterUnauthorized": state_after_unauthorized,
        "resolverCallsAfterAuthorized": calls_after_authorized,
        "pendingAfterAuthorized": state_after_authorized,
        "resolverCallsAfterReplay": calls_after_replay,
        "authorizedChoice": resolver_calls[0][1] if resolver_calls else None,
        "unauthorizedToast": unauthorized.callback_query.answer.call_args.kwargs.get("text"),
        "replayToast": replay.callback_query.answer.call_args.kwargs.get("text"),
    }


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: hermes-telegram-approval.py <hermes-repo>")
    print(json.dumps(asyncio.run(exercise(Path(sys.argv[1]).resolve())), sort_keys=True))


if __name__ == "__main__":
    main()
