"use strict";

const buckets = new Map();

function header(request, name) {
  const headers = request?.headers || {};
  const lower = name.toLowerCase();
  if (typeof headers.get === "function") return headers.get(name) || headers.get(lower) || "";
  return headers[name] || headers[lower] || "";
}

function requestIp(request) {
  const forwarded = String(header(request, "x-forwarded-for") || "").split(",")[0].trim();
  return forwarded || String(header(request, "x-real-ip") || request?.socket?.remoteAddress || "unknown").trim();
}

function rateLimitRequest(request, response, options = {}) {
  const windowMs = Math.max(1000, Number(options.windowMs || 60_000));
  const max = Math.max(1, Number(options.max || 90));
  const key = `${options.scope || "api"}:${requestIp(request)}`;
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (response?.setHeader) {
      response.setHeader("X-RateLimit-Limit", String(max));
      response.setHeader("X-RateLimit-Remaining", String(max - 1));
    }
    return { ok: true, key, remaining: max - 1 };
  }
  bucket.count += 1;
  const remaining = Math.max(0, max - bucket.count);
  if (response?.setHeader) {
    response.setHeader("X-RateLimit-Limit", String(max));
    response.setHeader("X-RateLimit-Remaining", String(remaining));
    response.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
  }
  if (bucket.count <= max) return { ok: true, key, remaining };
  if (response?.setHeader) response.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
  return { ok: false, key, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
}

function sendRateLimited(response, scope, result) {
  return response.status(429).json({
    ok: false,
    protected: true,
    error: "rate_limited",
    reason: "too_many_requests",
    scope,
    retryAfterSeconds: result?.retryAfterSeconds || 1,
  });
}

module.exports = { rateLimitRequest, sendRateLimited, _buckets: buckets };
