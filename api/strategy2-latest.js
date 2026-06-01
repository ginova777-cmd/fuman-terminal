const SUPABASE_URL = process.env.SUPABASE_URL || "https://jxnqyqnigsppqsxinlrq.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || "sb_publishable_kCocRYzO4oCBnFRQO_pfvg_JZUl0oxm";

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");

  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  try {
    const base = String(SUPABASE_URL || "").replace(/\/+$/, "");
    if (!base || !SUPABASE_KEY) {
      response.status(500).json({ ok: false, error: "supabase_not_configured" });
      return;
    }
    const url = `${base}/rest/v1/strategy2_latest?id=eq.latest&select=payload,updated_at&limit=1`;
    const upstream = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: "application/json",
      },
    });
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      response.status(upstream.status).json({
        ok: false,
        error: "supabase_fetch_failed",
        status: upstream.status,
        detail: text.slice(0, 200),
      });
      return;
    }
    const rows = await upstream.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row?.payload) {
      response.status(404).json({ ok: false, error: "strategy2_latest_empty" });
      return;
    }
    response.status(200).json({
      ...row.payload,
      updatedAt: row.payload.updatedAt || row.updated_at,
      cacheSource: "supabase-api",
      transport: {
        source: "supabase",
        via: "api/strategy2-latest",
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    response.status(500).json({ ok: false, error: error?.message || String(error) });
  }
};
