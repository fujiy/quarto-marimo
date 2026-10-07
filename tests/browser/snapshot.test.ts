import { assertEquals } from "@std/assert";
import { parseHTML } from "linkedom";
import { displaySnapshot } from "../../src/browser/snapshot.ts";

Deno.test("saved forms, matrices, tables and plots need no Python runtime", async () => {
  const { document, window } = parseHTML(
    "<html><head></head><body></body></html>",
  );
  const plotted: unknown[] = [];
  Object.assign(window, {
    Plotly: {
      newPlot: (_target: Element, data: unknown) => {
        plotted.push(data);
        return Promise.resolve();
      },
      addFrames: (_target: Element, frames: unknown) => {
        plotted.push(frames);
        return Promise.resolve();
      },
    },
  });
  Object.assign(globalThis, { document, window });
  const host = document.createElement("div");
  await displaySnapshot(
    host,
    `<marimo-ui-element><marimo-form><marimo-dict>
<marimo-matrix data-initial-value='[[0.7]]' data-row-labels='["Angle"]'></marimo-matrix>
</marimo-dict></marimo-form></marimo-ui-element>
<marimo-table data-data='[{"Error":"1e-16"}]' data-total-rows='1'></marimo-table>
<marimo-plotly data-figure='{"data":[{"y":[1,2]}],"layout":{},"frames":[{}]}' data-config='{}'></marimo-plotly>`,
    "unused.js",
  );
  assertEquals(host.querySelectorAll("table").length, 2);
  assertEquals(
    host.querySelectorAll("marimo-form,marimo-dict,marimo-table,marimo-matrix")
      .length,
    0,
  );
  assertEquals(host.querySelector("table")?.textContent, "Angle0.7");
  assertEquals(host.querySelectorAll("table")[1].textContent, "Error1e-16");
  assertEquals(plotted, [[{ y: [1, 2] }], [{}]]);
  assertEquals(document.querySelectorAll("script").length, 0);
});

Deno.test("saved MIME bundles unwrap nested HTML and preserve plain text", async () => {
  const { document, window } = parseHTML("<html><body></body></html>");
  Object.assign(globalThis, { document, window });
  const host = document.createElement("div");
  const mimeNode = (mime: string, data: unknown) =>
    `<marimo-mime-renderer data-mime='${JSON.stringify(mime)}' data-data='${JSON.stringify(data).replaceAll("'", "&#39;")}'></marimo-mime-renderer>`;
  await displaySnapshot(host,
    mimeNode("application/vnd.marimo+mimebundle", {
      "text/html": mimeNode("text/markdown", "<table><tr><td>導出値</td><td>42</td></tr></table>"),
    }) + mimeNode("text/plain", "<untrusted>"), "unused.js");
  assertEquals(host.querySelector("table")?.textContent, "導出値42");
  assertEquals(host.querySelectorAll("marimo-mime-renderer").length, 0);
  assertEquals(host.textContent, "導出値42<untrusted>");
  assertEquals(host.querySelector("untrusted"), null);
});
