"""Stage the pinned official islands distribution with a guarded Worker patch."""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import shutil
import tarfile
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any


@dataclass(frozen=True)
class RuntimeAssets:
    version: str
    distribution_dir: Path
    main_file: Path
    style_file: Path
    worker_file: Path


def manifest_path(extension_dir: Path) -> Path:
    return extension_dir / "runtime-patch.json"


def load_manifest(extension_dir: Path) -> dict[str, Any]:
    manifest = json.loads(manifest_path(extension_dir).read_text(encoding="utf-8"))
    required = {
        "package",
        "version",
        "tarball",
        "integrity",
        "mainFile",
        "mainSha256",
        "styleFile",
        "workerPattern",
        "workerSha256",
        "expectedReplacementCount",
        "expectedWorkerFactory",
        "patchedWorkerFactory",
        "expectedCacheConfig",
        "patchedCacheConfig",
    }
    if not isinstance(manifest, dict) or required - manifest.keys():
        raise RuntimeError("islands runtime patch manifest is incomplete")
    return manifest


def apply_worker_patch(main_source: str, manifest: dict[str, Any]) -> str:
    actual_hash = hashlib.sha256(main_source.encode("utf-8")).hexdigest()
    if actual_hash != manifest["mainSha256"]:
        raise RuntimeError(
            f"unsupported {manifest['package']}@{manifest['version']} main.js hash"
        )

    expected = manifest["expectedWorkerFactory"]
    if not isinstance(expected, str) or not expected:
        raise RuntimeError("islands Worker patch target is empty")
    count = main_source.count(expected)
    if count != manifest["expectedReplacementCount"]:
        raise RuntimeError(
            f"expected one Worker factory in islands main.js, found {count}"
        )
    worker_matches = _worker_matches(main_source, manifest)
    if len(worker_matches) != 1:
        raise RuntimeError(
            f"expected one official Worker asset in islands main.js, found {len(worker_matches)}"
        )

    patched = main_source.replace(expected, manifest["patchedWorkerFactory"])
    if expected in patched or patched == main_source:
        raise RuntimeError("islands Worker patch did not change main.js")
    if "expectedMathJaxLoader" in manifest:
        target = manifest["expectedMathJaxLoader"]
        if patched.count(target) != 1:
            raise RuntimeError("expected one MathJax loader in islands main.js")
        patched = patched.replace(target, manifest["patchedMathJaxLoader"])
    return patched


def apply_cache_worker_patch(worker_source: str, manifest: dict[str, Any]) -> str:
    """Enable cell-cache reads in the cache-only browser Worker bundle."""
    actual_hash = hashlib.sha256(worker_source.encode("utf-8")).hexdigest()
    if actual_hash != manifest["workerSha256"]:
        raise RuntimeError(
            f"unsupported {manifest['package']}@{manifest['version']} worker hash"
        )

    expected = manifest["expectedCacheConfig"]
    if not isinstance(expected, str) or not expected:
        raise RuntimeError("islands Worker cache config patch target is empty")
    count = worker_source.count(expected)
    if count != 1:
        raise RuntimeError(
            f"expected one Worker cache config target, found {count}"
        )
    patched = worker_source.replace(expected, manifest["patchedCacheConfig"])
    if expected in patched or patched == worker_source:
        raise RuntimeError("islands Worker cache config patch did not change worker")
    return patched


def apply_plot_patch(source: str, manifest: dict[str, Any]) -> str:
    """Serialize Plotly rendering and defer purge until pending rendering ends.

    Hydration can replace a plot while its asynchronous MathJax layout is still
    running. The upstream component purges immediately, invalidating that layout.
    """
    if hashlib.sha256(source.encode()).hexdigest() != manifest["plotSha256"]:
        raise RuntimeError("unsupported islands Plot bundle hash")
    for patch in manifest["plotReplacements"]:
        if source.count(patch["expected"]) != 1:
            raise RuntimeError("expected one Plot lifecycle patch target")
        source = source.replace(patch["expected"], patch["replacement"])
    return source


