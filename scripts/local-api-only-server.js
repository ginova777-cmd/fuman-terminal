const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const root = path.resolve(__dirname, "..");
const host = process.env.FUMAN_LOCAL_HOST || "127.0.0.1";
const port = Number(process.env.FUMAN_LOCAL_PORT || process.env.PORT || 8787);
const proxyApiTo = String(process.env.FUMAN_LOCAL_PROXY_API_TO || "").replace(/\/+$/, "");

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".ico", "image/x-icon"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".webp", "image/webp"],
  [".txt", "text/plain; charset=utf-8"],
]);

function queryObject(searchParams) {
  const out = {};
  for (const [key, value] of searchParams.entries()) {
    if (out[key] === undefined) out[key] = value;
    else if (Array.isArray(out[key])) out[key].push(value);
    else out[key] = [out[key], value];
  }
  return out;
}

function attachVercelResponseHelpers(response) {
  if (!response.status) {
    response.status = function status(code) {
      response.statusCode = Number(code) || 200;
      return response;
    };
  }
  if (!response.json) {
    response.json = function json(payload) {
      if (!response.headersSent) {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
      }
      response.end(JSON.stringify(payload));
      return response;
    };
  }
  if (!response.send) {
    response.send = function send(payload) {
      if (Buffer.isBuffer(payload) || typeof payload === "string") response.end(payload);
      else response.json(payload);
      return response;
    };
  }
}

function safeStaticPath(pathname) {
  const decoded = decodeURIComponent(pathname.split("?")[0]);
  const normalized = decoded === "/" ? "/index.html" : decoded;
  const file = path.resolve(root, "." + normalized.replace(/\\/g, "/"));
  return file.startsWith(root + path.sep) || file === root ? file : null;
}

async function handleApi(request, response, parsedUrl) {
  if (proxyApiTo) {
    await proxyApi(request, response, parsedUrl);
    return;
  }
  const apiName = parsedUrl.pathname.replace(/^\/api\//, "").replace(/\/+$/, "");
  if (!/^[a-zA-Z0-9._-]+$/.test(apiName)) {
    response.statusCode = 404;
    response.end("not found");
    return;
  }
  const handlerFile = path.join(root, "api", `${apiName}.js`);
  if (!fs.existsSync(handlerFile)) {
    response.statusCode = 404;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ ok: false, error: "api_not_found", endpoint: `/api/${apiName}` }));
    return;
  }
  attachVercelResponseHelpers(response);
  request.query = queryObject(parsedUrl.searchParams);
  request.cookies = {};
  try {
    delete require.cache[require.resolve(handlerFile)];
    const handler = require(handlerFile);
    await handler(request, response);
    if (!response.writableEnded) response.end();
  } catch (error) {
    if (!response.headersSent) {
      response.statusCode = 500;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
    }
    if (!response.writableEnded) {
      response.end(JSON.stringify({ ok: false, error: error?.message || String(error) }));
    }
  }
}

async function proxyApi(request, response, parsedUrl) {
  const target = new URL(`${parsedUrl.pathname}${parsedUrl.search}`, proxyApiTo);
  try {
    const upstream = await fetch(target, {
      headers: {
        Accept: request.headers.accept || "application/json",
        "User-Agent": "fuman-local-api-only-proxy",
      },
    });
    response.statusCode = upstream.status;
    for (const header of ["content-type", "cache-control"]) {
      const value = upstream.headers.get(header);
      if (value) response.setHeader(header, value);
    }
    response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    response.statusCode = 502;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ ok: false, error: "local_api_proxy_failed", message: error?.message || String(error) }));
  }
}

function serveStatic(response, file) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.statusCode = 404;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end("not found");
    return;
  }
  const ext = path.extname(file).toLowerCase();
  response.setHeader("Content-Type", mimeTypes.get(ext) || "application/octet-stream");
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  fs.createReadStream(file).pipe(response);
}

const server = http.createServer(async (request, response) => {
  const parsedUrl = new URL(request.url || "/", `http://${host}:${port}`);
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }
  if (parsedUrl.pathname.startsWith("/api/")) {
    await handleApi(request, response, parsedUrl);
    return;
  }
  serveStatic(response, safeStaticPath(parsedUrl.pathname));
});

server.listen(port, host, () => {
  console.log(`[local-api-only] listening http://${host}:${port}`);
  console.log(`[local-api-only] root ${root}`);
  if (proxyApiTo) console.log(`[local-api-only] proxy API to ${proxyApiTo}`);
});
