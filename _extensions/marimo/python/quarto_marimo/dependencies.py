"""Discover local Python source dependencies with marimo's module finder."""

from __future__ import annotations

import ast
import importlib.metadata
import os
import sys
import tempfile
from pathlib import Path
from types import ModuleType

from marimo._runtime.reload.autoreload import ModuleDependencyFinder


def source_dependencies(code: str) -> dict[str, object]:
    """Return local source files, conservatively falling back on analysis failure.

    Source roots are supplied by the host. Installed distributions and the
    standard library are versioned by the host's environment fingerprint.
    Dynamic imports fall back to all local sources. Non-Python data remain
    the host's responsibility.
    """
    roots = [
        Path(p).resolve()
        for p in os.environ.get("QUARTO_MARIMO_SOURCE_ROOTS", "").split(os.pathsep)
        if p
    ]
    if not roots:
        return {"files": [], "complete": False}
    local_names = {
        p.stem
        for root in roots
        if root.is_dir()
        for p in root.iterdir()
        if p.is_dir() or p.suffix == ".py"
    }
    excludes = (
        set(sys.stdlib_module_names) | set(importlib.metadata.packages_distributions())
    ) - local_names
    with tempfile.TemporaryDirectory(prefix="marimo-dependencies-") as directory:
        path = Path(directory) / "notebook.py"
        path.write_text(code, encoding="utf-8")
        module = ModuleType("_quarto_dependency_probe")
        module.__file__ = str(path)
        finder = ModuleDependencyFinder()
        previous = sys.path[:]
        try:
            sys.path[:0] = [str(root) for root in roots]
            modules = finder.find_dependencies(module, excludes)
        finally:
            sys.path[:] = previous
        complete = finder.cached(module)
        files = {
            str(Path(file).resolve())
            for found in modules.values()
            if (file := getattr(found, "__file__", None))
            and any(Path(file).resolve().is_relative_to(root) for root in roots)
            and Path(file).suffix == ".py"
        }
    # ModuleFinder may suppress an import failure while marking its own run
    # successful. Validate local import targets and reject dynamic discovery.
    try:
        for source, filename in [
            (code, None),
            *((Path(file).read_text(encoding="utf-8"), Path(file)) for file in files),
        ]:
            for node in ast.walk(ast.parse(source)):
                names: list[str] = []
                if isinstance(node, ast.Import):
                    names = [alias.name for alias in node.names]
                elif isinstance(node, ast.ImportFrom):
                    module_name = node.module or ""
                    if node.level:
                        if filename is None:
                            complete = False
                            continue
                        root = next(
                            root for root in roots if filename.is_relative_to(root)
                        )
                        package = filename.relative_to(root).parts[:-1]
                        prefix = package[: len(package) - node.level + 1]
                        module_name = ".".join(
                            (*prefix, *module_name.split("."))
                        ).rstrip(".")
                    names = [
                        module_name,
                        *(f"{module_name}.{alias.name}" for alias in node.names),
                    ]
                elif (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Name)
                    and node.func.id in {"__import__", "exec", "eval"}
                ):
                    complete = False
                for name in names:
                    if name.split(".")[0] in {"importlib", "pkgutil", "runpy"}:
                        complete = False
                    for root in roots:
                        target = root.joinpath(*name.split("."))
                        for candidate in (
                            target.with_suffix(".py"),
                            target / "__init__.py",
                        ):
                            if (
                                candidate.is_file()
                                and str(candidate.resolve()) not in files
                            ):
                                complete = False
    except (SyntaxError, OSError, UnicodeError):
        complete = False
    if not complete:
        files.update(
            str(p.resolve())
            for root in roots
            for p in root.rglob("*.py")
            if "__pycache__" not in p.parts
        )
    return {"files": sorted(files), "complete": complete}
