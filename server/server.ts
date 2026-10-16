// shared-calendar — serveur de la page dashboard (Bun).
// API REST du calendrier partagé + UI. Même fichier de données et même verrou
// que le CLI ob-plugin-shared-calendar-cal (contrat inter-plugins).
import { openSync, writeSync, closeSync, unlinkSync, mkdirSync, statSync, readFileSync, renameSync } from "node:fs";

const PLUGIN_ID: string = process.env.OPEN_BOT_PLUGIN_ID || "shared-calendar";
const DATA_DIR = `/home/agent/.open-bot/pages-data/${PLUGIN_ID}`;
const DATA_FILE = `${DATA_DIR}/events.json`;
const LOCK_FILE = `${DATA_DIR}/events.lock`;
const LOCK_RETRY_MS = 5000;
const LOCK_STALE_MS = 10000;
const TOKEN: string = process.env.OPEN_BOT_PAGE_TOKEN || "";

const COULEURS: Record<string, string> = {
  manuel: "#6366f1",
  "fb-message-guardian": "#3b82f6",
  "price-scout": "#22c55e",
  "prompt-shield": "#f59e0b",
};
const PALETTE: string[] = ["#6366f1", "#3b82f6", "#22c55e", "#f59e0b", "#ec4899", "#14b8a6", "#eab308", "#a855f7"];

interface Evt {
  id: string;
  titre: string;
  desc: string;
  d1: string;
  h1: string | null;
  d2: string;
  h2: string | null;
  allDay: boolean;
  source: string;
  couleur: string;
  created_by?: string;
  created_at?: string | null;
  updated_at?: string | null;
}
interface Store {
  events: Evt[];
}

// ---------- verrou (même protocole que le CLI Python : O_EXCL + stale) ----------
async function withLock<T>(fn: () => T): Promise<T> {
  mkdirSync(DATA_DIR, { recursive: true });
  const deadline = Date.now() + LOCK_RETRY_MS;
  for (;;) {
    try {
      const fd = openSync(LOCK_FILE, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadData(): Store {
  try {
    const d = JSON.parse(readFileSync(DATA_FILE, "utf8")) as Store;
    if (!Array.isArray(d.events)) d.events = [];
    return d;
  } catch (_) {
    return { events: [] };
  }
}
function saveData(d: Store): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + ".tmp";
  writeSync(openSync(tmp, "w"), JSON.stringify(d, null, 1));
  renameSync(tmp, DATA_FILE); // rename atomique
}

// ---------- validation (miroir du CLI) ----------
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RE_TIME = /^\d{2}:\d{2}$/;
const RE_COLOR = /^#[0-9a-fA-F]{6}$/;

// Miroir exact du `x || ""` JS : falsy (undefined, "", 0) -> ""
const str = (v: unknown): string => (v as string) || "";

function couleurSource(source: string): string {
  if (COULEURS[source]) return COULEURS[source];
  let h = 0;
  for (const c of source) h += c.charCodeAt(0);
  return PALETTE[h % PALETTE.length];
}

type EvtCoeur = Omit<Evt, "id" | "created_by" | "created_at" | "updated_at">;

function valider(e: Record<string, unknown>): EvtCoeur {
  const titre = String(e.titre ?? "").trim();
  if (!titre) throw new Error("titre requis");
  if (titre.length > 200) throw new Error("titre trop long (200 max)");
  const desc = String(e.desc ?? "").trim();
  if (desc.length > 2000) throw new Error("description trop longue (2000 max)");
  for (const k of ["d1", "d2"] as const) {
    if (!RE_DATE.test(str(e[k]))) throw new Error(`${k} doit être une date AAAA-MM-JJ`);
  }
  for (const k of ["h1", "h2"] as const) {
    if (e[k] && !RE_TIME.test(e[k] as string)) throw new Error(`${k} doit être une heure HH:MM`);
  }
  const d1 = e.d1 as string;
  const d2 = e.d2 as string;
  const h1raw = e.h1 as string | null;
  const h2raw = e.h2 as string | null;
  const debut = d1 + "T" + (h1raw || "00:00");
  const fin = d2 + "T" + (h2raw || "23:59");
  if (fin < debut) throw new Error("la fin doit être après ou égale au début");
  const source = String(e.source || "manuel").trim() || "manuel";
  if (source.length > 40) throw new Error("source trop longue (40 max)");
  // Même règle que le CLI : date seule (aucune heure) = journée entière
  const allDay = !!e.allDay || (!h1raw && !h2raw);
  const couleur = (e.couleur as string) || couleurSource(source);
  if (!RE_COLOR.test(couleur)) throw new Error("couleur doit être #rrggbb");
  return {
    titre,
    desc,
    d1,
    h1: allDay ? null : h1raw || null,
    d2,
    h2: allDay ? null : h2raw || null,
    allDay,
    source,
    couleur,
  };
}

function newId(): string {
  return "evt_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
}

// ---------- routes ----------
async function handleApi(req: Request, url: URL): Promise<Response> {
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
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return jsonRes({ ok: false, erreur: "JSON invalide" }, 400);
    let ev: Evt;
    try {
      ev = { ...valider(body), id: newId(), created_by: String(body.created_by || "manuel"), created_at: new Date().toISOString().slice(0, 19), updated_at: null };
    } catch (ex) {
      return jsonRes({ ok: false, erreur: (ex as Error).message }, 400);
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
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body) return jsonRes({ ok: false, erreur: "JSON invalide" }, 400);
      return withLock(() => {
        const d = loadData();
        const i = d.events.findIndex((e) => e.id === id);
        if (i < 0) return jsonRes({ ok: false, erreur: "événement introuvable : " + id }, 404);
        let ev: Evt;
        try {
          ev = { ...d.events[i], ...valider({ ...d.events[i], ...body }) };
        } catch (ex) {
          return jsonRes({ ok: false, erreur: (ex as Error).message }, 400);
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
      const seen: Record<string, string> = { ...COULEURS };
      for (const e of loadData().events) seen[e.source] = e.couleur || couleurSource(e.source);
      return jsonRes({
        ok: true,
        sources: Object.keys(seen).sort().map((id) => ({ id, couleur: seen[id] })),
      });
    });
  }

  return jsonRes({ ok: false, erreur: "route inconnue" }, 404);
}

function jsonRes(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

// L'UI est bundle par le control plane au install (dashboard.pages.ui) et
// transmise via OPEN_BOT_PAGE_UI. Les checkouts locaux / previews importent
// l'HTML en direct — Bun bundle app.ts + styles.css à la volée (bun --hot).
// Valeur statique à dessein : l'import HTML doit être résolu avant Bun.serve.
const routes: Record<string, unknown> = process.env.OPEN_BOT_PAGE_UI
  ? {
      "/": (): Response =>
        new Response(Bun.file(process.env.OPEN_BOT_PAGE_UI as string), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
        }),
    }
  : { "/": await import("./index.html").then((m) => (m as { default: string }).default) };

Bun.serve({
  port: Number(process.env.OPEN_BOT_PAGE_PORT ?? 4747),
  routes: routes as never,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/healthz") return new Response("ok");
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(req, url);
      } catch (ex) {
        return jsonRes({ ok: false, erreur: String((ex as Error).message || ex) }, 500);
      }
    }
    return new Response("not found", { status: 404 });
  },
});
