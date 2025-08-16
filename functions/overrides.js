// functions/overrides.js  (Netlify Functions v2)
import { getStore } from "@netlify/blobs";

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, x-admin-key",
      "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
      ...extra,
    },
  });

const ctEq = (a = "", b = "") => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  let ok = a.length === b.length;
  const L = Math.max(a.length, b.length);
  for (let i = 0; i < L; i++) ok &= (a.charCodeAt(i) || 0) === (b.charCodeAt(i) || 0);
  return !!ok;
};

export default async (req, context) => {
  if (req.method === "OPTIONS") return json({}, 204);

  // VAŽNO: v2 runtime – getStore radi bez siteID/token.
  const store = getStore("overrides");

  try {
    const url = new URL(req.url);
    const oneDate = url.searchParams.get("date");
    const method = req.method.toUpperCase();

    const ADMIN_KEY = process.env.NETLIFY_ADMIN_KEY ?? "";
    const adminConfigured = ADMIN_KEY.length > 0;
    const reqKey = req.headers.get("x-admin-key") || "";
    const isAdmin = adminConfigured && ctEq(reqKey, ADMIN_KEY);

    if (method === "GET") {
      if (oneDate) {
        const val = await store.get(oneDate, { type: "json" });
        return json({ [oneDate]: val || null });
      }
      // list all (sa paginacijom)
      const all = {};
      let cursor;
      do {
        const { blobs, cursor: next } = await store.list({ cursor });
        for (const b of blobs) {
          all[b.key] = await store.get(b.key, { type: "json" });
        }
        cursor = next;
      } while (cursor);
      return json(all);
    }

    if (method === "POST") {
      if (!adminConfigured) return json({ error: "Admin key not configured" }, 500);
      if (!isAdmin)        return json({ error: "Unauthorized" }, 401);

      let body = {};
      try { body = await req.json(); } catch {}
      if (!body?.date) return json({ error: "date required" }, 400);

      const rec = { closed: !!body.closed, start: null, end: null };
      if (!rec.closed) {
        if (!body.start || !body.end) return json({ error: "start/end required" }, 400);
        rec.start = body.start;
        rec.end   = body.end;
      }

      await store.set(body.date, rec, { type: "json" });
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