def ensure_runtime_assets(
    extension_dir: Path,
    *,
    version_override: str | None = None,
) -> RuntimeAssets:
    """Download, verify, patch, and cache one exact official islands release."""
    manifest = load_manifest(extension_dir)
    version = str(manifest["version"])
    if version_override is not None and version_override != version:
        raise RuntimeError(
            f"cache hydration supports marimo {version}; "
            f"QUARTO_MARIMO_VERSION is {version_override}"
        )
    import marimo

    installed_version = getattr(marimo, "__version__", None)
    if installed_version != version:
        raise RuntimeError(
            f"cache hydration supports marimo {version}; found {installed_version}"
        )
    cache_dir = _verified_package_cache(manifest)
    distribution_dir = (
        extension_dir / "assets" / "runtime" / "islands" / version / "dist"
    )
    marker = distribution_dir.parent / ".quarto-marimo-runtime.json"
    if marker.is_file():
        installed = json.loads(marker.read_text(encoding="utf-8"))
        if installed != _installed_marker(manifest):
            raise RuntimeError(
                f"cached islands runtime at {distribution_dir} does not match its manifest"
            )
    elif distribution_dir.exists() or marker.exists():
        raise RuntimeError(
            f"refusing to overwrite unmanaged runtime assets at {distribution_dir.parent}"
        )
    else:
        _install_runtime(cache_dir, marker, manifest)

    source_main = distribution_dir / str(manifest["mainFile"])
    worker_path = _worker_path(source_main.read_text(encoding="utf-8"), manifest)
    worker_file = distribution_dir / worker_path.lstrip("/")
    style_file = distribution_dir / str(manifest["styleFile"])
    if not worker_file.is_file() or not style_file.is_file():
        raise RuntimeError("official islands runtime is missing a referenced asset")
    return RuntimeAssets(
        version=version,
        distribution_dir=distribution_dir,
        main_file=source_main,
        style_file=style_file,
        worker_file=worker_file,
    )


def _verified_package_cache(manifest: dict[str, Any]) -> Path:
    cache_root = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    integrity_key = hashlib.sha256(
        str(manifest["integrity"]).encode("ascii")
    ).hexdigest()[:16]
    package_cache = (
        cache_root
        / "quarto-marimo"
        / "islands"
        / str(manifest["version"])
        / integrity_key
    )
    if package_cache.exists():
        _verify_package_cache(package_cache, manifest)
        return package_cache

    package_cache.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(
        tempfile.mkdtemp(prefix=f".{manifest['version']}-", dir=package_cache.parent)
    )
    try:
        request = urllib.request.Request(
            str(manifest["tarball"]),
            headers={"User-Agent": "quarto-marimo-runtime-installer"},
        )
        with urllib.request.urlopen(request, timeout=90) as response:
            archive_bytes = response.read()
        _verify_tarball(archive_bytes, str(manifest["integrity"]))
        _extract_distribution(archive_bytes, temporary)
        main_file = temporary / "package" / "dist" / str(manifest["mainFile"])
        _read_verified_main(main_file, manifest)
        (temporary / ".npm-integrity").write_text(
            str(manifest["integrity"]), encoding="ascii"
        )
        try:
            temporary.replace(package_cache)
        except OSError:
            # Concurrent page builds may install the same verified package.
            if not package_cache.is_dir():
                raise
            _verify_package_cache(package_cache, manifest)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    return package_cache


def _verify_package_cache(package_cache: Path, manifest: dict[str, Any]) -> None:
    marker = package_cache / ".npm-integrity"
    if (
        not marker.is_file()
        or marker.read_text(encoding="ascii").strip() != manifest["integrity"]
    ):
        raise RuntimeError(
            f"cached official islands package at {package_cache} is incomplete or mismatched"
        )
    main_file = package_cache / "package" / "dist" / str(manifest["mainFile"])
    if not main_file.is_file():
        raise RuntimeError("cached official islands package is missing main.js")
    _read_verified_main(main_file, manifest)


