from __future__ import annotations

import sys

from quarto_marimo.dependencies import source_dependencies


def test_local_transitive_dependencies_exclude_unrelated_sources(tmp_path, monkeypatch):
    root = tmp_path / "src"
    package = root / "dependency_probe"
    package.mkdir(parents=True)
    (package / "__init__.py").write_text("")
    direct = package / "direct.py"
    direct.write_text("from dependency_probe import child\nvalue = child.value\n")
    child = package / "child.py"
    child.write_text("value = 7\n")
    unused = package / "unused.py"
    unused.write_text("value = 8\n")
    monkeypatch.setenv("QUARTO_MARIMO_SOURCE_ROOTS", str(root))
    before = list(sys.path)
    result = source_dependencies("import dependency_probe.direct\n")
    assert result["complete"]
    assert isinstance(result["files"], list)
    assert str(direct) in result["files"]
    assert str(child) in result["files"]
    assert str(unused) not in result["files"]
    assert sys.path == before
    dynamic = source_dependencies(
        "import importlib\nimportlib.import_module('dependency_probe.child')\n"
    )
    assert not dynamic["complete"]
    assert isinstance(dynamic["files"], list)
    assert str(unused) in dynamic["files"]
    direct.write_text("invalid python !\n")
    fallback = source_dependencies("import dependency_probe.direct\n")
    assert not fallback["complete"]
    assert isinstance(fallback["files"], list)
    assert str(unused) in fallback["files"]
    direct.write_text("from . import child\nvalue = child.value\n")
    child.write_text("invalid python !\n")
    relative = source_dependencies("import dependency_probe.direct\n")
    assert not relative["complete"]
