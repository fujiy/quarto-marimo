import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "path";

export type PageResourcePaths = {
  outputDirectory: string;
  outputFile: string;
  supportingDirectory: string;
  supportingPath: string;
};

export function pageResourcePaths(
  projectDirectory: string,
  inputFile: string,
  outputFile?: string,
): PageResourcePaths {
  const project = resolve(projectDirectory);
  const input = resolve(inputFile);
  const inputRelative = relative(project, input);
  if (
    isAbsolute(inputRelative) || inputRelative === ".." ||
    inputRelative.startsWith(`..${Deno.build.os === "windows" ? "\\" : "/"}`)
  ) {
    throw new Error("marimo page input must be inside the Quarto project");
  }

  const pageOutput = outputFile
    ? resolve(dirname(input), outputFile)
    : input.slice(0, -extname(input).length) + ".html";
  const pageRelative = relative(project, pageOutput);
  if (
    isAbsolute(pageRelative) || pageRelative === ".." ||
    pageRelative.startsWith(`..${Deno.build.os === "windows" ? "\\" : "/"}`)
  ) {
    throw new Error("marimo page output must be inside the Quarto project");
  }

  const outputDirectory = dirname(pageOutput);
  const outputStem = basename(pageOutput, extname(pageOutput));
  const supportingDirectory = join(outputDirectory, `${outputStem}_files`);
  return {
    outputDirectory,
    outputFile: pageOutput,
    supportingDirectory,
    supportingPath: relative(project, supportingDirectory),
  };
}

export function relativeAssetUrl(
  fromDirectory: string,
  toFile: string,
): string {
  const path = relative(fromDirectory, toFile).split("\\").join("/");
  return path.startsWith(".") ? path : `./${path}`;
}

export async function writeWorkerEntry(
  supportingDirectory: string,
  runtimeWorkerFile: string,
): Promise<string> {
  const assetsDirectory = join(supportingDirectory, "assets");
  await Deno.mkdir(assetsDirectory, { recursive: true });
  const entryPath = join(assetsDirectory, "quarto-marimo-worker.js");
  const importUrl = relativeAssetUrl(assetsDirectory, runtimeWorkerFile);
  const contents = [
    "// Keep this a static import so the bridge's first RPC cannot race Worker setup.",
    `import ${JSON.stringify(importUrl)};`,
    "",
  ].join("\n");
  const temporary = `${entryPath}.${crypto.randomUUID()}.tmp`;
  try {
    await Deno.writeTextFile(temporary, contents);
    await Deno.rename(temporary, entryPath);
  } finally {
    await Deno.remove(temporary).catch(() => undefined);
  }
  return entryPath;
}

export async function runtimeResourceFiles(
  runtimeDirectory: string,
  pageDirectory: string,
): Promise<string[]> {
  const files: string[] = [];
  async function collect(directory: string): Promise<void> {
    for await (const entry of Deno.readDir(directory)) {
      const path = join(directory, entry.name);
      if (entry.isDirectory) {
        await collect(path);
      } else if (entry.isFile) {
        files.push(path);
      }
    }
  }
  await collect(runtimeDirectory);
  // Quarto resolves ExecuteResult.resourceFiles from the rendered page directory.
  return files.map((file) => relative(pageDirectory, file));
}

export function localizeRuntimeAssets(
  assets: {
    moduleScripts: string[];
    links: Record<string, string>[];
    version?: string;
  },
  pageDirectory: string,
  mainFile: string,
  styleFile: string,
  expectedVersion: string,
): void {
  if (assets.version !== expectedVersion) {
    throw new Error(
      `quarto-marimo-server supports marimo ${expectedVersion}; found ${
        assets.version ?? "unknown"
      }`,
    );
  }
  const mainScripts = assets.moduleScripts.filter((source) => {
    try {
      const url = new URL(source, "https://marimo.invalid/");
      return url.pathname.endsWith("/main.js");
    } catch {
      return false;
    }
  });
  if (mainScripts.length !== 1 || assets.moduleScripts.length !== 1) {
    throw new Error("unsupported marimo islands runtime module list");
  }
  assets.moduleScripts = [relativeAssetUrl(pageDirectory, mainFile)];

  const styles = assets.links.filter((link) => {
    try {
      const url = new URL(link.href ?? "", "https://marimo.invalid/");
      return url.pathname.endsWith("/style.css");
    } catch {
      return false;
    }
  });
  if (styles.length !== 1) {
    throw new Error("unsupported marimo islands stylesheet list");
  }
  styles[0].href = relativeAssetUrl(pageDirectory, styleFile);
}
