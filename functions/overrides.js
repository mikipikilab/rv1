import { getStore } from "@netlify/blobs";

const json = (data, status = 200) => ({
  statusCode: status,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-key",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  },
  body: JSON.stringify(data),
});

const getHeader = (headers, name) => {
  if (!headers) return "";
  const k = Object.keys(headers).find(h => h.toLowerCase() === name.toLowerCase());
  return k ? headers[k] : "";
};

const ctEq = (a = "", b = "") => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  let ok = a.length === b.length;
  const L = Math.max(a.length, b.length);
  for (let i = 0; i < L; i++) ok &= (a.charCodeAt(i)||0) === (b.charCodeAt(i)||0);
  return !!ok;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

async function getJsonSafe(store, key) {
  try {
    return await store.get(key, { type: "json" });
  } catch (e) {
    try {
      const txt = await store.get(key, { type: "text" });
      if (typeof txt === "string" && txt.trim()) {
        try { return JSON.parse(txt); } catch {}
      }
    } catch {}
    return null;
  }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json({}, 204);

  const ADMIN_KEY = process.env.NETLIFY_ADMIN_KEY ?? "";
  const adminConfigured = ADMIN_KEY.length > 0;
  const method = (event.httpMethod || "GET").toUpperCase();
  const store = getStore("overrides");

  const params = event?.queryStringParameters || {};
  let oneDate = params.date || null;
  if (!oneDate && event.rawUrl) { try { oneDate = new URL(event.rawUrl).searchParams.get("date"); } catch {} }
  if (oneDate && !ISO.test(oneDate)) return json({ error: "invalid date" }, 400);

  const reqKey = getHeader(event.headers, "x-admin-key");
  const isAdmin = adminConfigured && ctEq(reqKey, ADMIN_KEY);

  try {
    if (method === "GET") {
      if (oneDate) {
        const val = await getJsonSafe(store, oneDate);
        return json({ [oneDate]: val ?? null });
      }
      const all = {};
      let cursor;
      do {
        const { blobs, cursor: next } = await store.list({ cursor });
        for (const b of blobs) {
          if (!ISO.test(b.key)) continue; // ignoriši loše ključeve
          const v = await getJsonSafe(store, b.key);
          if (v && typeof v === "object" && ("closed" in v)) all[b.key] = v;
        }
        cursor = next;
      } while (cursor);
      return json(all);
    }

    if (method === "POST") {
      if (!adminConfigured) return json({ error: "Admin key not configured" }, 500);
      if (!isAdmin)        return json({ error: "Unauthorized" }, 401);

      const body = JSON.parse(event.body || "{}");
      const date = body?.date;
      if (!date || !ISO.test(date)) return json({ error: "date required" }, 400);

      const rec = { closed: !!body.closed };
      if (!rec.closed) {
        if (!body.start || !body.end) return json({ error: "start/end required" }, 400);
        rec.start = String(body.start);
        rec.end   = String(body.end);
      }
      await store.set(date, rec, { type: "json" });
      return json({ ok: true });
    }

    if (method === "DELETE") {
      if (!adminConfigured) return json({ error: "Admin key not configured" }, 500);
      if (!isAdmin)        return json({ error: "Unauthorized" }, 401);
      if (!oneDate)        return json({ error: "date required" }, 400);

      await store.delete(oneDate);
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (e) {
    console.error("overrides error:", e);
    return json({ error: e?.message || "Server error" }, 500);
  }
};
