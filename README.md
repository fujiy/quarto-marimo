<p align="center">
  <a href="https://marimo-team.github.io/quarto-marimo/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://marimo-team.github.io/quarto-marimo/assets/quarto-marimo-lockup-stacked-dark.svg">
      <img alt="quarto-marimo" src="https://marimo-team.github.io/quarto-marimo/assets/quarto-marimo-lockup-stacked-light.svg" width="320">
    </picture>
  </a>
</p>

<p align="center"><strong>Make Quarto documents reactive with marimo.</strong></p>

[Quarto](https://quarto.org/) turns Markdown into websites, books,
presentations, and other publication formats. `quarto-marimo` adds reactive
Python, SQL, and Markdown cells to those publications.

The extension compiles each document's `.marimo` cells into one marimo app.
Quarto places each result at its authored position and publishes the surrounding
document.

Requires Quarto 1.9.20 or newer, Python 3.10 or newer, and marimo 0.25.0.

## Quick start

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) and
[Quarto](https://quarto.org/docs/get-started/), then add the extension:

```bash
quarto add marimo-team/quarto-marimo
```

Create `index.qmd`:

````markdown
---
title: Reactive Quarto page
engine: marimo
format: html
---

```python {.marimo}
import marimo as mo

slider = mo.ui.slider(1, 10, 1, label="Items")
slider
```

The next cell reacts to the same shared app:

```python {.marimo}
mo.md(f"The slider is set to **{slider.value}**.")
```
````

Preview the document:

```bash
quarto preview
```

HTML output remains interactive in the browser. Formats such as PDF receive the
server-rendered cell output.

## Cell options

Use Quarto `#|` options at the start of a marimo cell:

Both `python {.marimo}` and `{python .marimo}` fence forms are supported.

````markdown
```python {.marimo}
#| echo: true
#| output: true

value = 2
value
```
````

| Option          | Default | Behavior                                           |
| --------------- | ------- | -------------------------------------------------- |
| `eval`          | `true`  | Execute the cell                                   |
| `echo`          | `false` | Render the authored source                         |
| `output`        | `true`  | Render the cell output                             |
| `server-output` | `true`  | Include build-time output before browser hydration |
| `error`         | `true`  | Render execution errors. `false` stops the build   |
| `include`       | `true`  | Include the cell in the document                   |
| `editor`        | `false` | Render the marimo editor for the Python cell       |
| `hide-code`     | `false` | Hide source and the editor                         |
| `hide-output`   | `false` | Hide rendered output                               |
| `disabled`      | `false` | Disable the cell and its dependents                |
| `unparsable`    | `false` | Preserve source as a non-reactive cell             |
| `name`          | `_`     | Set the marimo cell name                           |
| `column`        | none    | Set the marimo layout column                       |
| `context`       | `runtime` | Use `render` to project build output through Pandoc only |

The default `context: runtime` includes the cell in the browser notebook; it may
be omitted. `context: render` executes the cell only during Quarto rendering,
passes its output to Pandoc, and disables that cell in the browser notebook.
This is useful for numbered equations and cross references that Quarto must
process. A render-only cell must not define values needed by browser-executed
cells. Unknown context names are errors.

SQL cells use the same `.marimo` class:

````markdown
```{sql .marimo}
#| echo: true
#| query: result

SELECT 1 AS value
```
````

SQL cells also accept `query` and `engine`. Use `{markdown .marimo}` when a
Markdown cell should join the page app.

## Python environment

Set `pyproject` in the document YAML to declare browser and build dependencies:

```yaml
pyproject: |
  requires-python = ">=3.10"
  dependencies = ["pandas"]
```

Set `external-env: true` to execute with the active Python environment during
the Quarto build. Set `QUARTO_PYTHON` to choose its Python executable. It
defaults to `python` on `PATH`.

Set `header` to Python source that runs as a setup cell before the authored
cells:

```yaml
header: |
  import polars as pl
```

To reuse build-time results in the browser, enable marimo's native cell cache:

```yaml
pyproject: |
  requires-python = ">=3.10"
  dependencies = ["numpy"]
  [tool.marimo.runtime]
  cache_cells = true
```

Quarto executes the cells in the build environment and writes marimo's cache
under `<page>_files/public/cache/`. The browser restores cached values and runs
cells invalidated by later UI changes. If a cached value is unavailable,
marimo follows its normal cache-miss behavior, including surfacing execution
errors. Cache hydration is pinned to marimo 0.25.0; `QUARTO_MARIMO_VERSION`
cannot select a different runtime for a cached page.
The first cache-enabled render fetches the pinned official islands tarball from
npm, verifies its integrity, and reuses the download from the XDG cache later.

Unserializable cell outputs (including UI form output) are excluded from exported
cache lookups so the browser recreates them instead of displaying a marimo stub.
Serializable calculation results retain their normal cache reuse.
The pinned runtime also guards Plotly's asynchronous rendering lifecycle: pending
renders finish before a plot is purged, and obsolete queued renders are skipped.
The host adapter provides marimo's iframe resizing hook and reuses the host
MathJax script to avoid loading incompatible major versions into one document.

`QUARTO_MARIMO_VERSION` selects the marimo runtime version embedded in HTML
output when cache hydration is disabled. Cache hydration uses the matching
official runtime distribution bundled by the extension.

## Upgrading from 0.4

Replace the Lua filter configuration with the engine:

```yaml
engine: marimo
```

Remove `filters: marimo-team/marimo` from the document or project YAML.

## Development

Build the browser adapter and Quarto engine:

```bash
make build
```

Run the checks:

```bash
make lint
make test
make render
```

The browser cache integration test is opt-in. Build and render
`tests/fixtures/cache-hydration` with this checkout's extension and a Python
environment containing marimo 0.25.0 and NumPy. Set `QUARTO_PYTHON` to that
interpreter for the render, then run:

```bash
CHROME_BIN=/path/to/chrome \
QUARTO_MARIMO_TEST_SITE_DIR=/path/to/cache-hydration/_site \
make test-browser
```
