from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

import pytest
from quarto_marimo.execution_cache import cached_page


@pytest.fixture
def cached(tmp_path: Path, monkeypatch):
    source = tmp_path / "project/page.qmd"
    source.parent.mkdir()
    source.write_text("Body", encoding="utf-8")
    dependency = tmp_path / "dependency.py"
    dependency.write_text("value = 1", encoding="utf-8")
    config = {
        "cache_dir": str(tmp_path / "cache"),
        "source_roots": [],
        "pages": {
            "page.qmd": {
                "namespace": "page",
                "context": "environment-1",
                "dependencies_file": str(tmp_path / "dependencies.json"),
                "lines": [12],
            }
        },
    }
    config_path = source.parent / ".marimo-cache.json"
    config_path.write_text(json.dumps(config), encoding="utf-8")
    monkeypatch.setenv("QUARTO_MARIMO_CACHE_CONFIG", str(config_path))
    monkeypatch.setattr(
        "quarto_marimo.execution_cache.source_dependencies",
        lambda _: {"files": [str(dependency)], "complete": True},
    )
    return source, dependency, config_path, config


def run(source, output, events, *, identity="cells-1", error=False, change=None):
    def compile_page():
        events.append("executed")
        (output / "public/cache").mkdir(parents=True, exist_ok=True)
        (output / "public/cache/value.bin").write_bytes(b"computed")
        if change:
            change()
        return {
            "cells": [
                {
                    "index": 0,
                    "output": {
                        "mimetype": "application/vnd.marimo+error"
                        if error
                        else "text/plain",
                        "data": "result",
                    },
                }
            ]
        }

    return cached_page(str(source), identity, lambda: "code", output, compile_page)


def test_cache_restores_payload_resources_and_current_provenance(
    cached, tmp_path, monkeypatch
):
    source, _, config_path, config = cached
    events = []
    expected = run(source, tmp_path / "first", events)
    # Changing prose, source lines, and the worker directory must not execute cells.
    moved = tmp_path / "worker-2"
    moved.mkdir()
    (moved / "page.qmd").write_text("Changed body", encoding="utf-8")
    config["pages"]["page.qmd"]["lines"] = [25]
    other_config = moved / config_path.name
    other_config.write_text(json.dumps(config), encoding="utf-8")
    monkeypatch.setenv("QUARTO_MARIMO_CACHE_CONFIG", str(other_config))
    output = tmp_path / "second"
    assert run(moved / "page.qmd", output, events) == expected
    assert events == ["executed"]
    assert (output / "public/cache/value.bin").read_bytes() == b"computed"
    assert json.loads((output / "diagnostics.json").read_text())["lines"] == [25]


@pytest.mark.parametrize(
    "change", ["dependency", "context", "identity", "force", "corrupt", "missing"]
)
def test_cache_invalidates_changed_or_damaged_inputs(cached, tmp_path, change):
    source, dependency, config_path, config = cached
    events = []
    run(source, tmp_path / "first", events)
    identity = "cells-1"
    if change == "dependency":
        dependency.write_text("value = 2", encoding="utf-8")
    elif change == "context":
        config["pages"]["page.qmd"]["context"] = "environment-2"
    elif change == "identity":
        identity = "cells-2"
    elif change == "force":
        config["force"] = True
    else:
        blob = next((tmp_path / "cache").glob("*/resources/public/cache/value.bin"))
        if change == "corrupt":
            blob.write_bytes(b"corrupt")
        else:
            blob.unlink()
    config_path.write_text(json.dumps(config), encoding="utf-8")
    run(source, tmp_path / "second", events, identity=identity)
    assert events == ["executed", "executed"]


def test_error_results_are_returned_but_never_reused(cached, tmp_path):
    source, *_ = cached
    events = []
    for index in range(2):
        result = run(source, tmp_path / str(index), events, error=True)
        assert (
            result["cells"][0]["output"]["mimetype"] == "application/vnd.marimo+error"
        )
    assert len(events) == 2
    assert not list((tmp_path / "cache").glob("*/page.json"))


def test_dependency_change_during_execution_is_not_published(cached, tmp_path):
    source, dependency, *_ = cached
    with pytest.raises(RuntimeError, match="changed during execution"):
        run(
            source,
            tmp_path / "output",
            [],
            change=lambda: dependency.write_text("new", encoding="utf-8"),
        )
    assert not list((tmp_path / "cache").glob("*/page.json"))


def test_concurrent_requests_share_one_successful_execution(cached, tmp_path):
    source, *_ = cached
    events = []
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(lambda index: run(source, tmp_path / str(index), events), range(2))
        )
    assert results[0] == results[1]
    assert events == ["executed"]
