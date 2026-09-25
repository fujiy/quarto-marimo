import { extname, isAbsolute, join, relative, resolve } from "path";

type CdpResponse = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message?: string };
};

type AccessibilityNode = {
  role?: { value?: string };
  name?: { value?: string };
  value?: { value?: string };
  backendDOMNodeId?: number;
};

type PendingRequest = {
  resolve(value: Record<string, unknown>): void;
  reject(error: Error): void;
};

type SiteRequest = { path: string; status: number };

class DevToolsSession {
  private nextId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  readonly diagnostics: string[] = [];

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpResponse;
      if (message.id === undefined) {
        if (
          message.method === "Runtime.exceptionThrown" ||
          message.method === "Log.entryAdded" ||
          message.method === "Network.loadingFailed"
        ) {
          this.diagnostics.push(JSON.stringify(message));
        } else if (message.method === "Network.requestWillBeSent") {
          const request = message.params?.request as
            | { url?: unknown }
            | undefined;
          if (
            typeof request?.url === "string" &&
            request.url.includes("/public/cache/")
          ) {
            this.diagnostics.push(`cache request ${request.url}`);
          }
        } else if (message.method === "Network.responseReceived") {
          const response = message.params?.response as
            | { status?: unknown; url?: unknown }
            | undefined;
          if (
            typeof response?.url === "string" &&
            response.url.includes("/public/cache/")
          ) {
            this.diagnostics.push(
              `cache response ${response.status}: ${response.url}`,
            );
          }
        }
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(
          new Error(message.error.message ?? "Chrome DevTools error"),
        );
      } else {
        pending.resolve(message.result ?? {});
      }
    });
    socket.addEventListener("close", () => {
      for (const request of this.pending.values()) {
        request.reject(new Error("Chrome DevTools connection closed"));
      }
      this.pending.clear();
    });
  }

  static async connect(url: string): Promise<DevToolsSession> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener(
        "error",
        () => reject(new Error("Could not connect to Chrome DevTools")),
        { once: true },
      );
    });
    return new DevToolsSession(socket);
  }

  request<T extends Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.socket.close();
  }
}

function serveSite(
  siteDirectory: string,
  missCache: boolean,
): { url: string; requests: SiteRequest[]; close(): Promise<void> } {
  const root = resolve(siteDirectory);
  const requests: SiteRequest[] = [];
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0 },
    async (request) => {
      const url = new URL(request.url);
      if (missCache && url.pathname.includes("/public/cache/")) {
        requests.push({ path: url.pathname, status: 404 });
        return new Response("cache miss", {
          status: 404,
          headers: { "cache-control": "no-store" },
        });
      }

      const requestedPath = decodeURIComponent(
        url.pathname === "/" ? "/index.html" : url.pathname,
      );
      const file = resolve(root, `.${requestedPath}`);
      const fromRoot = relative(root, file);
      if (
        isAbsolute(fromRoot) || fromRoot === ".." ||
        fromRoot.startsWith(`..${Deno.build.os === "windows" ? "\\" : "/"}`)
      ) {
        requests.push({ path: url.pathname, status: 403 });
        return new Response("forbidden", { status: 403 });
      }

      try {
        const info = await Deno.stat(file);
        if (!info.isFile) {
          requests.push({ path: url.pathname, status: 404 });
          return new Response("not found", { status: 404 });
        }
        const type = contentType(file);
        requests.push({ path: url.pathname, status: 200 });
        return new Response(await Deno.readFile(file), {
          headers: {
            "cache-control": "no-store",
            "content-type": type,
          },
        });
      } catch {
        requests.push({ path: url.pathname, status: 404 });
        return new Response("not found", { status: 404 });
      }
    },
  );
  const address = server.addr as Deno.NetAddr;
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => server.shutdown(),
  };
}

function contentType(file: string): string {
  const types: Record<string, string> = {
    ".css": "text/css",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".json": "application/json",
    ".jsonl": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };
  return types[extname(file).toLowerCase()] ?? "application/octet-stream";
}

