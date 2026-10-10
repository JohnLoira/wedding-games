// Pulls every pin still cached on the relay (12 hours) and folds it into map/pins.json,
// so the map keeps its pins long after the relay forgets them. Run by the hourly GitHub Action.
import { readFileSync, writeFileSync } from "node:fs";

const cfg = readFileSync(new URL("../map/config.js", import.meta.url), "utf8");
const topic = (cfg.match(/topic:\s*"([^"]+)"/) || [])[1];
if (!topic) throw new Error("No topic in map/config.js");

const file = new URL("../map/pins.json", import.meta.url);
const db = JSON.parse(readFileSync(file, "utf8"));
const pins = new Map(db.pins.map(p => [p.id, p]));
const removed = new Set(db.removed || []);

const res = await fetch(`https://ntfy.sh/${topic}/json?poll=1&since=all`);
if (!res.ok) throw new Error(`relay ${res.status}`);
const text = await res.text();
let added = 0, dropped = 0;
for (const line of text.split("\n")) {
  if (!line.trim()) continue;
  let env, body;
  try { env = JSON.parse(line); body = JSON.parse(env.message); } catch { continue; }
  if (env.event !== "message" || !body || typeof body.id !== "string") continue;
  if (body.t === "pin" && !removed.has(body.id) && !pins.has(body.id)) {
    const { id, name, city, line: how, lat, lng, side, ts } = body;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    pins.set(id, { id, name: String(name || "").slice(0, 40), city: String(city || "").slice(0, 80), line: String(how || "").slice(0, 160), lat, lng, side: side || "", ts: ts || env.time * 1000 });
    added++;
  } else if (body.t === "remove" && pins.has(body.id)) {
    pins.delete(body.id); removed.add(body.id); dropped++;
  }
}
const out = { pins: [...pins.values()].sort((a, b) => a.ts - b.ts), removed: [...removed], archivedAt: new Date().toISOString() };
const changed = JSON.stringify({ pins: out.pins, removed: out.removed }) !== JSON.stringify({ pins: db.pins, removed: db.removed || [] });
if (changed) writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(`pins: ${out.pins.length} (+${added} -${dropped}) ${changed ? "written" : "unchanged"}`);
