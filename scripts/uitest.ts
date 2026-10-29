/**
 * shared-calendar — harnais UI headless (happy-dom, aucun navigateur requis).
 * Vérifie, du point de vue utilisateur, contre le serveur LIVE :
 *   1. thèmes : ?theme=light / ?theme=dark / sans param -> attribut data-theme
 *      correct ; script de thème AVANT le CSS dans <head> (zéro flash) ;
 *      aucun toggle custom de thème dans la page.
 *   2. rendu : un événement créé via l'API apparaît dans la liste d'une
 *      fenêtre fraîche (équivalent rechargement d'onglet) ;
 *   3. échappement : un titre contenant du HTML est affiché comme texte ;
 *   4. bundle : JS+CSS servies en 200, taille totale < 8 Mo.
 * Usage : UI_PORT=4753 bun scripts/uitest.ts   (nettoie ses événements de test)
 */
import { Window } from "happy-dom";

const PORT = Number(process.env.UI_PORT ?? 4753);
const BASE = `http://127.0.0.1:${PORT}`;
let fail = 0;
function ok(cond: boolean, label: string): void {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) fail++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- token de page (jamais imprimé) ----------
// Sous ob-plugin, le serveur exige x-open-bot-page-token. On le lit dans
// l'environnement du process de page (OPEN_BOT_PLUGIN_ID=shared-calendar).
function tokenPage(): string {
  try {
    const envs = Bun.spawnSync(["sh", "-c",
      `for p in /proc/[0-9]*/environ; do tr '\\0' '\\n' < "$p" 2>/dev/null | grep -qx 'OPEN_BOT_PLUGIN_ID=shared-calendar' && echo "$p"; done | head -1`],
      { stdout: "pipe", stderr: "ignore" }).stdout.toString().trim();
    if (!envs) return "";
    const tok = Bun.spawnSync(["sh", "-c",
      `tr '\\0' '\\n' < "${envs}" | grep '^OPEN_BOT_PAGE_TOKEN=' | head -1 | cut -d= -f2-`],
      { stdout: "pipe", stderr: "ignore" }).stdout.toString().trim();
    return tok.replace(/^OPEN_BOT_PAGE_TOKEN=/, "").trim();
  } catch { return ""; }
}
const TOKEN = tokenPage();
const H = TOKEN ? { "x-open-bot-page-token": TOKEN } : {};
// fetch injecté dans la fenêtre : préfixe les URL relatives (api/…) vers le
// serveur et porte le token de page.
function makeFetch(win: Window): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input), BASE).toString();
    const h = new Headers(init?.headers); for (const [k, v] of Object.entries(H)) h.set(k, v);
    return fetch(u, { ...init, headers: h });
  }) as typeof fetch;
}

// Exécute le <script> inline de thème dans le contexte de la fenêtre happy-dom
// (motif du harnais : new Function + with(window), groupe de capture obligatoire).
function runInlineScripts(win: Window, html: string): void {
  const doc = win.document as unknown as Document;
  doc.open(); doc.write(html); doc.close();
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    new Function("window", "with(window){ " + m[1] + " }")(win);
  }
}

async function fenetre(url: string, html: string, appJs: string): Promise<Window> {
  const win = new Window({ url });
  (win as unknown as { fetch: typeof fetch }).fetch = makeFetch(win);
  runInlineScripts(win, html);
  // Le JS de l'app (transpilé par bun) est exécuté dans le même contexte.
  new Function("window", "with(window){ " + appJs + " }")(win);
  await sleep(300); // initSources() + charger() sont async
  return win;
}

// ---------- 1+4. page, thèmes, bundle ----------
const html = await (await fetch(BASE + "/?theme=dark")).text();
// Install figé (marketplace) : le control plane bundle TOUT dans le HTML
// autonome — app transpilée inline dans <script type="module">, CSS inline
// dans <style>, aucun src. Checkout local (bun --hot) : src externes.
const appSrc = html.match(/src="([^"]*_bun\/client\/[^"]+\.js)"/)?.[1]
  ?? html.match(/src="([^"]*app\.ts)"/)?.[1];
let appJs: string;
let cssServi = ""; // texte CSS réel (checkout : fichier .css ; bundle figé : <style> inline)
if (appSrc) {
  const appUrl = new URL(appSrc, BASE).toString();
  const appRes = await fetch(appUrl);
  ok(appRes.status === 200, `JS de l'app servi en 200 (${appUrl})`);
  appJs = await appRes.text();
  const cssHref = html.match(/href="([^"]+\.css)"/)?.[1];
  const cssRes = cssHref ? await fetch(new URL(cssHref, BASE).toString()) : null;
  ok(!cssHref || cssRes!.status === 200, "CSS servi en 200");
  cssServi = cssRes ? await cssRes.text() : "";
  const taille = appJs.length + cssServi.length;
  ok(taille < 8 * 1024 * 1024, `bundle < 8 Mo (${(taille / 1024).toFixed(0)} Ko)`);
} else {
  appJs = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] ?? "";
  ok(appJs.length > 1000, `app bundle inlinée dans le HTML (${(appJs.length / 1024).toFixed(0)} Ko de JS transpilé)`);
  ok(html.length < 8 * 1024 * 1024, `bundle HTML autonome < 8 Mo (${(html.length / 1024).toFixed(0)} Ko)`);
  cssServi = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
}