function assertCacheServed(
  requests: SiteRequest[],
  pagePrefix: string,
): void {
  const cacheRequests = requests.filter((request) =>
    request.path.startsWith(`${pagePrefix}/public/cache/`)
  );
  if (cacheRequests.length === 0) {
    throw new Error(`The ${pagePrefix} page requested no cache files`);
  }
  const objectRequests = cacheRequests.filter((request) =>
    /\.(?:npy|pickle)$/.test(request.path)
  );
  if (
    !objectRequests.some((request) => request.path.endsWith(".npy")) ||
    !objectRequests.some((request) => request.path.endsWith(".pickle"))
  ) {
    throw new Error(
      `The ${pagePrefix} page did not request both NumPy and pickle cache data`,
    );
  }
  const failed = objectRequests.find((request) => request.status !== 200);
  if (failed) {
    throw new Error(
      `The ${pagePrefix} page cache payload failed: ${JSON.stringify(failed)}`,
    );
  }
}

async function launchChrome(binary: string): Promise<{
  child: Deno.ChildProcess;
  port: number;
  profileDirectory: string;
}> {
  const profileDirectory = await Deno.makeTempDir({ prefix: "marimo-chrome-" });
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-allow-origins=*",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDirectory}`,
    "about:blank",
  ];
  if (Deno.build.os === "linux") args.push("--no-sandbox");
  const child = new Deno.Command(binary, {
    args,
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).spawn();
  const activePortFile = join(profileDirectory, "DevToolsActivePort");
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const activePort = await Deno.readTextFile(activePortFile);
      const port = Number(activePort.split(/\r?\n/, 1)[0]);
      if (Number.isInteger(port) && port > 0) {
        return { child, port, profileDirectory };
      }
    } catch {
      // Chrome creates DevToolsActivePort after its remote-debugging server starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill("SIGTERM");
  throw new Error("Chrome did not start its DevTools endpoint");
}

async function connectToPage(port: number): Promise<DevToolsSession> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error("Chrome did not expose its page target");
  const targets = await response.json() as Array<{
    type: string;
    webSocketDebuggerUrl?: string;
  }>;
  const page = targets.find((target) => target.type === "page");
  if (!page?.webSocketDebuggerUrl) {
    throw new Error("Chrome has no inspectable page target");
  }
  const session = await DevToolsSession.connect(page.webSocketDebuggerUrl);
  await session.request("Page.enable");
  await session.request("DOM.enable");
  await session.request("Accessibility.enable");
  await session.request("Runtime.enable");
  await session.request("Log.enable");
  await session.request("Network.enable");
  return session;
}

async function accessibilityNodes(
  session: DevToolsSession,
): Promise<AccessibilityNode[]> {
  const result = await session.request<{ nodes: AccessibilityNode[] }>(
    "Accessibility.getFullAXTree",
  );
  return result.nodes;
}

function accessibilityText(nodes: AccessibilityNode[]): string {
  return nodes.map((node) =>
    [
      node.role?.value,
      node.name?.value,
      node.value?.value,
    ].filter(Boolean).join(" ")
  ).join("\n");
}

async function waitForText(
  session: DevToolsSession,
  expected: string,
  timeoutMs = 90_000,
  requests: SiteRequest[] = [],
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let current = "";
  while (Date.now() < deadline) {
    current = accessibilityText(await accessibilityNodes(session));
    if (current.includes(expected)) return current;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Timed out waiting for browser text ${
      JSON.stringify(expected)
    }.\n${current}\nCache requests:\n${
      JSON.stringify(
        requests.filter((request) => request.path.includes("/public/cache/")),
      )
    }\nBrowser diagnostics:\n${session.diagnostics.join("\n")}`,
  );
}

async function waitForDiagnostic(
  session: DevToolsSession,
  expected: string,
  fromIndex = 0,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (
      session.diagnostics.slice(fromIndex).some((message) =>
        message.includes(expected)
      )
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for browser diagnostic ${expected}`);
}

