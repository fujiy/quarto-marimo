import { dirname, fromFileUrl, join } from "path";

import type { QuartoAPI } from "@quarto/types";
import {
  type CompiledMarimoPage,
  isCompiledMarimoPage,
} from "@marimo-team/mdx-marimo/bridge/protocol";

const defaultCompilerTimeoutMs = 300_000;

// Deno exchanges UTF-8 bytes on stdin and stdout, but Python decodes and
// encodes those streams with the host locale unless UTF-8 mode is on. Windows
// locales such as cp932 otherwise turn document text into mojibake and lone
// surrogates that later fail JSON encoding.
const pythonUtf8Environment: Record<string, string> = {
  PYTHONUTF8: "1",
  PYTHONIOENCODING: "utf-8",
};

export type CompilerOptions = {
  moduleUrl: string;
  source: string;
  input: string;
  interactive: boolean;
  globalEval: boolean;
  externalEnv: boolean;
  pyproject: string;
  pageResourceDirectory?: string;
  signal?: AbortSignal;
};

export type StaticMarimoOutput = {
  type: "html" | "figure" | "para" | "plain" | "blockquote";
  value: string;
  displayCode: boolean;
  code: string;
  language: string;
};

export type MarimoExecution =
  | {
    kind: "page";
    page: CompiledMarimoPage;
    cacheHydration: boolean;
    buildOutputs: StaticMarimoOutput[];
  }
  | { kind: "static"; outputs: StaticMarimoOutput[] };

/** Use the compiler's document collector without executing any notebook cells. */
export async function marimoExecutionIdentity(
  quarto: QuartoAPI,
  options: CompilerOptions,
): Promise<string> {
  const extractPath = join(
    dirname(fromFileUrl(options.moduleUrl)),
    "python",
    "extract.py",
  );
  const output = await executeProcess(
    quarto,
    Deno.env.get("QUARTO_PYTHON") || "python",
    [extractPath, options.input, "identity", options.globalEval ? "yes" : "no"],
    options.source,
  );
  const value = JSON.parse(output);
  if (typeof value?.identity !== "string" || !value.identity) {
    throw new TypeError(
      "marimo collector returned an invalid execution identity",
    );
  }
  return value.identity;
}

export async function runMarimoCompiler(
  quarto: QuartoAPI,
  options: CompilerOptions,
): Promise<MarimoExecution> {
  const extensionDir = dirname(fromFileUrl(options.moduleUrl));
  const extractPath = join(extensionDir, "python", "extract.py");
  let command: string;
  let args: string[];
  let temporaryDirectory: string | undefined;

  if (options.externalEnv) {
    command = Deno.env.get("QUARTO_PYTHON") || "python";
    args = [extractPath];
  } else {
    command = "uv";
    const uvCommand = await constructUvCommand(
      quarto,
      extensionDir,
      options.pyproject,
    );
    temporaryDirectory = uvCommand.temporaryDirectory;
    args = [...uvCommand.args, extractPath];
  }
  args.push(
    options.input,
    options.interactive ? "html" : "static",
    options.globalEval ? "yes" : "no",
  );
  if (options.interactive && options.pageResourceDirectory) {
    args.push(options.pageResourceDirectory);
  }

  let output: string;
  try {
    output = await executeProcess(
      quarto,
      command,
      args,
      options.source,
      compilerTimeoutMs(),
      undefined,
      options.signal,
    );
  } finally {
    if (temporaryDirectory) {
      await removeTemporaryDirectory(temporaryDirectory);
    }
  }
  const value: unknown = JSON.parse(output);
  if (isPageExecution(value) || isStaticExecution(value)) return value;
  throw new TypeError("marimo compiler returned an invalid execution payload");
}