const scriptPos = html.indexOf("<script>");
// bundle figé : CSS inline <style> ; checkout : link rel="stylesheet"
const cssPos = html.search(/<style|rel="stylesheet"/);
ok(scriptPos >= 0 && cssPos >= 0 && scriptPos < cssPos, "script de thème AVANT le CSS (zéro flash)");
ok(/data-theme/.test(html) && !/theme-toggle|toggle-theme/i.test(html), "thème piloté par ?theme=/prefers, aucun toggle custom");

// ---------- 5. libellés d'événements : la cellule ne s'élargit pas, ellipsis ----------
// CSS normalisé (le minifieur reformate espaces/sauts de ligne).
const cssN = cssServi.replace(/\s+/g, "");
ok(cssN.includes("repeat(7,minmax(0,1fr))"), "grille 7 colonnes minmax(0,1fr) — le contenu ne peut pas élargir les pistes");
ok(/\.jour\{[^}]*min-width:0/.test(cssN), ".jour min-width:0 — la case peut rétrécir sous son contenu");
ok(/\.puce-t\{[^}]*text-overflow:ellipsis/.test(cssN), ".puce-t ellipsis — le libellé est coupé, pas débordant");
ok(/\.puce\{[^}]*min-width:0/.test(cssN), ".puce min-width:0 — le flex-item cède la place à l'ellipsis");

for (const [qs, attendu] of [["?theme=dark", "dark"], ["?theme=light", "light"], ["", null]] as const) {
  const w = new Window({ url: BASE + "/" + qs });
  runInlineScripts(w, html);
  const got = (w.document as unknown as Document).documentElement.getAttribute("data-theme");
  const bon = attendu ? got === attendu : (got === "light" || got === "dark");
  ok(bon, `data-theme${qs || " (sans param)"} -> ${got}${attendu ? ` (attendu ${attendu})` : ""}`);
  await w.happyDOM.abort();
}

// ---------- 2+3. rendu réel : événement API -> carte dans une fenêtre fraîche ----------
const NETTOYAGE = "UITEST uitest.ts";
// nettoyage de début de run (un crash précédent laisse ses événements)
for (const e of (await (await fetch(`${BASE}/api/events`, { headers: H })).json()).events as { id: string; titre: string }[]) {
  if (e.titre.includes(NETTOYAGE)) await fetch(`${BASE}/api/events/${e.id}`, { method: "DELETE", headers: H });
}
const echappe = await (await fetch(`${BASE}/api/events`, {
  method: "POST", headers: { "content-type": "application/json", ...H },
  body: JSON.stringify({ titre: `${NETTOYAGE} <b>gras</b>`, d1: "2026-11-10", h1: "09:00", d2: "2026-11-10", h2: "10:00", source: "uitest-cal" }),
})).json() as { event: { id: string } };

// événement du MOIS COURANT, titre très long : la case ne doit pas s'élargir
// (grille minmax(0,1fr) + .puce-t ellipsis), le libellé est coupé.
const n = new Date();
const isoAuj = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
const TITRE_LONG = `${NETTOYAGE} ` + "libellé volontairement beaucoup trop long pour tenir dans une case du calendrier";
const longEv = await (await fetch(`${BASE}/api/events`, {
  method: "POST", headers: { "content-type": "application/json", ...H },
  body: JSON.stringify({ titre: TITRE_LONG, d1: isoAuj, d2: isoAuj, source: "uitest-cal" }),
})).json() as { event: { id: string } };

const w2 = await fenetre(BASE + "/?theme=light", html, appJs);
const doc2 = w2.document as unknown as Document;
const TITRE_ESC = `${NETTOYAGE} <b>gras</b>`;
const carte = [...doc2.querySelectorAll(".evt h3")].find((h) => h.textContent === TITRE_ESC);
ok(!!carte, "événement créé via l'API rendu dans la liste (fenêtre fraîche)");
ok(carte?.innerHTML === `${NETTOYAGE} &lt;b&gt;gras&lt;/b&gt;`, "titre échappé (pas de balise réelle)");
const badge = carte?.closest(".evt")?.querySelector(".badge");
ok(!!badge && badge.textContent === "uitest-cal", "badge source affiché");
const opts = [...doc2.querySelectorAll<HTMLSelectElement>("#fSource option")].map((o) => o.value);
ok(opts.includes("uitest-cal"), "source connue présente dans le filtre");
const puceT = [...doc2.querySelectorAll(".puce-t")].find((s) => s.textContent === TITRE_LONG);
ok(!!puceT, "libellé long rendu dans une .puce-t (span ellipsis) dans la grille du mois courant");
ok(doc2.querySelectorAll(".puce").length === [...doc2.querySelectorAll(".puce-t")].length, "chaque .puce enveloppe exactement un .puce-t");
await w2.happyDOM.abort();

// ---------- nettoyage ----------
const del = await fetch(`${BASE}/api/events/${echappe.event.id}`, { method: "DELETE", headers: H });
ok(del.status === 200, "événement de test supprimé");
await fetch(`${BASE}/api/events/${longEv.event.id}`, { method: "DELETE", headers: H });

console.log(fail ? `\n${fail} échec(s)` : "\ntous les cas UI passent");
process.exit(fail ? 1 : 0);
