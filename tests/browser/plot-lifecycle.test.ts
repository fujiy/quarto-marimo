import { assertEquals } from "@std/assert";

const manifest = JSON.parse(
  await Deno.readTextFile(
    new URL("../../_extensions/marimo/runtime-patch.json", import.meta.url),
  ),
);

Deno.test("Plotly hydration waits for layout before replacing or purging a plot", async () => {
  const events: string[] = [];
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const queue = { current: Promise.resolve() };
  const plotly = {
    default: {
      react: async (_element: object, data: string) => {
        events.push(`start:${data}`);
        if (data === "initial") await pending;
        events.push(`end:${data}`);
      },
      addFrames: () => {
        events.push("frames");
      },
      purge: () => {
        events.push("purge");
      },
    },
  };
  // Execute the actual guarded replacement with a delayed Plotly renderer.
  const render = new Function(
    "queue",
    "e",
    "i",
    "n",
    "r",
    "u",
    "d",
    "g",
    manifest.plotReplacements[1].replacement,
  );
  const purge = new Function(
    "queue",
    "e",
    "i",
    manifest.plotReplacements[2].replacement,
  );
  const element = {};
  const onError = (error: unknown) => {
    throw error;
  };
  const cleanup = render(
    queue,
    element,
    plotly,
    "initial",
    {},
    {},
    [1],
    onError,
  );
  await Promise.resolve();
  cleanup();
  const cancelObsolete = render(
    queue,
    element,
    plotly,
    "obsolete",
    {},
    {},
    [],
    onError,
  );
  cancelObsolete();
  render(queue, element, plotly, "latest", {}, {}, [1], onError);
  purge(queue, element, plotly);
  assertEquals(events, ["start:initial"]);
  finish();
  await queue.current;
  assertEquals(events, [
    "start:initial",
    "end:initial",
    "start:latest",
    "end:latest",
    "frames",
    "purge",
  ]);
});

Deno.test("Plotly event registration waits for plot initialization and cancels on unmount", async () => {
  let initialized!: () => void;
  const queue = {
    current: new Promise<void>((resolve) => {
      initialized = resolve;
    }),
  };
  const events: string[] = [];
  const element: {
    on?: (name: string, handler: unknown) => void;
    removeListener?: (name: string, handler: unknown) => void;
  } = {};
  const subscribe = new Function(
    "queue",
    "n",
    "e",
    "s",
    "c",
    "l",
    "g",
    manifest.plotReplacements[3].replacement,
  );
  const cleanup = subscribe(
    queue,
    element,
    { onClick() {} },
    ["Click"],
    (x: string) => `on${x}`,
    (x: string) => x,
    (error: unknown) => {
      throw error;
    },
  );
  element.on = (name) => {
    events.push(`on:${name}`);
  };
  element.removeListener = (name) => {
    events.push(`off:${name}`);
  };
  initialized();
  await queue.current;
  cleanup();
  assertEquals(events, ["on:Click", "off:Click"]);
  const cancel = subscribe(
    queue,
    {},
    { onClick() {} },
    ["Click"],
    (x: string) => `on${x}`,
    (x: string) => x,
    (error: unknown) => {
      throw error;
    },
  );
  cancel();
  await queue.current;
});
