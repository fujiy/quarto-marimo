"""Subprocess entry point for the Quarto marimo engine."""

from __future__ import annotations

import asyncio
import importlib
import json
import os
import sys
from collections.abc import Callable
from contextlib import redirect_stdout
from pathlib import Path
from typing import Any, ClassVar, cast
from xml.etree.ElementTree import Element

from marimo._convert.markdown.to_ir import (
    MarimoMdParser,
    SafeWrap as SafeWrapGeneric,
)

from quarto_marimo.authoring import normalize_markdown
from quarto_marimo.compiler import (
    cache_cells_enabled,
    compile_page,
    generator_from_ir,
    page_request,
    to_marimo_ir,
)
from quarto_marimo.document import collect_page
from quarto_marimo.execution_cache import cached_page
from quarto_marimo.protocol import CompiledMarimoPage
from quarto_marimo.runtime_assets import ensure_runtime_assets
from quarto_marimo.static import render_static_page

ConversionResult = dict[str, Any]
SafeWrap = SafeWrapGeneric[ConversionResult]
ExportCallback = Callable[[Element], SafeWrap]


def convert_markdown(
    text: str,
    *,
    filename: str,
    interactive: bool,
    global_eval: bool = True,
    cache_output_dir: Path | None = None,
    extension_dir: Path | None = None,
    identity_only: bool = False,
    describe_only: bool = False,
) -> dict[str, Any]:
    """Collect a page identity or compile its outputs using the same parser.

    ``identity_only`` returns only ``identity`` and never executes cells or
    prepares runtime assets. Prose and source positions do not affect identity.
    """

    def identity_export(root: Element) -> SafeWrap:
        request = collect_page(root, filename=filename, global_eval=global_eval)
        if describe_only:
            from quarto_marimo.dependencies import source_dependencies

            planned = page_request(request.to_json())
            generator = generator_from_ir(to_marimo_ir(planned), planned)
            return SafeWrap(
                {
                    "identity": request.identity,
                    "dependencies": source_dependencies(generator._app.to_py()),
                }
            )
        return SafeWrap({"identity": request.identity})

    callback: ExportCallback
    if identity_only or describe_only:
        callback = identity_export
    elif interactive:
        callback = interactive_export(
            filename=filename,
            global_eval=global_eval,
            cache_output_dir=cache_output_dir,
            extension_dir=extension_dir,
        )
    else:
        callback = static_export(filename=filename, global_eval=global_eval)

    class QuartoMarimoParser(MarimoMdParser):
        output_formats: ClassVar[dict[str, ExportCallback]] = {  # type: ignore[assignment, misc]
            "quarto-marimo": callback,
        }

    parser = QuartoMarimoParser(output_format="quarto-marimo")  # type: ignore[arg-type]
    return cast(ConversionResult, parser.convert(normalize_markdown(text)))


def interactive_export(
    *,
    filename: str,
    global_eval: bool,
    cache_output_dir: Path | None = None,
    extension_dir: Path | None = None,
) -> ExportCallback:
    def export(root: Element) -> SafeWrap:
        request = collect_page(
            root,
            filename=filename,
            global_eval=global_eval,
        )
        pyproject = request.metadata.pyproject
        cache_enabled = cache_cells_enabled(pyproject)
        if cache_enabled:
            if os.environ.get("QUARTO_MARIMO_DEBUG_ENDPOINT"):
                raise RuntimeError(
                    "cache hydration cannot use QUARTO_MARIMO_DEBUG_ENDPOINT"
                )
            if cache_output_dir is None:
                raise RuntimeError(
                    "cache_cells=true requires a Quarto page resource directory"
                )
            if extension_dir is None:
                raise RuntimeError("Quarto extension directory is unavailable")
            ensure_runtime_assets(
                extension_dir,
                version_override=os.environ.get("QUARTO_MARIMO_VERSION"),
            )
        payload = request.to_json()
        if cache_output_dir is not None:
            payload["cacheOutputDirectory"] = str(cache_output_dir)

        def execute() -> dict[str, Any]:
            return asyncio.run(
                compile_page(
                    payload,
                    development_url=os.environ.get("QUARTO_MARIMO_DEBUG_ENDPOINT"),
                    version_override=os.environ.get("QUARTO_MARIMO_VERSION"),
                )
            )

        def dependency_code() -> str:
            planned = page_request(request.to_json())
            return generator_from_ir(to_marimo_ir(planned), planned)._app.to_py()

        host = os.environ.get("QUARTO_MARIMO_EXECUTION_HOST")
        if host:
            module, function = host.split(":", 1)
            page = getattr(importlib.import_module(module), function)(payload)
        else:
            page = cached_page(
                filename, request.identity, dependency_code, cache_output_dir, execute
            )
        compiled_page = CompiledMarimoPage.from_json(page)
        return SafeWrap(
            {
                "kind": "page",
                "page": page,
                "cacheHydration": cache_enabled,
                "buildOutputs": render_static_page(request, compiled_page),
            }
        )

    return export


def static_export(
    *,
    filename: str,
    global_eval: bool,
) -> ExportCallback:
    def export(root: Element) -> SafeWrap:
        request = collect_page(
            root,
            filename=filename,
            global_eval=global_eval,
        )
        page = CompiledMarimoPage.from_json(
            asyncio.run(compile_page(request.to_json()))
        )
        return SafeWrap(
            {
                "kind": "static",
                "outputs": render_static_page(request, page),
            }
        )

    return export


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if args == ["--prepare-runtime"]:
        ensure_runtime_assets(
            Path(__file__).resolve().parents[2],
            version_override=os.environ.get("QUARTO_MARIMO_VERSION"),
        )
        return 0
    if len(args) not in (2, 3, 4):
        raise ValueError(
            "expected reference file, output mode, optional eval mode, "
            "and optional page resource directory"
        )
    reference_file, output_mode = args[:2]
    global_eval = args[2].lower() == "yes" if len(args) >= 3 else True
    resource_dir = Path(args[3]) if len(args) == 4 else None
    interactive = output_mode.lower() == "html"
    os.environ["MARIMO_NO_JS"] = str(not interactive).lower()

    # The engine always sends UTF-8 bytes. Bypass the locale-dependent text
    # wrappers so a cp932 or similar host locale cannot corrupt the document.
    source = sys.stdin.buffer.read().decode("utf-8")
    if not source:
        source = Path(reference_file).read_text(encoding="utf-8")
    with redirect_stdout(sys.stderr):
        result = convert_markdown(
            source,
            filename=reference_file,
            interactive=interactive,
            global_eval=global_eval,
            cache_output_dir=resource_dir if interactive else None,
            extension_dir=(
                Path(__file__).resolve().parents[2]
                if resource_dir is not None and interactive
                else None
            ),
            identity_only=output_mode.lower() == "identity",
            describe_only=output_mode.lower() == "describe",
        )
    sys.stdout.buffer.write(json.dumps(result).encode("utf-8"))
    sys.stdout.flush()
    return 0
