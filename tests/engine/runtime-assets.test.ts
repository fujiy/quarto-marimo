import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";

import {
  localizeRuntimeAssets,
  pageResourcePaths,
  relativeAssetUrl,
  runtimeResourceFiles,
  writeWorkerEntry,
} from "../../src/engine/runtime-assets.ts";

Deno.test("page resource directories preserve root and nested output paths", () => {
  const root = pageResourcePaths("/project", "/project/index.qmd");
  const nested = pageResourcePaths("/project", "/project/nested/index.qmd");

  assertEquals(root.supportingPath, "index_files");
  assertEquals(nested.supportingPath, "nested/index_files");
});

Deno.test("a custom output file determines the Quarto resource directory", () => {
  const page = pageResourcePaths(
    "/project",
    "/project/source.qmd",
    "published/result.html",
  );

  assertEquals(page.supportingPath, "published/result_files");
  assertEquals(page.outputFile, "/project/published/result.html");
});

Deno.test("Worker entry uses a page-relative static import", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const entry = await writeWorkerEntry(
      `${directory}/nested/index_files`,
      `${directory}/_extensions/marimo/runtime/dist/assets/worker-a.js`,
    );
    const source = await Deno.readTextFile(entry);

    assertStringIncludes(
      source,
      'import "../../../_extensions/marimo/runtime/dist/assets/worker-a.js";',
    );
    assertEquals(source.includes("import("), false);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("runtime URLs are relative to each output page", () => {
  assertEquals(
    relativeAssetUrl("/project/nested", "/project/_extensions/marimo/main.js"),
    "../_extensions/marimo/main.js",
  );
});

Deno.test(
  "runtime resources are relative to root and nested page directories",
  async () => {
    const directory = await Deno.makeTempDir();
    try {
      const runtime = `${directory}/_extensions/marimo/runtime/dist`;
      await Deno.mkdir(runtime, { recursive: true });
      await Deno.writeTextFile(`${runtime}/main.js`, "runtime");

      assertEquals(await runtimeResourceFiles(runtime, directory), [
        "_extensions/marimo/runtime/dist/main.js",
      ]);
      assertEquals(await runtimeResourceFiles(runtime, `${directory}/nested`), [
        "../_extensions/marimo/runtime/dist/main.js",
      ]);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test("runtime asset localization checks the pinned version and asset shape", () => {
  const assets = {
    moduleScripts: [
      "https://cdn.jsdelivr.net/npm/@marimo-team/islands@0.23.16/dist/main.js",
    ],
    links: [{
      rel: "stylesheet",
      href:
        "https://cdn.jsdelivr.net/npm/@marimo-team/islands@0.23.16/dist/style.css",
    }],
    version: "0.23.16",
  };
  localizeRuntimeAssets(
    assets,
    "/project/nested",
    "/project/_extensions/marimo/main.js",
    "/project/_extensions/marimo/style.css",
    "0.23.16",
  );
  assertEquals(assets.moduleScripts, ["../_extensions/marimo/main.js"]);
  assertEquals(assets.links[0].href, "../_extensions/marimo/style.css");

  assertThrows(
    () =>
      localizeRuntimeAssets(assets, "/", "/main.js", "/style.css", "0.23.17"),
    Error,
    "supports marimo 0.23.17",
  );
});
