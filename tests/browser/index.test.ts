import { assert, assertEquals } from "@std/assert";
import { parseHTML } from "linkedom";
import type { MarimoIslandElement } from "@marimo-team/mdx-marimo/bridge/element";

Deno.test("browser adapter mounts the host element and follows Quarto theme", async () => {
  const { document, window } = parseHTML(
    "<html><head><base href='http://localhost/'><script src='https://cdn.example/mathjax.js'></script></head><body class='quarto-light'></body></html>",
  );
  const browser = window as Window & typeof globalThis;
  browser.matchMedia = () =>
    ({
      addEventListener: () => {},
      matches: false,
      removeEventListener: () => {},
    }) as unknown as MediaQueryList;
  Object.assign(globalThis, {
    customElements: browser.customElements,
    document,
    getComputedStyle: () => ({ colorScheme: "light" }),
    HTMLElement: browser.HTMLElement,
    HTMLTemplateElement: browser.HTMLTemplateElement,
    MutationObserver: browser.MutationObserver,
    Node: browser.Node,
    NodeFilter: { SHOW_ELEMENT: 1 },
    ShadowRoot: browser.ShadowRoot,
    window: browser,
  });

  const { loadExternalIsland } = await import("../../src/browser/index.ts");
  const host = browser as typeof browser & {
    __quartoMarimoMathJaxUrl: string;
    __resizeIframe: (frame: HTMLIFrameElement) => void;
  };
  assertEquals(host.__quartoMarimoMathJaxUrl, "https://cdn.example/mathjax.js");
  assertEquals(document.querySelector("script")?.dataset.status, "ready");
  let observed = false;
  Object.assign(globalThis, {
    ResizeObserver: class {
      observe() {
        observed = true;
      }
      disconnect() {}
    },
  });
  const frame = {
    style: { height: "400px" },
    contentDocument: {
      body: {},
      documentElement: {
        scrollHeight: 600,
        clientHeight: 400,
        scrollWidth: 700,
        clientWidth: 600,
      },
    },
  } as unknown as HTMLIFrameElement;
  host.__resizeIframe(frame);
  assertEquals(frame.style.height, "620px");
  assert(observed);
  const island = document.createElement(
    "marimo-quarto-island",
  ) as MarimoIslandElement;
  document.body.append(island);
  island.payload = staticPayload();
  await Promise.resolve();

  assert(customElements.get("marimo-quarto-island"));
  assertEquals(island.textContent?.trim(), "Static output");
  assertEquals(island.dataset.marimoTheme, "light");

  document.body.classList.replace("quarto-light", "quarto-dark");
  await Promise.resolve();
  assertEquals(island.dataset.marimoTheme, "dark");
  const oldFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (() => {
    requests++;
    return Promise.resolve(Response.json({
      protocolVersion: 2,
      app: null,
      cells: [{ ...staticPayload().cell, output: null }],
      diagnostics: [],
    }));
  }) as typeof fetch;
  const external = document.createElement(
    "marimo-quarto-island",
  ) as MarimoIslandElement;
  external.setAttribute(
    "data-marimo-src",
    "http://localhost/index_files/marimo.json",
  );
  external.setAttribute("data-marimo-index", "0");
  document.body.append(external);
  try {
    await loadExternalIsland(external);
    await loadExternalIsland(external);
    assertEquals(external.textContent?.trim(), "Static output");
    assertEquals(requests, 1);
  } finally {
    globalThis.fetch = oldFetch;
    external.remove();
    island.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
});

function staticPayload() {
  return {
    protocolVersion: 2 as const,
    app: null,
    cell: {
      index: 0,
      html: "<p>Static output</p>",
      options: {
        language: "python" as const,
        render: {
          source: false,
          output: true,
          include: true,
          editor: false,
          error: true,
          serverOutput: true,
        },
        execution: { enabled: true },
        marimo: { disabled: false, unparsable: false },
      },
    },
  };
}
