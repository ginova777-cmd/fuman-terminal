"use strict";

const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function isMembershipProtected(result = {}) {
  const payload = result.payload || result.json || {};
  return result.status === 401 && payload?.protected === true && payload?.error === "membership_required";
}

function endpointAccessibleOrProtected(result = {}) {
  return Boolean(result.ok || isMembershipProtected(result));
}

function summarizeProtection(result = {}) {
  const payload = result.payload || result.json || {};
  return {
    status: result.status || 0,
    ok: Boolean(result.ok),
    protectedByMembership: isMembershipProtected(result),
    error: payload?.error || "",
    reason: payload?.reason || "",
    scope: payload?.scope || "",
    url: result.url || "",
  };
}

function createMockResponse() {
  const state = { statusCode: 200, headers: {}, payload: undefined, text: "" };
  const response = {
    setHeader(name, value) {
      state.headers[String(name).toLowerCase()] = value;
      return this;
    },
    status(code) {
      state.statusCode = Number(code) || 200;
      return this;
    },
    json(payload) {
      state.payload = payload;
      state.text = JSON.stringify(payload);
      return this;
    },
    end(body = "") {
      state.text = String(body || "");
      if (state.payload === undefined && state.text) {
        try {
          state.payload = JSON.parse(state.text);
        } catch {
          state.payload = state.text;
        }
      }
      return this;
    },
    get statusCode() {
      return state.statusCode;
    },
    set statusCode(value) {
      state.statusCode = Number(value) || state.statusCode;
    },
    _state: state,
  };
  return response;
}

async function callInternalApi(relativeApiPath, query = {}) {
  const modulePath = path.join(ROOT, relativeApiPath);
  delete require.cache[require.resolve(modulePath)];
  const handler = require(modulePath);
  const pathname = `/${relativeApiPath.replace(/\\/g, "/").replace(/^api\//, "api/")}`;
  const url = new URL(pathname, "http://localhost");
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });
  const request = {
    method: "GET",
    url: `${url.pathname}${url.search}`,
    query: Object.fromEntries(url.searchParams.entries()),
    headers: { host: "localhost", "x-internal-verify": "1" },
    fumanInternalVerify: true,
  };
  const response = createMockResponse();
  await handler(request, response);
  return {
    ok: response.statusCode >= 200 && response.statusCode < 300,
    status: response.statusCode,
    payload: response._state.payload,
    text: response._state.text,
    internalVerify: true,
    modulePath,
  };
}

function collectRunIds(text, pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  return [...new Set([...String(text || "").matchAll(re)].map((match) => match[0]))];
}

function summarizeLatestPayload(payload = {}) {
  const quality = payload.run_quality_at_publish || {};
  return {
    runId: payload.runId || payload.latestRunId || "",
    ok: payload.ok,
    status: payload.status || "",
    qualityStatus: payload.qualityStatus || "",
    publishAllowed: payload.publishAllowed ?? quality.publishAllowed,
    evidenceStatus: payload.evidenceStatus || payload.sourceEvidenceStatus || "",
    unattendedStatus: payload.unattendedStatus || payload.unattended?.status || "",
    fallbackUsed: payload.fallbackUsed,
    count: payload.count ?? payload.total ?? null,
    resultCount: payload.resultCount ?? quality.resultCount ?? null,
    readbackCount: payload.readbackCount ?? quality.readbackCount ?? null,
    sourceSnapshotCapturedAt: payload.source_snapshot_captured_at || "",
  };
}

module.exports = {
  ROOT,
  isMembershipProtected,
  endpointAccessibleOrProtected,
  summarizeProtection,
  callInternalApi,
  collectRunIds,
  summarizeLatestPayload,
};
