import { join, posix } from "node:path";

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const SHELL_CACHE = "no-cache";

export type WebServer = {
  fetch(request: Request): Promise<Response>;
};

export type WebConfig = {
  root: string;
  port: number;
};

export function readWebConfig(env: Record<string, string | undefined>): WebConfig {
  const port = Number(env.WEB_PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`WEB_PORT must be a whole number between 1 and 65535, got ${env.WEB_PORT}`);
  }
  return { root: env.WEB_ROOT ?? join(import.meta.dir, "../dist"), port };
}

function resolveWithin(root: string, pathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0")) return undefined;
  const relative = posix.normalize(decoded.replaceAll("\\", "/").replace(/^\/+/, ""));
  if (relative === ".." || relative.startsWith("../")) return undefined;
  return join(root, relative);
}

function isAssetPath(pathname: string): boolean {
  return pathname.startsWith("/assets/");
}

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" },
  });
}

function fileResponse(file: Bun.BunFile, method: string, cacheControl: string): Response {
  return new Response(method === "HEAD" ? null : file, {
    headers: {
      "cache-control": cacheControl,
      "content-length": String(file.size),
      "content-type": file.type,
      "x-content-type-options": "nosniff",
    },
  });
}

// Serves the Vite build: hashed assets get an immutable cache, every other
// path falls back to index.html so the client router owns the URL.
export function createWebServer(root: string): WebServer {
  const shell = join(root, "index.html");

  return {
    async fetch(request) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" },
        });
      }

      const { pathname } = new URL(request.url);
      const path = resolveWithin(root, pathname);
      if (path === undefined) return notFound();

      const file = Bun.file(path);
      if (await file.exists()) {
        return fileResponse(
          file,
          request.method,
          isAssetPath(pathname) ? IMMUTABLE_CACHE : SHELL_CACHE,
        );
      }

      const wantsAsset = isAssetPath(pathname) || posix.extname(pathname) !== "";
      if (wantsAsset) return notFound();

      const index = Bun.file(shell);
      if (await index.exists()) return fileResponse(index, request.method, SHELL_CACHE);
      return notFound();
    },
  };
}

if (import.meta.main) {
  const config = readWebConfig(process.env);
  const server = Bun.serve({ port: config.port, fetch: createWebServer(config.root).fetch });
  console.log(`web listening on ${server.url} (serving ${config.root})`);
}