def _verify_tarball(archive: bytes, integrity: str) -> None:
    algorithm, expected = integrity.split("-", 1)
    if algorithm != "sha512":
        raise RuntimeError(f"unsupported npm integrity algorithm: {algorithm}")
    actual = base64.b64encode(hashlib.sha512(archive).digest()).decode("ascii")
    if actual != expected:
        raise RuntimeError("official islands npm tarball failed integrity verification")


def _extract_distribution(archive: bytes, destination: Path) -> None:
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        for member in tar.getmembers():
            name = PurePosixPath(member.name)
            if name.is_absolute() or ".." in name.parts:
                raise RuntimeError("official islands tarball contains an unsafe path")
            if name.parts[:2] != ("package", "dist"):
                continue
            if not member.isfile():
                if member.isdir():
                    (destination / Path(*name.parts)).mkdir(parents=True, exist_ok=True)
                    continue
                raise RuntimeError(
                    "official islands tarball contains a non-regular asset"
                )
            source = tar.extractfile(member)
            if source is None:
                raise RuntimeError("could not read official islands runtime asset")
            target = destination / Path(*name.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with source, target.open("wb") as output:
                shutil.copyfileobj(source, output)


def _read_verified_main(main_file: Path, manifest: dict[str, Any]) -> str:
    source = main_file.read_text(encoding="utf-8")
    actual = hashlib.sha256(source.encode("utf-8")).hexdigest()
    if actual != manifest["mainSha256"]:
        raise RuntimeError("official islands main.js did not match the pinned SHA-256")
    return source


def _install_runtime(
    package_cache: Path,
    marker: Path,
    manifest: dict[str, Any],
) -> None:
    destination = marker.parent
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(
        tempfile.mkdtemp(prefix=f".{manifest['version']}-", dir=destination.parent)
    )
    try:
        staged_dist = temporary / "dist"
        shutil.copytree(package_cache / "package" / "dist", staged_dist)
        main = staged_dist / str(manifest["mainFile"])
        source = _read_verified_main(main, manifest)
        main.write_text(apply_worker_patch(source, manifest), encoding="utf-8")
        worker = staged_dist / _worker_path(source, manifest).lstrip("/")
        worker.write_text(
            apply_cache_worker_patch(worker.read_text(encoding="utf-8"), manifest),
            encoding="utf-8",
        )
        if "plotFile" in manifest:
            plot = staged_dist / manifest["plotFile"]
            plot.write_text(
                apply_plot_patch(plot.read_text(encoding="utf-8"), manifest),
                encoding="utf-8",
            )
        (temporary / marker.name).write_text(
            json.dumps(_installed_marker(manifest), sort_keys=True), encoding="utf-8"
        )
        try:
            temporary.replace(destination)
        except OSError:
            if not (destination / marker.name).is_file():
                raise
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


def _installed_marker(manifest: dict[str, Any]) -> dict[str, str]:
    return {
        "patchSha256": hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest(),
        "package": str(manifest["package"]),
        "version": str(manifest["version"]),
        "integrity": str(manifest["integrity"]),
        "mainSha256": str(manifest["mainSha256"]),
        "workerSha256": str(manifest["workerSha256"]),
    }


def _worker_path(main_source: str, manifest: dict[str, Any]) -> str:
    matches = _worker_matches(main_source, manifest)
    if len(matches) != 1:
        raise RuntimeError(
            "patched islands main.js has no unique official Worker asset"
        )
    return matches[0]


def _worker_matches(main_source: str, manifest: dict[str, Any]) -> list[str]:
    pattern = manifest["workerPattern"]
    if not isinstance(pattern, str):
        raise TypeError("islands Worker asset pattern must be a string")
    return [match.group(0) for match in re.finditer(pattern, main_source)]
