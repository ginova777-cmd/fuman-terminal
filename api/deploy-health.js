module.exports = async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA || "";
  response.status(200).json({
    ok: true,
    service: "fuman-terminal",
    commitSha,
    shortSha: commitSha ? commitSha.slice(0, 7) : "",
    branch: process.env.VERCEL_GIT_COMMIT_REF || "",
    deploymentUrl: process.env.VERCEL_URL || "",
    checkedAt: new Date().toISOString(),
  });
};
