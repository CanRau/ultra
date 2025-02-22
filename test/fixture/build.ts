import { createBuilder } from "ultra/build.ts";

const builder = createBuilder({
  browserEntrypoint: import.meta.resolve("./client.tsx"),
  serverEntrypoint: import.meta.resolve("./server.tsx"),
});

builder.ignore("./README.md");

if (import.meta.main) {
  // deno-lint-ignore no-unused-vars
  const result = await builder.build();
}

export default builder;
