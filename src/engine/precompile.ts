import { dirname, fromFileUrl, join, relative, resolve } from "path";
import type {
  EngineProjectContext,
  ExecuteOptions,
  QuartoAPI,
} from "@quarto/types";
import { containsMarimoFence } from "./authoring.ts";
import {
  type CompilerOptions,
  executeProcess,
  type MarimoExecution,
  marimoExecutionIdentity,
  runMarimoCompiler,
} from "./process.ts";

type Manifest = { jobs: number; pages: { input: string; revision: string }[] };
type Outcome<T> = { value: T } | { error: unknown };
type Job<T> = {
  key: string;
  input: string;
  controller: AbortController;
  run: (signal: AbortSignal) => Promise<T>;
  resolve: (outcome: Outcome<T>) => void;
  result: Promise<Outcome<T>>;
};

/** Bounded jobs retain settled results and share one execution per request. */
export class CompilerQueue<T> {
  private jobs = new Map<string, Job<T>>();
  private waiting: Job<T>[] = [];
  private active = 0;
  private closed = false;
  constructor(private limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("compiler jobs must be positive");
    }
  }
  submit(
    input: string,
    key: string,
    run: (signal: AbortSignal) => Promise<T>,
    urgent = false,
  ): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error("compiler queue is closed"));
    }
    let job = this.jobs.get(key);
    if (!job) {
      // A changed page must not reuse or publish an obsolete compilation.
      for (const [oldKey, old] of this.jobs) {
        if (old.input === input) {
          old.controller.abort();
          this.jobs.delete(oldKey);
        }
      }
      let finish!: (outcome: Outcome<T>) => void;
      const result = new Promise<Outcome<T>>((r) => {
        finish = r;
      });
      job = {
        key,
        input,
        controller: new AbortController(),
        run,
        resolve: finish,
        result,
      };
      this.jobs.set(key, job);
      this.waiting.push(job);
    }
    if (urgent) {
      const index = this.waiting.indexOf(job);
      if (index >= 0) {
        this.waiting.splice(index, 1);
        this.waiting.unshift(job);
      }
    }
    this.pump();
    return job.result.then((outcome) => {
      if ("error" in outcome) throw outcome.error;
      return outcome.value;
    });
  }
  close(): void {
    this.closed = true;
    for (const job of this.jobs.values()) job.controller.abort();
    for (const job of this.waiting) {
      job.resolve({ error: new Error("compiler queue stopped") });
    }
    this.waiting = [];
  }
  private pump(): void {
    while (!this.closed && this.active < this.limit && this.waiting.length) {
      const job = this.waiting.shift()!;
      if (job.controller.signal.aborted) {
        job.resolve({ error: new Error("compiler request superseded") });
        continue;
      }
      this.active++;
      Promise.resolve().then(() => job.run(job.controller.signal))
        .then(
          (value) => job.resolve({ value }),
          (error) => job.resolve({ error }),
        )
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }
}

type Compiled = { execution: MarimoExecution; artifacts: string };
const sessions = new Map<string, Promise<Precompiler>>();

/** Keep the queue shared across Quarto's per-file engine instances. */
export async function precompiledExecution(
  quarto: QuartoAPI,
  options: ExecuteOptions,
  request: CompilerOptions,
): Promise<MarimoExecution | undefined> {
  const manifest = Deno.env.get("QUARTO_MARIMO_PRECOMPILE_MANIFEST");
  if (
    !manifest || !request.interactive || !request.externalEnv ||
    !options.project
  ) return undefined;
  const sessionKey = resolve(manifest);
  let session = sessions.get(sessionKey);
  if (!session) {
    session = Precompiler.create(quarto, options.project, manifest, request);
    sessions.set(sessionKey, session);
  }
  return (await session).execute(request);
}