async function moveSliderTo(
  session: DevToolsSession,
  targetValue: number,
): Promise<void> {
  const slider = (await accessibilityNodes(session)).find((node) =>
    node.role?.value === "slider"
  );
  if (slider?.backendDOMNodeId === undefined) {
    throw new Error("The hydrated page has no accessible slider");
  }
  const resolved = await session.request<{
    object?: { objectId?: string };
  }>("DOM.resolveNode", { backendNodeId: slider.backendDOMNodeId });
  const objectId = resolved.object?.objectId;
  if (!objectId) throw new Error("Chrome could not resolve the slider node");
  const geometry = await session.request<{
    result?: { value?: { x: number; y: number } };
  }>("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration: `function (targetValue) {
      const root = this.parentElement?.parentElement;
      const range = root?.getBoundingClientRect();
      const thumb = this.getBoundingClientRect();
      const minimum = Number(this.getAttribute("aria-valuemin"));
      const maximum = Number(this.getAttribute("aria-valuemax"));
      if (!range || !(maximum > minimum)) {
        throw new Error("Could not determine the slider range");
      }
      const target = Math.min(maximum, Math.max(minimum, targetValue));
      return {
        x: range.left + thumb.width / 2 +
          ((target - minimum) / (maximum - minimum)) *
            (range.width - thumb.width),
        y: range.top + range.height / 2,
      };
    }`,
    arguments: [{ value: targetValue }],
    returnByValue: true,
  });
  const point = geometry.result?.value;
  if (!point) throw new Error("Chrome could not compute the slider position");
  await session.request("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
    button: "none",
    buttons: 0,
    pointerType: "mouse",
  });
  await session.request("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
    pointerType: "mouse",
  });
  await session.request("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
    pointerType: "mouse",
  });
}

async function waitForSliderValue(
  session: DevToolsSession,
  expected: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let current = "";
  while (Date.now() < deadline) {
    current = accessibilityText(await accessibilityNodes(session));
    if (current.includes(`slider ${expected}`)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Timed out waiting for slider value ${expected}.\n${current}\n` +
      `Browser diagnostics:\n${session.diagnostics.join("\n")}`,
  );
}

