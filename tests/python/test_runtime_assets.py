from __future__ import annotations

import base64
import hashlib
import io
import json
import re
import tarfile
import urllib.request
from pathlib import Path

import pytest
from quarto_marimo.runtime_assets import (
    _verify_tarball,
    apply_cache_worker_patch,
    apply_worker_patch,
    ensure_runtime_assets,
)


def manifest(source: str, worker: str = "userConfig:Ls()") -> dict[str, object]:
    return {
        "package": "@marimo-team/islands",
        "version": "0.25.0",
        "mainSha256": hashlib.sha256(source.encode()).hexdigest(),
        "expectedWorkerFactory": "blob-worker-factory",
        "patchedWorkerFactory": "url-worker-factory",
        "expectedReplacementCount": 1,
        "workerPattern": r"/assets/worker-[A-Za-z0-9_-]+\.js",
        "workerSha256": hashlib.sha256(worker.encode()).hexdigest(),
        "expectedCacheConfig": "userConfig:Ls()",
        "patchedCacheConfig": "userConfig:cache-enabled",
    }


def test_worker_patch_changes_only_the_guarded_factory():
    source = 'blob-worker-factory; worker_default = "/assets/worker-a_B-1.js";'

    patched = apply_worker_patch(source, manifest(source))

    assert patched == 'url-worker-factory; worker_default = "/assets/worker-a_B-1.js";'


def test_worker_patch_rejects_a_changed_bundle_hash():
    with pytest.raises(RuntimeError, match=re.escape("main.js hash")):
        apply_worker_patch("different bundle", manifest("original bundle"))


def test_cache_worker_patch_enables_cache_cells_with_a_guarded_hash():
    worker = "start({userConfig:Ls()})"

    patched = apply_cache_worker_patch(worker, manifest("main", worker))

    assert patched == "start({userConfig:cache-enabled})"


def test_cache_worker_patch_rejects_a_changed_bundle_hash():
    with pytest.raises(RuntimeError, match=re.escape("worker hash")):
        apply_cache_worker_patch("different", manifest("main", "original"))


def test_worker_patch_rejects_ambiguous_replacement_targets():
    source = 'blob-worker-factory; blob-worker-factory; worker_default = "/assets/worker-a.js";'
    settings = manifest(source)

    with pytest.raises(RuntimeError, match="found 2"):
        apply_worker_patch(source, settings)


def test_npm_tarball_integrity_rejects_unexpected_bytes():
    with pytest.raises(RuntimeError, match="integrity verification"):
        _verify_tarball(b"tampered", "sha512-dGFtcGVyZWQ=")


def test_worker_patch_rejects_a_missing_official_worker_asset():
    source = "blob-worker-factory"

    with pytest.raises(RuntimeError, match="found 0"):
        apply_worker_patch(source, manifest(source))


def test_worker_patch_creates_a_normal_url_worker_entry():
    settings = json.loads(
        (
            Path(__file__).parents[2] / "_extensions" / "marimo" / "runtime-patch.json"
        ).read_text(encoding="utf-8")
    )

    assert (
        "new Worker(new URL(workerEntry, pageUrl)" in settings["patchedWorkerFactory"]
    )
    assert "new Blob" not in settings["patchedWorkerFactory"]


def test_cache_runtime_rejects_a_different_runtime_override():
    extension_dir = Path(__file__).parents[2] / "_extensions" / "marimo"

    with pytest.raises(RuntimeError, match="QUARTO_MARIMO_VERSION is 0.23.17"):
        ensure_runtime_assets(extension_dir, version_override="0.23.17")


def test_ensure_runtime_assets_verifies_and_installs_official_distribution(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    source = 'blob-worker-factory; worker_default = "/assets/worker-a.js";'
    style = "/* official style */"
    worker = "start({userConfig:Ls()})"
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode="w:gz") as tar:
        for name, content in (
            ("package/dist/main.js", source),
            ("package/dist/style.css", style),
            ("package/dist/assets/worker-a.js", worker),
        ):
            data = content.encode("utf-8")
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    archive_bytes = archive.getvalue()
    integrity = "sha512-" + base64.b64encode(
        hashlib.sha512(archive_bytes).digest()
    ).decode("ascii")
    settings = manifest(source, worker)
    settings.update(
        {
            "tarball": "https://registry.npmjs.org/test.tgz",
            "integrity": integrity,
            "mainFile": "main.js",
            "styleFile": "style.css",
        }
    )
    extension_dir = tmp_path / "_extensions" / "marimo"
    extension_dir.mkdir(parents=True)
    (extension_dir / "runtime-patch.json").write_text(
        json.dumps(settings), encoding="utf-8"
    )
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path / "cache"))

    calls = 0

    def open_archive(_request: urllib.request.Request, timeout: float) -> io.BytesIO:
        nonlocal calls
        assert timeout == 90
        calls += 1
        return io.BytesIO(archive_bytes)

    monkeypatch.setattr(urllib.request, "urlopen", open_archive)

    installed = ensure_runtime_assets(extension_dir)
    patched = installed.main_file.read_text(encoding="utf-8")
    repeated = ensure_runtime_assets(extension_dir)

    assert calls == 1
    assert installed == repeated
    assert patched.startswith("url-worker-factory")
    assert installed.style_file.read_text(encoding="utf-8") == style
    assert (
        installed.worker_file.read_text(encoding="utf-8")
        == "start({userConfig:cache-enabled})"
    )


def test_mathjax_loader_reuses_host_choice_with_guarded_replacement():
    source = 'blob-worker-factory; "/assets/worker-a.js"; PA("mathjax3")'
    settings = manifest(source)
    settings.update(expectedMathJaxLoader='PA("mathjax3")', patchedMathJaxLoader='PA(window.hostMath || "mathjax3")')
    assert 'PA(window.hostMath || "mathjax3")' in apply_worker_patch(source, settings)
    settings['expectedMathJaxLoader'] = 'missing'
    with pytest.raises(RuntimeError, match='MathJax loader'):
        apply_worker_patch(source, settings)


def test_plot_patch_rejects_changed_runtime_and_ambiguous_targets():
    from quarto_marimo.runtime_assets import apply_plot_patch

    source = "render(); purge();"
    settings = {
        "plotSha256": hashlib.sha256(source.encode()).hexdigest(),
        "plotReplacements": [{"expected": "purge();", "replacement": "deferPurge();"}],
    }
    assert apply_plot_patch(source, settings) == "render(); deferPurge();"
    with pytest.raises(RuntimeError, match="Plot bundle hash"):
        apply_plot_patch("different", settings)
    settings["plotReplacements"] = [{"expected": "missing", "replacement": "new"}]
    with pytest.raises(RuntimeError, match="Plot lifecycle patch target"):
        apply_plot_patch(source, settings)
