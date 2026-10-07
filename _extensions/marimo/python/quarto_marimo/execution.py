"""Observed marimo export; scheduling and result publication belong to the host."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from marimo._config.manager import get_default_config_manager
from marimo._messaging.notification import CellNotification, CompletedRunNotification
from marimo._messaging.serde import deserialize_kernel_message
from marimo._runtime.commands import AppMetadata
from marimo._session.consumer import SessionConsumer
from marimo._session.model import ConnectionState, SessionMode
from marimo._session.requests import InstantiateNotebookRequest
from marimo._session.session import SessionImpl
from marimo._session.startup import SessionStartup
from marimo._types.ids import ConsumerId

if TYPE_CHECKING:
    from collections.abc import Callable


async def run_observed_notebook(
    request: Any, on_output: Callable[[int, Any], None]
) -> tuple[Any, bool]:
    """Export once, notifying the host of each cell output before completion.

    The kernel remains marimo's ordinary export kernel. Caches are flushed on
    graceful close; notifications do not imply cache publication or success.
    The host must run exports in isolated processes, just as the CLI does.
    """
    manager = request.file_manager
    indices = {cid: i for i, cid in enumerate(manager.app.cell_manager.cell_ids())}
    finished = asyncio.Event()
    failures: list[Exception] = []

    class Consumer(SessionConsumer):
        @property
        def consumer_id(self) -> ConsumerId:
            return ConsumerId("quarto-export")

        def on_attach(self, session: Any, event_bus: Any) -> None:
            pass

        def on_detach(self) -> None:
            pass

        def connection_state(self) -> ConnectionState:
            return ConnectionState.OPEN

        def notify(self, notification: Any) -> None:
            data = deserialize_kernel_message(notification)
            if isinstance(data, CellNotification) and data.output is not None:
                try:
                    on_output(indices[data.cell_id], data.output)
                except Exception as error:  # noqa: BLE001 -- propagate host callback errors to the awaiting exporter
                    failures.append(error)
                    finished.set()
            if isinstance(data, CompletedRunNotification):
                finished.set()

    overrides: Any = {
        "runtime": {
            "on_cell_change": "autorun",
            "auto_instantiate": True,
            "auto_reload": "off",
            "cache_cells": request.options.cache_export,
        }
    }
    config = get_default_config_manager(current_path=manager.path).with_overrides(
        overrides
    )
    session = await SessionImpl.create(
        startup=SessionStartup(),
        initialization_id="quarto-export",
        session_consumer=Consumer(),
        mode=SessionMode.EDIT,
        app_metadata=AppMetadata(
            query_params={},
            filename=manager.path,
            cli_args=request.options.cli_args,
            argv=request.options.argv,
            app_config=manager.app.config,
        ),
        app_file_manager=manager,
        config_manager=config,
        virtual_file_storage=None,
        redirect_console_to_browser=False,
        ttl_seconds=None,
        auto_instantiate=True,
    )
    try:
        session.instantiate(
            InstantiateNotebookRequest(object_ids=[], values=[]), http_request=None
        )
        await finished.wait()
        if failures:
            raise failures[0]
        # Allow the distributor's session view to consume the completion event.
        await asyncio.sleep(0.1)
        return session.session_view, False
    finally:
        session.close(graceful=request.options.cache_export)
