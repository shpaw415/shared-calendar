// shared-calendar — serveur de la page dashboard (Bun).
// API REST du calendrier partagé + UI. Même fichier de données et même verrou
// que le CLI ob-plugin-shared-calendar-cal (contrat inter-plugins).
import { openSync, writeSync, closeSync, unlinkSync, mkdirSync, statSync, readFileSync, renameSync } from "node:fs";

const PLUGIN_ID = process.env.OPEN_BOT_PLUGIN_ID || "shared-calendar";
const DATA_DIR = `/home/agent/.open-bot/pages-data/${PLUGIN_ID}`;
const DATA_FILE = `${DATA_DIR}/events.json`;
const LOCK_FILE = `${DATA_DIR}/events.lock`;
const LOCK_RETRY_MS = 5000;
const LOCK_STALE_MS = 10000;
const TOKEN = process.env.OPEN_BOT_PAGE_TOKEN || "";

const COULEURS = {
  manuel: "#6366f1",
  "fb-message-guardian": "#3b82f6",
  "price-scout": "#22c55e",
  "prompt-shield": "#f59e0b",
};
const PALETTE = ["#6366f1", "#3b82f6", "#22c55e", "#f59e0b", "#ec4899", "#14b8a6", "#eab308", "#a855f7"];

// ---------- verrou (même protocole que le CLI Python : O_EXCL + stale) ----------
async function withLock(fn) {
  mkdirSync(DATA_DIR, { recursive: true });
  const deadline = Date.now() + LOCK_RETRY_MS;
  for (;;) {
    try {
      const fd = openSync(LOCK_FILE, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try {
        if (Date.now() - statSync(LOCK_FILE).mtimeMs > LOCK_STALE_MS) unlinkSync(LOCK_FILE);
      } catch (_) { /* disparu, on retente */ }
      if (Date.now() > deadline) throw new Error("calendrier occupé (verrou)");
      await sleep(50);
    }
  }
  try {
    return fn();
  } finally {
    try { unlinkSync(LOCK_FILE); } catch (_) {}
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadData() {
  try {
    const d = JSON.parse(readFileSync(DATA_FILE, "utf8"));
    if (!Array.isArray(d.events)) d.events = [];
    return d;
  } catch (_) {
    return { events: [] };
  }
}
function saveData(d) {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + ".tmp";
  writeSync(openSync(tmp, "w"), JSON.stringify(d, null, 1));
  renameSync(tmp, DATA_FILE); // rename atomique
}

// ---------- validation (miroir du CLI) ----------
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RE_TIME = /^\d{2}:\d{2}$/;
const RE_COLOR = /^#[0-9a-fA-F]{6}$/;

function couleurSource(source) {
  if (COULEURS[source]) return COULEURS[source];
  let h = 0;
  for (const c of source) h += c.charCodeAt(0);
  return PALETTE[h % PALETTE.length];
}

function valider(e) {
  const titre = String(e.titre ?? "").trim();
  if (!titre) throw new Error("titre requis");
  if (titre.length > 200) throw new Error("titre trop long (200 max)");
  const desc = String(e.desc ?? "").trim();
  if (desc.length > 2000) throw new Error("description trop longue (2000 max)");
  for (const k of ["d1", "d2"]) {
    if (!RE_DATE.test(e[k] || "")) throw new Error(`${k} doit être une date AAAA-MM-JJ`);
  }
  for (const k of ["h1", "h2"]) {
    if (e[k] && !RE_TIME.test(e[k])) throw new Error(`${k} doit être une heure HH:MM`);
  }
  const debut = e.d1 + "T" + (e.h1 || "00:00");
  const fin = e.d2 + "T" + (e.h2 || "23:59");
  if (fin < debut) throw new Error("la fin doit être après ou égale au début");
  const source = String(e.source || "manuel").trim() || "manuel";
  if (source.length > 40) throw new Error("source trop longue (40 max)");
  // Même règle que le CLI : date seule (aucune heure) = journée entière
  const allDay = !!e.allDay || (!e.h1 && !e.h2);
  const couleur = e.couleur || couleurSource(source);
  if (!RE_COLOR.test(couleur)) throw new Error("couleur doit être #rrggbb");
  return {
    titre,
    desc,
    d1: e.d1,
    h1: allDay ? null : e.h1 || null,
    d2: e.d2,
    h2: allDay ? null : e.h2 || null,
    allDay,
    source,
    couleur,
  };
}

function newId() {
  return "evt_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
}

// ---------- routes ----------
async function handleApi(req, url) {
  // Vérif douce du token : rejet seulement si un token est fourni et faux.
  if (TOKEN) {
    const got = req.headers.get("x-open-bot-page-token");
    if (got && got !== TOKEN) return jsonRes({ ok: false, erreur: "token invalide" }, 403);
  }

  if (url.pathname === "/api/events" && req.method === "GET") {
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    const source = url.searchParams.get("source") || "";
    const q = (url.searchParams.get("q") || "").toLowerCase();
    return withLock(() => {
      let evs = loadData().events;
      if (from) evs = evs.filter((e) => (e.d2 + "T" + (e.h2 || "23:59")) >= from + "T00:00");
      if (to) evs = evs.filter((e) => (e.d1 + "T" + (e.h1 || "00:00")) <= to + "T23:59");
      if (source) evs = evs.filter((e) => e.source === source);
      if (q) evs = evs.filter((e) => (e.titre + " " + (e.desc || "")).toLowerCase().includes(q));
      evs = [...evs].sort((a, b) => (a.d1 + "T" + (a.h1 || "00:00")).localeCompare(b.d1 + "T" + (b.h1 || "00:00")));
      return jsonRes({ ok: true, count: evs.length, events: evs });
    });
  }

  if (url.pathname === "/api/events" && req.method === "POST") {
    const body = await req.json().catch(() => null);
    if (!body) return jsonRes({ ok: false, erreur: "JSON invalide" }, 400);
    let ev;
    try {
      ev = { ...valider(body), id: newId(), created_by: String(body.created_by || "manuel"), created_at: new Date().toISOString().slice(0, 19), updated_at: null };
    } catch (ex) {
      return jsonRes({ ok: false, erreur: ex.message }, 400);
    }
    return withLock(() => {
      const d = loadData();
      d.events.push(ev);
      saveData(d);
      return jsonRes({ ok: true, event: ev }, 201);
    });
  }

  const m = url.pathname.match(/^\/api\/events\/(evt_[a-z0-9_]+)$/);
  if (m) {
    const id = m[1];
    if (req.method === "PUT") {
      const body = await req.json().catch(() => null);
      if (!body) return jsonRes({ ok: false, erreur: "JSON invalide" }, 400);
      return withLock(() => {
        const d = loadData();
        const i = d.events.findIndex((e) => e.id === id);
        if (i < 0) return jsonRes({ ok: false, erreur: "événement introuvable : " + id }, 404);
        let ev;
        try {
          ev = { ...d.events[i], ...valider({ ...d.events[i], ...body }) };
        } catch (ex) {
          return jsonRes({ ok: false, erreur: ex.message }, 400);
        }
        ev.updated_at = new Date().toISOString().slice(0, 19);
        d.events[i] = ev;
        saveData(d);
        return jsonRes({ ok: true, event: ev });
      });
    }
    if (req.method === "DELETE") {
      return withLock(() => {
        const d = loadData();
        const i = d.events.findIndex((e) => e.id === id);
        if (i < 0) return jsonRes({ ok: false, erreur: "événement introuvable : " + id }, 404);
        const [deleted] = d.events.splice(i, 1);
        saveData(d);
        return jsonRes({ ok: true, deleted });
      });
    }
  }

  if (url.pathname === "/api/sources") {
    return withLock(() => {
      const seen = { ...COULEURS };
      for (const e of loadData().events) seen[e.source] = e.couleur || couleurSource(e.source);
      return jsonRes({
        ok: true,
        sources: Object.keys(seen).sort().map((id) => ({ id, couleur: seen[id] })),
      });
    });
  }

  return jsonRes({ ok: false, erreur: "route inconnue" }, 404);
}

function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

const html = () => {
  // Le payload installé est PRÉFIXÉ (ob-plugin-<id>-index.html) ; le nom nu ne
  // sert qu'au dev standalone — un nom nu dans /usr/local/bin risque les collisions.
  for (const p of [
    import.meta.dir + "/ob-plugin-" + PLUGIN_ID + "-index.html",
    import.meta.dir + "/index.html",
  ]) {
    try {
      return readFileSync(p, "utf8");
    } catch (_) { /* suivant */ }
  }
  return "<h1>shared-calendar</h1><p>index.html manquant</p>";
};

Bun.serve({
  port: Number(process.env.OPEN_BOT_PAGE_PORT ?? 4747),
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/healthz") return new Response("ok");
    if (url.pathname === "/") return new Response(html(), { headers: { "content-type": "text/html; charset=utf-8" } });
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(req, url);
      } catch (ex) {
        return jsonRes({ ok: false, erreur: String(ex.message || ex) }, 500);
      }
    }
    return new Response("not found", { status: 404 });
  },
});
