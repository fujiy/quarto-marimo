import {
  defineMarimoIslandElement,
  type MarimoIslandElement,
} from "@marimo-team/mdx-marimo/bridge/element";
import {
  type CompiledMarimoPage,
  isCompiledMarimoPage,
  projectPageCellPayloads,
} from "@marimo-team/mdx-marimo/bridge/protocol";
import { MARIMO_ELEMENT_NAME } from "../island-element.ts";
import { displaySnapshot, disposeSnapshot } from "./snapshot.ts";

Object.assign(window, { quartoMarimoDisplay: displaySnapshot, quartoMarimoDispose: disposeSnapshot });

// The islands bundle also runs outside marimo's index.html. Supply its iframe
// hook and reuse Quarto's MathJax instead of loading a conflicting major version.
const hostWindow = window as Window & {
  __resizeIframe?: (frame: HTMLIFrameElement) => void;
  __quartoMarimoMathJaxUrl?: string;
};
const frameObservers = new WeakMap<HTMLIFrameElement, ResizeObserver>();
hostWindow.__resizeIframe = (frame) => {
  frameObservers.get(frame)?.disconnect();
  const doc = frame.contentDocument;
  if (!doc?.body) return;
  const resize = () => {
    const element = doc.documentElement;
    if (element.scrollHeight === element.clientHeight) return;
    const height = element.scrollHeight +
      (element.scrollWidth > element.clientWidth ? 20 : 0);
    if (frame.style.height !== `${height}px`) {
      frame.style.height = `${height}px`;
    }
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(doc.body);
  frameObservers.set(frame, observer);
};
const mathScript = document.querySelector<HTMLScriptElement>(
  'script[src*="mathjax"]',
);
if (mathScript) {
  hostWindow.__quartoMarimoMathJaxUrl = mathScript.src;
  // Quarto's deferred math script has run by DOMContentLoaded.
  const ready = () => {
    mathScript.dataset.status = "ready";
  };
  mathScript.addEventListener("load", ready, { once: true });
  mathScript.addEventListener("error", () => {
    mathScript.dataset.status = "error";
  }, { once: true });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready, { once: true });
  } else ready();
}

defineMarimoIslandElement({
  name: MARIMO_ELEMENT_NAME,
  host: "quarto",
  themeResolver: resolveQuartoTheme,
});

// One fetch pins all islands in a document to the same published generation.
const pages = new Map<
  string,
  Promise<ReturnType<typeof projectPageCellPayloads>>
>();
const loading = new WeakSet<Element>();
export async function loadExternalIsland(
  element: MarimoIslandElement,
): Promise<void> {
  const source = element.getAttribute("data-marimo-src");
  if (!source || loading.has(element)) return;
  loading.add(element);
  try {
    const url = new URL(source, document.baseURI).href;
    let page = pages.get(url);
    if (!page) {
      page = fetch(url, { cache: "no-store" }).then(async (response) => {
        if (!response.ok) {
          throw new Error(`marimo data: HTTP ${response.status}`);
        }
        const value = await response.json();
        if (!isCompiledMarimoPage(value)) {
          throw new Error("invalid marimo page data");
        }
        // Hosts may display snapshots while preparing the initial runtime state.
        // The bridge only mounts once the host releases this page.
        const prepare = (window as Window & {
          quartoMarimoPrepare?: (
            page: CompiledMarimoPage,
            url: string,
          ) => Promise<CompiledMarimoPage>;
        }).quartoMarimoPrepare;
        const prepared = prepare ? await prepare(value, url) : value;
        return projectPageCellPayloads({
          ...prepared,
          cells: prepared.cells.map((cell) =>
            (cell.options.render as { renderOnly?: boolean }).renderOnly
              ? {
                ...cell,
                options: {
                  ...cell.options,
                  render: { ...cell.options.render, include: false },
                },
              }
              : cell
          ),
        });
      });
      pages.set(url, page);
    }
    const index = Number(element.getAttribute("data-marimo-index"));
    const payload = (await page)[index];
    if (!Number.isInteger(index) || !payload) {
      throw new Error("missing marimo cell data");
    }
    element.payload = payload;
  } catch (error) {
    element.setAttribute("data-marimo-load-error", "true");
    element.textContent = `Unable to load interactive content: ${error}`;
    console.error(error);
  }
}

function loadExternalIslands(): void {
  for (
    const element of document.querySelectorAll(
      `${MARIMO_ELEMENT_NAME}[data-marimo-src]`,
    )
  ) {
    void loadExternalIsland(element as MarimoIslandElement);
  }
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", loadExternalIslands, {
    once: true,
  });
} else {
  loadExternalIslands();
}

function resolveQuartoTheme(
  host: HTMLElement,
): "light" | "dark" | undefined {
  let element: Element | null = host;
  while (element) {
    if (element.classList.contains("quarto-dark")) return "dark";
    if (element.classList.contains("quarto-light")) return "light";
    element = element.parentElement;
  }
  return undefined;
}