async function waitForStableSliderValue(
  session: DevToolsSession,
  expected: string,
  stableMs = 2_000,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let stableSince: number | undefined;
  let current = "";
  while (Date.now() < deadline) {
    current = accessibilityText(await accessibilityNodes(session));
    if (current.includes(`slider ${expected}`)) {
      stableSince ??= Date.now();
      if (Date.now() - stableSince >= stableMs) return;
    } else {
      stableSince = undefined;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Timed out waiting for slider value ${expected} to stabilize.\n${current}\n` +
      `Browser diagnostics:\n${session.diagnostics.join("\n")}`,
  );
}

async function setSliderValueByKeyboard(
  session: DevToolsSession,
  expected: number,
): Promise<void> {
  const nodes = await accessibilityNodes(session);
  const slider = nodes.find((node) => node.role?.value === "slider");
  if (slider?.backendDOMNodeId === undefined) {
    throw new Error("The hydrated page has no accessible slider");
  }
  await session.request("DOM.focus", {
    backendNodeId: slider.backendDOMNodeId,
  });
  let current = Number(slider.value?.value);
  while (Number.isFinite(current) && current !== expected) {
    const key = current < expected ? "ArrowRight" : "ArrowLeft";
    const keyCode = key === "ArrowRight" ? 39 : 37;
    const keyParams = {
      key,
      code: key,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    };
    await session.request("Input.dispatchKeyEvent", {
      type: "keyDown",
      ...keyParams,
    });
    await session.request("Input.dispatchKeyEvent", {
      type: "keyUp",
      ...keyParams,
    });
    current += key === "ArrowRight" ? 1 : -1;
    await waitForSliderValue(session, String(current));
  }
  if (current !== expected) {
    throw new Error(`Could not set slider to ${expected}`);
  }
}

async function navigate(session: DevToolsSession, url: string): Promise<void> {
  await session.request("Page.navigate", { url });
}

const siteDirectory = Deno.env.get("QUARTO_MARIMO_TEST_SITE_DIR");
const chromeBinary = Deno.env.get("CHROME_BIN");

Deno.test({
  name:
    "browser hydrates root and nested caches across reloads and cache misses",
  ignore: !siteDirectory || !chromeBinary,
  async fn() {
    const normalSite = await serveSite(siteDirectory!, false);
    const missingCacheSite = await serveSite(siteDirectory!, true);
    const chrome = await launchChrome(chromeBinary!);
    let session: DevToolsSession | undefined;
    try {
      session = await connectToPage(chrome.port);

      await navigate(session, `${normalSite.url}/index.html`);
      let text = await waitForText(session, "root: [2.0, 4.0, 6.0, 8.0]");
      if (text.includes("A_EXECUTED_IN_BROWSER")) {
        throw new Error("The root cache cell executed in the browser");
      }
      const rootDiagnosticsStart = session.diagnostics.length;
      await moveSliderTo(session, 3);
      await waitForDiagnostic(
        session,
        "Loaded Pygments",
        rootDiagnosticsStart,
      );
      await waitForStableSliderValue(session, "2");
      await waitForText(
        session,
        "UI_RUNTIME: emscripten",
        30_000,
        normalSite.requests,
      );
      text = accessibilityText(await accessibilityNodes(session));
      if (text.includes("A_EXECUTED_IN_BROWSER")) {
        throw new Error("The root cache miss executed the native-only cell");
      }
      assertCacheServed(normalSite.requests, "/index_files");
      await setSliderValueByKeyboard(session, 4);
      await waitForSliderValue(session, "4");
      text = await waitForText(
        session,
        "root: [4.0, 8.0, 12.0, 16.0]",
        30_000,
        normalSite.requests,
      );
      if (text.includes("A_EXECUTED_IN_BROWSER")) {
        throw new Error("The root UI update executed the native-only cell");
      }
      await session.request("Page.reload", { ignoreCache: true });
      text = await waitForText(session, "root: [2.0, 4.0, 6.0, 8.0]");
      if (text.includes("A_EXECUTED_IN_BROWSER")) {
        throw new Error("The root reload did not hydrate the native-only cell");
      }
      assertCacheServed(normalSite.requests, "/index_files");

      await navigate(session, `${normalSite.url}/nested/index.html`);
      text = await waitForText(session, "nested: [2.0, 4.0, 6.0, 8.0]");
      if (text.includes("A_EXECUTED_IN_BROWSER")) {
        throw new Error("The nested cache cell executed in the browser");
      }
      const nestedDiagnosticsStart = session.diagnostics.length;
      await moveSliderTo(session, 3);
      await waitForDiagnostic(
        session,
        "Loaded Pygments",
        nestedDiagnosticsStart,
      );
      await waitForStableSliderValue(session, "2");
      await waitForText(
        session,
        "UI_RUNTIME: emscripten",
        30_000,
        normalSite.requests,
      );
      text = accessibilityText(await accessibilityNodes(session));
      if (text.includes("A_EXECUTED_IN_BROWSER")) {
        throw new Error("The nested cache miss executed the native-only cell");
      }
      assertCacheServed(normalSite.requests, "/nested/index_files");
      await setSliderValueByKeyboard(session, 4);
      await waitForSliderValue(session, "4");
      text = await waitForText(
        session,
        "nested: [4.0, 8.0, 12.0, 16.0]",
        30_000,
        normalSite.requests,
      );
      if (text.includes("A_EXECUTED_IN_BROWSER")) {
        throw new Error("The nested UI update executed the native-only cell");
      }
      await session.request("Page.reload", { ignoreCache: true });
      text = await waitForText(session, "nested: [2.0, 4.0, 6.0, 8.0]");
      if (text.includes("A_EXECUTED_IN_BROWSER")) {
        throw new Error(
          "The nested reload did not hydrate the native-only cell",
        );
      }
      assertCacheServed(normalSite.requests, "/nested/index_files");

      await navigate(session, `${missingCacheSite.url}/index.html`);
      const missText = await waitForText(session, "A_EXECUTED_IN_BROWSER");
      if (!missText.includes("RuntimeError")) {
        throw new Error(
          "A cache miss did not expose the native-only cell failure",
        );
      }
    } finally {
      session?.close();
      chrome.child.kill("SIGTERM");
      await chrome.child.status;
      await Deno.remove(chrome.profileDirectory, { recursive: true });
      await normalSite.close();
      await missingCacheSite.close();
    }
  },
});
