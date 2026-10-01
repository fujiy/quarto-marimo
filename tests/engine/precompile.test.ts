import { assertEquals, assertRejects } from "@std/assert";
import type { ExecuteOptions, QuartoAPI } from "@quarto/types";
import {
  CompilerQueue,
  precompiledExecution,
} from "../../src/engine/precompile.ts";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
Deno.test("compiler queue bounds concurrency and shares completed results", async () => {
  const queue = new CompilerQueue<number>(2);
  const gates = [deferred<number>(), deferred<number>(), deferred<number>()];
  const started: number[] = [];
  const jobs = gates.map((gate, index) =>
    queue.submit(`${index}`, `${index}`, () => {
      started.push(index);
      return gate.promise;
    })
  );
  await Promise.resolve();
  assertEquals(started, [0, 1]);
  gates[0].resolve(10);
  assertEquals(await jobs[0], 10);
  await Promise.resolve();
  assertEquals(started, [0, 1, 2]);
  gates[1].resolve(20);
  gates[2].resolve(30);
  assertEquals(await Promise.all(jobs), [10, 20, 30]);
  assertEquals(
    await queue.submit("0", "0", () => Promise.reject("must reuse")),
    10,
  );
  queue.close();
});
Deno.test("demanded page moves ahead of speculative jobs", async () => {
  const queue = new CompilerQueue<number>(1);
  const gate = deferred<number>();
  const first = queue.submit("first", "first", () => gate.promise);
  const order: number[] = [];
  const second = queue.submit("second", "second", () => {
    order.push(2);
    return Promise.resolve(2);
  });
  const third = queue.submit("third", "third", () => {
    order.push(3);
    return Promise.resolve(3);
  });
  const demanded = queue.submit(
    "third",
    "third",
    () => Promise.reject("must share"),
    true,
  );
  gate.resolve(1);
  assertEquals(await Promise.all([first, second, third, demanded]), [
    1,
    2,
    3,
    3,
  ]);
  assertEquals(order, [3, 2]);
  queue.close();
});
Deno.test("changed request aborts the old page", async () => {
  const queue = new CompilerQueue<number>(1);
  const started = deferred<void>();
  const old = queue.submit(
    "page",
    "old",
    (signal) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("obsolete")), {
          once: true,
        });
        started.resolve();
      }),
  );
  const failure = assertRejects(() => old, Error, "obsolete");
  await started.promise;
  const next = queue.submit("page", "new", () => Promise.resolve(2));
  await failure;
  assertEquals(await next, 2);
  queue.close();
});
Deno.test("failed speculative result is retained until demanded", async () => {
  const queue = new CompilerQueue<number>(1);
  await assertRejects(
    () =>
      queue.submit(
        "page",
        "key",
        () => Promise.reject(new Error("compiler failed")),
      ),
    Error,
    "compiler failed",
  );
  await assertRejects(
    () => queue.submit("page", "key", () => Promise.resolve(1)),
    Error,
    "compiler failed",
  );
  queue.close();
});
Deno.test("closing aborts running jobs and rejects queued jobs", async () => {
  const queue = new CompilerQueue<number>(1);
  const started = deferred<void>();
  const running = queue.submit(
    "a",
    "a",
    (signal) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("stopped")), {
          once: true,
        });
        started.resolve();
      }),
  );
  const waiting = queue.submit("b", "b", () => Promise.resolve(2));
  const failures = [
    assertRejects(() => running, Error, "stopped"),
    assertRejects(() => waiting, Error, "stopped"),
  ];
  await started.promise;
  queue.close();
  await Promise.all(failures);
});

Deno.test({
  name:
    "preview reuses compilation for prose and invalidates cells and Python revisions",
  ignore: Deno.build.os === "windows",
  async fn() {
    const directory = await Deno.makeTempDir();
    const command = `${directory}/python`;
    const manifest = `${directory}/manifest.json`;
    const previousPython = Deno.env.get("QUARTO_PYTHON");
    const previousManifest = Deno.env.get("QUARTO_MARIMO_PRECOMPILE_MANIFEST");
    const cleanup: (() => Promise<void>)[] = [];
    try {
      // Substitute only the subprocess protocol. Python tests exercise the real
      // collector; this test observes whether preview actually schedules a job.
      await Deno.writeTextFile(
        command,
        `#!/bin/sh
if [ "$2" = "--prepare-runtime" ]; then exit 0; fi
source=$(cat)
if [ "$3" = "identity" ]; then
  case "$source" in
    *changed-cell*) printf '%s' '{"identity":"changed"}' ;;
    *) printf '%s' '{"identity":"original"}' ;;
  esac
else
  printf '%s' '{"kind":"static","outputs":[]}'
fi
`,
      );
      await Deno.chmod(command, 0o755);
      Deno.env.set("QUARTO_PYTHON", command);
      Deno.env.set("QUARTO_MARIMO_PRECOMPILE_MANIFEST", manifest);
      const writeManifest = (revision: string) =>
        Deno.writeTextFile(
          manifest,
          JSON.stringify({ jobs: 1, pages: [{ input: "page.qmd", revision }] }),
        );
      await writeManifest("python-v1");
      const messages: string[] = [];
      const quarto = {
        system: { onCleanup: (fn: () => Promise<void>) => cleanup.push(fn) },
        console: { info: (message: string) => messages.push(message) },
      } as unknown as QuartoAPI;
      const options = { project: { dir: directory } } as ExecuteOptions;
      const request = {
        moduleUrl:
          new URL("../../_extensions/marimo/marimo-engine.js", import.meta.url)
            .href,
        input: `${directory}/page.qmd`,
        source: "original-cell",
        interactive: true,
        externalEnv: true,
        globalEval: true,
        pyproject: "",
      };
      const compileCount = () =>
        messages.filter((message) =>
          message.startsWith("marimo compile start:")
        ).length;
      await precompiledExecution(quarto, options, request);
      assertEquals(compileCount(), 1);
      await precompiledExecution(quarto, options, {
        ...request,
        source: "# New heading\n\noriginal-cell\nChanged prose",
      });
      assertEquals(compileCount(), 1);
      await precompiledExecution(quarto, options, {
        ...request,
        source: "changed-cell",
      });
      assertEquals(compileCount(), 2);
      await writeManifest("python-v2");
      await precompiledExecution(quarto, options, {
        ...request,
        source: "changed-cell",
      });
      assertEquals(compileCount(), 3);
      await precompiledExecution(quarto, options, {
        ...request,
        source: "changed-cell",
        globalEval: false,
      });
      assertEquals(compileCount(), 4);
    } finally {
      for (const fn of cleanup) await fn();
      for (
        const [name, previous] of [
          ["QUARTO_PYTHON", previousPython],
          ["QUARTO_MARIMO_PRECOMPILE_MANIFEST", previousManifest],
        ]
      ) {
        if (previous === undefined) Deno.env.delete(name!);
        else Deno.env.set(name!, previous);
      }
      await Deno.remove(directory, { recursive: true });
    }
  },
});