async function constructUvCommand(
  quarto: QuartoAPI,
  extensionDir: string,
  pyproject: string,
): Promise<{ args: string[]; temporaryDirectory: string }> {
  const commandPath = join(extensionDir, "python", "command.py");
  const temporaryDirectory = await Deno.makeTempDir({
    prefix: "quarto-marimo-",
  });
  try {
    const output = await executeProcess(
      quarto,
      "uv",
      ["run", "--with", "marimo", commandPath],
      pyproject,
      compilerTimeoutMs(),
      {
        TEMP: temporaryDirectory,
        TMP: temporaryDirectory,
        TMPDIR: temporaryDirectory,
      },
    );
    const value: unknown = JSON.parse(output);
    if (
      !Array.isArray(value) ||
      !value.every((entry) => typeof entry === "string")
    ) {
      throw new TypeError(
        "marimo dependency resolver returned invalid uv arguments",
      );
    }
    return { args: value, temporaryDirectory };
  } catch (error: unknown) {
    await removeTemporaryDirectory(temporaryDirectory);
    throw error;
  }
}

export async function executeProcess(
  quarto: QuartoAPI,
  command: string,
  args: string[],
  stdin: string,
  timeoutMs = compilerTimeoutMs(),
  env?: Record<string, string>,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const child = new Deno.Command(command, {
    args,
    env: { ...pythonUtf8Environment, ...env },
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const abort = () => {
    try {
      child.kill("SIGTERM");
    } catch { /* Process already exited. */ }
  };
  signal?.addEventListener("abort", abort, { once: true });
  const outputPromise = child.output();
  const writer = child.stdin.getWriter();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    try {
      child.kill("SIGTERM");
    } catch {
      // The process exited between the timeout and signal delivery.
    }
  }, timeoutMs);

  let output: Deno.CommandOutput;
  try {
    await writer.write(new TextEncoder().encode(stdin));
    await writer.close();
    output = await outputPromise;
  } catch (error: unknown) {
    if (!timedOut) throw error;
    await outputPromise.catch(() => undefined);
    throw timeoutError(command, args, timeoutMs);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
  signal?.throwIfAborted();
  if (timedOut) throw timeoutError(command, args, timeoutMs);
  const stderr = new TextDecoder().decode(output.stderr);
  if (stderr) quarto.console.info(stderr.trim());
  if (!output.success) {
    throw new Error(
      stderr.trim() || `${command} exited with code ${output.code}`,
    );
  }
  return new TextDecoder().decode(output.stdout);
}

function compilerTimeoutMs(): number {
  const seconds = Number(
    Deno.env.get("QUARTO_MARIMO_TIMEOUT_SECONDS") ?? "",
  );
  return Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : defaultCompilerTimeoutMs;
}

function timeoutError(
  command: string,
  args: string[],
  timeoutMs: number,
): Error {
  return new Error(
    `marimo compilation timed out after ${timeoutMs / 1000}s while running ${
      [command, ...args].join(" ")
    }`,
  );
}

async function removeTemporaryDirectory(path: string): Promise<void> {
  await Deno.remove(path, { recursive: true }).catch(() => undefined);
}

function isPageExecution(
  value: unknown,
): value is {
  kind: "page";
  page: CompiledMarimoPage;
  cacheHydration: boolean;
  buildOutputs: StaticMarimoOutput[];
} {
  return (
    isRecord(value) &&
    value.kind === "page" &&
    typeof value.cacheHydration === "boolean" &&
    Array.isArray(value.buildOutputs) &&
    value.buildOutputs.every(isStaticOutput) &&
    isCompiledMarimoPage(value.page)
  );
}

function isStaticExecution(
  value: unknown,
): value is { kind: "static"; outputs: StaticMarimoOutput[] } {
  return (
    isRecord(value) &&
    value.kind === "static" &&
    Array.isArray(value.outputs) &&
    value.outputs.every(isStaticOutput)
  );
}

function isStaticOutput(value: unknown): value is StaticMarimoOutput {
  return (
    isRecord(value) &&
    (value.type === "html" ||
      value.type === "figure" ||
      value.type === "para" ||
      value.type === "plain" ||
      value.type === "blockquote") &&
    typeof value.value === "string" &&
    typeof value.displayCode === "boolean" &&
    typeof value.code === "string" &&
    typeof value.language === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
