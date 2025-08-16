// functions/repair.js
// Utility endpoint to inspect and clean invalid blob records in "overrides" store.
// WARNING: Keep temporarily, then remove after cleaning.
import { getStore } from "@netlify/blobs";

const json = (data, status = 200) => ({
  statusCode: status,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  },
  body: JSON.stringify(data),
});

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const handler = async (event) => {
  const store = getStore("overrides");
  const mode = (event?.queryStringParameters?.mode || "list").toLowerCase();
  const out = { mode, touched: [] };

  let cursor;
  do {
    const { blobs, cursor: next } = await store.list({ cursor });
    for (const b of blobs) {
      if (mode === "list") {
        let ok = ISO.test(b.key);
        out.touched.push({ key: b.key, iso: ok });
      } else if (mode === "clean") {
        // delete any non-ISO keys OR values that are invalid JSON strings
        let bad = !ISO.test(b.key);
        if (!bad) {
          try {
            const v = await store.get(b.key, { type: "json" });
            if (!(v && typeof v === "object" && ("closed" in v))) bad = true;
          } catch (e) {
            bad = true;
          }
        }
        if (bad) {
          await store.delete(b.key);
          out.touched.push({ key: b.key, deleted: true });
        }
      }
    }
    cursor = next;
  } while (cursor);

  return json(out);
};