/** Release Plotly listeners/canvases before replacing a saved view. */
export function disposeSnapshot(host: HTMLElement): void {
  const plotly = (window as unknown as { Plotly?: { purge: (node: Element) => void } }).Plotly;
  for (const node of host.querySelectorAll(".js-plotly-plot")) plotly?.purge(node);
}

/** Display saved HTML without a Python kernel. No execution or network policy. */
export async function displaySnapshot(
  host: HTMLElement,
  html: string,
  plotlyUrl: string,
): Promise<void> {
  disposeSnapshot(host);
  host.innerHTML = html;
  const value = (node: Element, name: string): unknown => {
    const text = node.getAttribute(`data-${name}`);
    return text === null ? undefined : JSON.parse(text);
  };
  // Layouts wrap already-rendered HTML in MIME nodes, including nested bundles.
  for (let node = host.querySelector("marimo-mime-renderer"); node;
    node = host.querySelector("marimo-mime-renderer")) {
    const mime = value(node, "mime");
    const data = value(node, "data");
    const rendered = mime === "application/vnd.marimo+mimebundle"
      ? (data as Record<string, unknown>)?.["text/html"]
      : data;
    const replacement = document.createElement("span");
    if (mime === "text/plain" && typeof rendered === "string") {
      replacement.textContent = rendered;
    } else if (
      ["text/html", "text/markdown", "application/vnd.marimo+mimebundle"].includes(String(mime)) &&
      typeof rendered === "string"
    ) {
      replacement.innerHTML = rendered;
    } else {
      throw new Error(`Unsupported saved MIME output: ${mime}`);
    }
    node.replaceWith(replacement);
  }
  // Composite controls keep their actual children in the exported HTML.
  for (
    const node of host.querySelectorAll(
      "marimo-form,marimo-dict,marimo-array,marimo-ui-element",
    )
  ) {
    node.replaceWith(...node.childNodes);
  }
  for (const node of host.querySelectorAll("marimo-matrix,marimo-table")) {
    const table = document.createElement("table");
    table.className = "table marimo-saved-table";
    let rows: unknown[][];
    if (node.tagName.toLowerCase() === "marimo-matrix") {
      rows = value(node, "initial-value") as unknown[][];
      const labels = value(node, "row-labels") as string[] | undefined;
      rows = rows.map((row, i) => [labels?.[i] ?? String(i + 1), ...row]);
    } else {
      let data = value(node, "data");
      if (typeof data === "string") data = JSON.parse(data);
      if (!Array.isArray(data)) {
        throw new Error("Saved table requires inline data");
      }
      const keys = Object.keys(data[0] ?? {});
      rows = [keys, ...data.map((row) => keys.map((key) => row[key]))];
      if (Number(value(node, "total-rows")) > data.length) {
        throw new Error(
          "Saved table is incomplete; export all rows before publishing",
        );
      }
    }
    for (const row of rows) {
      const tr = document.createElement("tr");
      for (const cell of row) {
        const td = document.createElement("td");
        td.textContent = String(cell ?? "");
        tr.append(td);
      }
      table.append(tr);
    }
    node.replaceWith(table);
  }
  for (const node of host.querySelectorAll("[data-initial-value]")) {
    const current = value(node, "initial-value");
    const label = value(node, "label");
    const readOnly = document.createElement("span");
    readOnly.className = "marimo-saved-value";
    if (typeof label === "string") {
      const heading = document.createElement("span");
      heading.innerHTML = label;
      readOnly.append(heading, ": ");
    }
    readOnly.append(
      typeof current === "string" ? current : JSON.stringify(current ?? ""),
    );
    node.replaceWith(readOnly);
  }
  for (const node of host.querySelectorAll("marimo-tex")) {
    const span = document.createElement("span");
    span.innerHTML = node.innerHTML.replaceAll("||(", "\\(").replaceAll(
      "||)",
      "\\)",
    )
      .replaceAll("||[", "\\[").replaceAll("||]", "\\]");
    node.replaceWith(span);
  }
  for (const node of host.querySelectorAll("marimo-plotly")) {
    const figure = value(node, "figure") as Record<string, unknown>;
    const config = value(node, "config") as Record<string, unknown>;
    const target = document.createElement("div");
    node.replaceWith(target);
    const plotly = await loadPlotly(plotlyUrl);
    await plotly.newPlot(target, figure.data, figure.layout, config);
    if (Array.isArray(figure.frames)) {
      await plotly.addFrames(target, figure.frames);
    }
  }
  const math = (window as unknown as {
    MathJax?: {
      Hub?: { Queue(...args: unknown[]): void };
      typesetPromise?: (nodes: Element[]) => Promise<void>;
    };
  }).MathJax;
  if (math?.Hub) math.Hub.Queue(["Typeset", math.Hub, host]);
  else if (math?.typesetPromise) await math.typesetPromise([host]);
}

type Plotly = {
  newPlot(
    target: Element,
    data: unknown,
    layout: unknown,
    config: unknown,
  ): Promise<unknown>;
  addFrames(target: Element, frames: unknown[]): Promise<unknown>;
};
let loadingPlotly: Promise<Plotly> | undefined;
function loadPlotly(url: string): Promise<Plotly> {
  return loadingPlotly ??= new Promise((resolve, reject) => {
    const global = window as unknown as { Plotly?: Plotly };
    if (global.Plotly) return resolve(global.Plotly);
    const script = document.createElement("script");
    script.src = url;
    script.onload = () =>
      global.Plotly
        ? resolve(global.Plotly)
        : reject(new Error("Plotly unavailable"));
    script.onerror = () =>
      reject(new Error("Unable to load saved plot renderer"));
    document.head.append(script);
  });
}
