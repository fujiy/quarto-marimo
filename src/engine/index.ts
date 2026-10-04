import { dirname, fromFileUrl, join } from "path";

import type {
  CheckConfiguration,
  DependenciesOptions,
  DependenciesResult,
  EngineProjectContext,
  ExecuteOptions,
  ExecuteResult,
  ExecutionEngineDiscovery,
  ExecutionEngineInstance,
  ExecutionTarget,
  MappedString,
  PandocIncludes,
  PostProcessOptions,
  QuartoAPI,
} from "@quarto/types";

import {
  containsMarimoFence,
  isMarimoCell,
  MARIMO_CELL_REGEX,
} from "./authoring.ts";
import { writeBrowserHeader } from "./browser-assets.ts";
import {
  localizeRuntimeAssets,
  pageResourcePaths,
  runtimeResourceFiles,
  writeWorkerEntry,
} from "./runtime-assets.ts";
import {
  projectInteractivePage,
  projectStaticPage,
  validateProjectionCount,
} from "./projection.ts";
import { runMarimoCompiler } from "./process.ts";
import { precompiledExecution } from "./precompile.ts";

let quarto: QuartoAPI;

const marimoEngineDiscovery: ExecutionEngineDiscovery = {
  init: (quartoAPI: QuartoAPI) => {
    quarto = quartoAPI;
  },

  name: "marimo",
  defaultExt: ".qmd",
  defaultYaml: () => ["format: html", "engine: marimo"],
  defaultContent: () => [
    "```{python .marimo}",
    "import marimo as mo",
    "slider = mo.ui.slider(1, 10, 1)",
    "slider",
    "```",
  ],
  validExtensions: () => [".qmd", ".md"],

  claimsFile: (file: string, extension: string) => {
    if (![".qmd", ".md"].includes(extension.toLowerCase())) return false;
    try {
      return containsMarimoFence(Deno.readTextFileSync(file));
    } catch {
      return false;
    }
  },

  claimsLanguage: (language: string, firstClass?: string): boolean | number => {
    if (
      (language === "python" || language === "sql" ||
        language === "markdown") &&
      firstClass === "marimo"
    ) {
      return 2;
    }
    if (
      language === "python.marimo" ||
      language === "sql.marimo" ||
      language === "markdown.marimo" ||
      language === "marimo"
    ) {
      return 1;
    }
    return false;
  },

  canFreeze: false,
  generatesFigures: true,

  checkInstallation: async (configuration: CheckConfiguration) => {
    const report: Record<string, unknown> = {};
    if (configuration.jsonResult) {
      const render = (configuration.jsonResult.render ??= {}) as Record<
        string,
        unknown
      >;
      render.marimo = report;
    }
    const checkRender = async () => {
      const result = await quarto.system.checkRender({
        content: "```{python .marimo}\n1 + 1\n```\n",
        language: "python",
        services: configuration.services,
      });
      if (result.error) {
        if (configuration.jsonResult) {
          report.error = result.error.message;
          return;
        }
        throw result.error;
      }
      report.ok = true;
    };
    if (configuration.jsonResult) {
      await checkRender();
    } else {
      const message = "Checking marimo engine render...";
      await quarto.console.withSpinner(
        { message, doneMessage: `${message}OK\n` },
        checkRender,
      );
    }
  },

  launch: (_context: EngineProjectContext): ExecutionEngineInstance => ({
    name: marimoEngineDiscovery.name,
    canFreeze: marimoEngineDiscovery.canFreeze,

    markdownForFile(file: string): Promise<MappedString> {
      return Promise.resolve(quarto.mappedString.fromFile(file));
    },

    target: (
      file: string,
      _quiet?: boolean,
      markdown?: MappedString,
    ): Promise<ExecutionTarget | undefined> => {
      const source = markdown ?? quarto.mappedString.fromFile(file);
      return Promise.resolve({
        source: file,
        input: file,
        markdown: source,
        metadata: quarto.markdownRegex.extractYaml(source.value),
      });
    },

    partitionedMarkdown: (file: string) =>
      Promise.resolve(
        quarto.markdownRegex.partition(Deno.readTextFileSync(file)),
      ),

    execute: async (options: ExecuteOptions): Promise<ExecuteResult> => {
      const interactive = quarto.format.isHtmlCompatible(options.format);
      const extensionDir = dirname(fromFileUrl(import.meta.url));
      const canUsePageResources = interactive &&
        !Deno.env.get("QUARTO_MARIMO_DEBUG_ENDPOINT");
      const outputFile = outputFileMetadata(options);
      const resourcePaths = canUsePageResources
        ? pageResourcePaths(
          options.project.dir,
          options.target.input,
          outputFile,
        )
        : undefined;
      const request = {
        moduleUrl: import.meta.url,
        source: options.target.markdown.value,
        input: options.target.input,
        interactive,
        globalEval: options.target.metadata.eval !== false,
        externalEnv: options.target.metadata["external-env"] === true,
        pyproject: String(options.target.metadata.pyproject ?? ""),
        pageResourceDirectory: resourcePaths?.supportingDirectory,
      };
      const execution = await precompiledExecution(quarto, options, request) ??
        await runMarimoCompiler(quarto, request);
      const supporting: string[] = [];
      let resourceFiles: string[] | undefined;
      if (
        execution.kind === "page" && execution.cacheHydration &&
        resourcePaths &&
        execution.page.app
      ) {
        const manifest = JSON.parse(
          Deno.readTextFileSync(join(extensionDir, "runtime-patch.json")),
        ) as {
          version: string;
          mainFile: string;
          styleFile: string;
          workerPattern: string;
        };
        const runtimeDirectory = join(
          extensionDir,
          "assets",
          "runtime",
          "islands",
          manifest.version,
          "dist",
        );
        const runtimeMain = join(runtimeDirectory, manifest.mainFile);
        const mainSource = Deno.readTextFileSync(runtimeMain);
        const workerMatches = mainSource.match(
          new RegExp(manifest.workerPattern, "g"),
        ) ?? [];
        if (workerMatches.length !== 1) {
          throw new Error("pinned islands bundle has no unique Worker asset");
        }
        const runtimeWorker = join(
          runtimeDirectory,
          workerMatches[0].replace(/^\//, ""),
        );
        const runtimeStyle = join(runtimeDirectory, manifest.styleFile);
        await writeWorkerEntry(
          resourcePaths.supportingDirectory,
          runtimeWorker,
        );
        localizeRuntimeAssets(
          execution.page.app.assets,
          resourcePaths.outputDirectory,
          runtimeMain,
          runtimeStyle,
          manifest.version,
        );
        supporting.push(resourcePaths.supportingDirectory);
        resourceFiles = await runtimeResourceFiles(
          runtimeDirectory,
          resourcePaths.outputDirectory,
        );
      }
      const chunks = await quarto.markdownRegex.breakQuartoMd(
        options.target.markdown,
        false,
        false,
        MARIMO_CELL_REGEX,
      );
      const marimoCells = chunks.cells.filter(isMarimoCell);
      let externalPayload: string | undefined;
      if (execution.kind === "page" && resourcePaths) {
        await Deno.mkdir(resourcePaths.supportingDirectory, {
          recursive: true,
        });
        await Deno.writeTextFile(
          join(resourcePaths.supportingDirectory, "marimo.json"),
          JSON.stringify(execution.page),
        );
        if (!supporting.includes(resourcePaths.supportingDirectory)) {
          supporting.push(resourcePaths.supportingDirectory);
        }
        externalPayload = "./" +
          resourcePaths.supportingDirectory.split(/[\\/]/).pop() +
          "/marimo.json";
      }
      const projected = execution.kind === "page"
        ? await projectInteractivePage(
          execution.page,
          execution.buildOutputs,
          htmlToMarkdown,
          externalPayload,
        )
        : await projectStaticPage(execution.outputs, htmlToMarkdown);
      validateProjectionCount(projected, marimoCells.length);

      let index = 0;
      const markdown = chunks.cells
        .map((cell) =>
          isMarimoCell(cell)
            ? projected[index++] ?? ""
            : cell.sourceVerbatim.value
        )
        .join("");
      const includes: PandocIncludes = {};
      if (execution.kind === "page") {
        includes["include-in-header"] = [
          writeBrowserHeader(extensionDir, options.tempDir),
        ];
      }
      return {
        engine: "marimo",
        markdown,
        supporting,
        filters: [],
        includes,
        resourceFiles,
      };
    },

    dependencies: (
      _options: DependenciesOptions,
    ): Promise<DependenciesResult> => Promise.resolve({ includes: {} }),

    postprocess: (_options: PostProcessOptions): Promise<void> =>
      Promise.resolve(),
  }),
};

function outputFileMetadata(options: ExecuteOptions): string | undefined {
  const metadata = options.target.metadata as Record<string, unknown>;
  const targetOutput = metadata["output-file"];
  if (typeof targetOutput === "string" && targetOutput.trim()) {
    return targetOutput;
  }
  const render = options.format.render as Record<string, unknown>;
  const formatOutput = render["output-file"];
  return typeof formatOutput === "string" && formatOutput.trim()
    ? formatOutput
    : undefined;
}

async function htmlToMarkdown(html: string): Promise<string> {
  const result = await quarto.system.pandoc(
    ["-f", "html", "-t", "markdown"],
    html,
  );
  if (!result.success) {
    throw new Error(result.stderr || "Pandoc could not convert marimo HTML");
  }
  return result.stdout || "";
}

export default marimoEngineDiscovery;