class Precompiler {
  private seeded = false;
  private queue: CompilerQueue<Compiled>;
  private manifest: Manifest;
  private constructor(
    private quarto: QuartoAPI,
    private project: EngineProjectContext,
    private manifestPath: string,
    private scratch: string,
    manifest: Manifest,
  ) {
    this.manifest = manifest;
    this.queue = new CompilerQueue(manifest.jobs);
  }
  static async create(
    quarto: QuartoAPI,
    project: EngineProjectContext,
    path: string,
    request: CompilerOptions,
  ): Promise<Precompiler> {
    const manifest = JSON.parse(await Deno.readTextFile(path)) as Manifest;
    const scratch = await Deno.makeTempDir({
      prefix: "quarto-marimo-precompile-",
    });
    const session = new Precompiler(quarto, project, path, scratch, manifest);
    quarto.system.onCleanup(async () => {
      session.queue.close();
      await Deno.remove(scratch, { recursive: true }).catch(() => {});
    });
    // Install shared runtime once before any page can race its initial installation.
    const extension = dirname(fromFileUrl(request.moduleUrl));
    await executeProcess(quarto, Deno.env.get("QUARTO_PYTHON") || "python", [
      join(extension, "python", "extract.py"),
      "--prepare-runtime",
    ], "");
    return session;
  }
  async execute(
    request: CompilerOptions,
  ): Promise<MarimoExecution | undefined> {
    this.manifest = JSON.parse(
      await Deno.readTextFile(this.manifestPath),
    ) as Manifest;
    const page = this.page(request.input);
    if (!page) return undefined;
    const current = this.schedule(request, page.revision, true);
    // A failure may settle while the remaining inputs are still being resolved.
    current.catch(() => {});
    if (!this.seeded) {
      this.seeded = true;
      // Resolve includes through the same Quarto project; never invent a second QMD parser.
      for (const next of this.manifest.pages) {
        const input = resolve(this.project.dir, next.input);
        if (input === resolve(request.input)) continue;
        const markdown = await this.project.resolveFullMarkdownForFile(
          undefined,
          input,
        );
        if (!containsMarimoFence(markdown.value)) continue;
        const metadata = this.quarto.markdownRegex.extractYaml(markdown.value);
        if (metadata["external-env"] !== true) continue;
        const speculative: CompilerOptions = {
          ...request,
          input,
          source: markdown.value,
          globalEval: metadata.eval !== false,
          externalEnv: true,
          pyproject: String(metadata.pyproject ?? ""),
          pageResourceDirectory: undefined,
        };
        this.schedule(speculative, next.revision).catch(() => {});
      }
    }
    const compiled = await current;
    // Quarto may move supporting files during rendering; retain a private copy for later CSS renders.
    if (request.pageResourceDirectory) {
      await Deno.remove(
        join(request.pageResourceDirectory, "public", "cache"),
        {
          recursive: true,
        },
      ).catch((error: unknown) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      });
      await copyTree(compiled.artifacts, request.pageResourceDirectory);
    }
    return structuredClone(compiled.execution);
  }
  private page(input: string) {
    return this.manifest.pages.find((page) =>
      page.input ===
        relative(this.project.dir, resolve(input)).split("\\").join("/")
    );
  }
  private async schedule(
    request: CompilerOptions,
    revision: string,
    urgent = false,
  ): Promise<Compiled> {
    const signature = JSON.stringify({
      input: resolve(request.input),
      // The canonical collector excludes prose and source positions while
      // retaining setup, cell order, code, and compilation/display options.
      identity: await marimoExecutionIdentity(this.quarto, request),
      interactive: request.interactive,
      globalEval: request.globalEval,
      externalEnv: request.externalEnv,
      pyproject: request.pyproject,
      revision,
    });
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(signature),
    );
    const key = Array.from(
      new Uint8Array(digest),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    return this.queue.submit(resolve(request.input), key, async (signal) => {
      const artifacts = join(this.scratch, key);
      await Deno.mkdir(artifacts, { recursive: true });
      const start = performance.now();
      this.quarto.console.info(
        `marimo compile start: ${
          this.page(request.input)?.input ?? request.input
        }`,
      );
      const execution = await runMarimoCompiler(this.quarto, {
        ...request,
        pageResourceDirectory: artifacts,
        signal,
      });
      this.quarto.console.info(
        `marimo compile done: ${
          this.page(request.input)?.input ?? request.input
        } (${((performance.now() - start) / 1000).toFixed(2)}s)`,
      );
      return { execution, artifacts };
    }, urgent);
  }
}

async function copyTree(source: string, destination: string): Promise<void> {
  await Deno.mkdir(destination, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    const from = join(source, entry.name), to = join(destination, entry.name);
    if (entry.isDirectory) await copyTree(from, to);
    else if (entry.isFile) await Deno.copyFile(from, to);
  }
}
