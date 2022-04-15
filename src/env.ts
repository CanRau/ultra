export const isDev = Deno.env.get("mode") === "dev";
export const port = Deno.env.get("port") || 8000;
export const sourceDirectory = Deno.env.get("source") || "src";
export const vendorDirectory = Deno.env.get("vendor") || "x";
export const root = Deno.env.get("root") || `http://localhost:${port}`;
export const lang = Deno.env.get("lang") || "en";
export const disableStreaming = Deno.env.get("disableStreaming") || 0;
