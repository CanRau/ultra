import { serve } from "https://deno.land/std@0.153.0/http/server.ts";
import { StaticRouter } from "react-router-dom/server";
import { createServer } from "ultra/server.ts";
import App from "./src/app.tsx";

const server = await createServer({
  importMapPath: import.meta.resolve("./importMap.json"),
  browserEntrypoint: import.meta.resolve("./client.tsx"),
});

server.get("*", async (context) => {
  /**
   * Render the request
   */
  const result = await server.render(
    <StaticRouter location={new URL(context.req.url).pathname}>
      <App />
    </StaticRouter>,
  );

  return context.body(result, 200, {
    "content-type": "text/html",
  });
});

serve(server.fetch);
