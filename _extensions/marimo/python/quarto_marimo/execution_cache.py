"""Optional host-neutral persistent cache at the compiler execution boundary."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator

from quarto_marimo.dependencies import source_dependencies


def _files(root: Path) -> dict[str, str]:
    return {
        p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file() and p.name != ".integrity.json"
    }


def _input_digest(paths: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in sorted(set(paths)):
        digest.update(str(path).encode())
        digest.update(b"\0")
        digest.update(path.read_bytes() if path.is_file() else b"<missing>")
    return digest.hexdigest()


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", dir=path.parent, delete=False, encoding="utf-8"
    ) as stream:
        temporary = Path(stream.name)
        json.dump(value, stream)
    temporary.replace(path)


@contextmanager
def _lock(path: Path) -> Iterator[None]:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as stream:
        if sys.platform == "win32":
            import msvcrt

            if stream.tell() == 0:
                stream.write(b"0")
                stream.flush()
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl

            fcntl.flock(stream, fcntl.LOCK_EX)
        try:
            yield
        finally:
            if sys.platform == "win32":
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream, fcntl.LOCK_UN)


def _has_errors(page: dict[str, Any]) -> bool:
    return any(
        (cell.get("output") or {}).get("mimetype")
        in {"application/vnd.marimo+error", "application/vnd.marimo+traceback"}
        for cell in page["cells"]
    )


def cached_page(
    filename: str,
    identity: str,
    dependency_code: Callable[[], str],
    resources: Path | None,
    compile_page: Callable[[], dict[str, Any]],
) -> dict[str, Any]:
    """Execute only on misses; restore verified page payload and owned resources.

    The opt-in JSON configuration maps project-relative inputs to stable page
    namespaces, context strings, non-Python inputs, and dependency record paths.
    The host versions installed packages and execution context. Compiler source,
    interpreter, and runtime overrides are included here. Error payloads are
    returned for diagnostics but never published as successful cache entries.
    Configuration is outside the notebook protocol and requires no host imports.
    """
    configured = os.environ.get("QUARTO_MARIMO_CACHE_CONFIG")
    if not configured or resources is None:
        return compile_page()
    config_path = Path(configured).resolve()
    config = json.loads(config_path.read_text())
    relative = Path(filename).resolve().relative_to(config_path.parent).as_posix()
    options = config["pages"].get(relative)
    if options is None:
        return compile_page()
    os.environ["QUARTO_MARIMO_SOURCE_ROOTS"] = os.pathsep.join(config["source_roots"])
    dependencies = source_dependencies(dependency_code())
    files = dependencies["files"]
    if not isinstance(files, list):
        raise TypeError("Dependency files must be a list")
    inputs = [Path(p) for p in [*files, *options.get("inputs", [])]]
    before = _input_digest(inputs)
    compiler_identity = hashlib.sha256(
        b"".join(
            p.name.encode() + b"\0" + p.read_bytes()
            for p in sorted(Path(__file__).parent.glob("*.py"))
        )
    ).hexdigest()
    key = hashlib.sha256(
        json.dumps(
            [
                options["namespace"],
                options["context"],
                identity,
                before,
                compiler_identity,
                sys.version,
                sys.platform,
                os.environ.get("QUARTO_MARIMO_VERSION"),
                os.environ.get("QUARTO_MARIMO_DEBUG_ENDPOINT"),
            ],
            sort_keys=True,
        ).encode()
    ).hexdigest()
    cache = Path(config["cache_dir"])
    entry = cache / key
    with _lock(cache / "locks" / (key + ".lock")):
        page = None
        if not config.get("force"):
            try:
                integrity = json.loads((entry / ".integrity.json").read_text())
                if (
                    (entry / "resources").is_dir()
                    and integrity
                    and integrity == _files(entry)
                ):
                    candidate = json.loads((entry / "page.json").read_text())
                    if not _has_errors(candidate):
                        page = candidate
            except (OSError, ValueError, KeyError, TypeError, AttributeError):
                pass
        shutil.rmtree(resources, ignore_errors=True)
        if page is not None:
            shutil.copytree(entry / "resources", resources)
            sys.stderr.write(f"marimo: execution reused ({options['namespace']})\n")
            sys.stderr.flush()
        else:
            resources.mkdir(parents=True, exist_ok=True)
            sys.stderr.write(f"marimo: executing ({options['namespace']})\n")
            sys.stderr.flush()
            page = compile_page()
            if before != _input_digest(inputs):
                raise RuntimeError(
                    "marimo dependencies changed during execution; rebuild required"
                )
            if not _has_errors(page):
                with tempfile.TemporaryDirectory(prefix="publish-", dir=cache) as temp:
                    snapshot = Path(temp) / "entry"
                    shutil.copytree(resources, snapshot / "resources")
                    (snapshot / "page.json").write_text(json.dumps(page))
                    (snapshot / ".integrity.json").write_text(
                        json.dumps(_files(snapshot))
                    )
                    shutil.rmtree(entry, ignore_errors=True)
                    snapshot.rename(entry)
        if before != _input_digest(inputs):
            raise RuntimeError(
                "marimo dependencies changed during cache restore; rebuild required"
            )
        _write_json(Path(options["dependencies_file"]), dependencies)
        _write_json(resources / "diagnostics.json", {"lines": options.get("lines", [])})
        _write_json(
            resources / "compiler-resources.json",
            {
                "cache_files": [
                    p.relative_to(resources).as_posix()
                    for p in (resources / "public/cache").rglob("*")
                    if p.is_file()
                ]
            },
        )
        return page
