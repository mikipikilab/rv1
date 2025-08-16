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

const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const isUS  = (s) => /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.test(s || "");

const toISO = (s) => {
  if (isISO(s)) return s;
  const m = (s || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, mm, dd, yy] = m;
    return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  const d = new Date(s || "");
  if (Number.isNaN(d.getTime())) return s;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};

const toUS = (iso) => {
  if (!isISO(iso)) return iso;
  return `${iso.slice(5,7)}/${iso.slice(8,10)}/${iso.slice(0,4)}`;
};

const ctEq = (a = "", b = "") => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  let ok = a.length === b.length;
  const L = Math.max(a.length, b.length);
  for (let i = 0; i < L; i++) ok &= (a.charCodeAt(i) || 0) === (b.charCodeAt(i) || 0);
  return !!ok;
};

export default async (req) => {
  if (req.method === "OPTIONS") return json({}, 204);

  const store = getStore("overrides");

  try {
    const url = new URL(req.url);
    const dateParam = url.searchParams.get("date");
    const method = req.method.toUpperCase();

    const ADMIN_KEY = process.env.NETLIFY_ADMIN_KEY ?? "";
    const adminConfigured = ADMIN_KEY.length > 0;
    const reqKey = req.headers.get("x-admin-key") || "";
    const isAdmin = adminConfigured && ctEq(reqKey, ADMIN_KEY);

    if (method === "GET") {
      if (dateParam) {
        const iso = toISO(dateParam);
        // 1) try ISO key
        let val = await store.get(iso, { type: "json" });
        // 2) try US fallback if not found
        if (val == null) {
          const usKey = toUS(iso);
          val = await store.get(usKey, { type: "json" });
        }
        return json({ [iso]: val ?? null });
      }

      // List all: normalize keys to ISO
      const out = {};
      let cursor;
      do {
        const { blobs, cursor: next } = await store.list({ cursor });
        for (const b of blobs) {
          const key = b.key;
          const iso = isISO(key) ? key : (isUS(key) ? toISO(key) : key);
          const current = await store.get(key, { type: "json" });
          // prefer already-existing ISO over US duplicate
          if (out[iso] == null) out[iso] = current;
        }
        cursor = next;
      } while (cursor);
      return json(out);
    }

    if (method === "POST") {
      if (!adminConfigured) return json({ error: "Admin key not configured" }, 500);
      if (!isAdmin)        return json({ error: "Unauthorized" }, 401);

      let body = {};
      try { body = await req.json(); } catch {}
      const iso = toISO(body?.date || "");
      if (!iso || !isISO(iso)) return json({ error: "date required" }, 400);

      const record = { closed: !!body.closed, start: null, end: null };
      if (!record.closed) {
        if (!body.start || !body.end) return json({ error: "start/end required" }, 400);
        record.start = body.start;
        record.end   = body.end;
      }

      // Save under ISO and clean up old US key if exists
      await store.set(iso, record, { type: "json" });
      const usKey = toUS(iso);
      if (await store.get(usKey) != null) {
        try { await store.delete(usKey); } catch {}
      }
      return json({ ok: true });
    }

    if (method === "DELETE") {
      if (!adminConfigured) return json({ error: "Admin key not configured" }, 500);
      if (!isAdmin)        return json({ error: "Unauthorized" }, 401);
      if (!dateParam)      return json({ error: "date required" }, 400);

      const iso = toISO(dateParam);
      const usKey = toUS(iso);
      // Delete both forms to be safe
      try { await store.delete(iso); } catch {}
      try { await store.delete(usKey); } catch {}
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (e) {
    console.error("overrides error:", e);
    return json({ error: e?.message || "Server error" }, 500);
  }
};
