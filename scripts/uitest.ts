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

// fetch injecté dans la fenêtre : préfixe les URL relatives (api/…) vers le serveur.
function makeFetch(win: Window): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input), BASE).toString();
    return fetch(u, init);
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
const appSrc = html.match(/src="([^"]*_bun\/client\/[^"]+\.js)"/)?.[1]
  ?? html.match(/src="([^"]*app\.ts)"/)?.[1];
if (!appSrc) { console.error("✗ script de l'app introuvable dans la page servie"); process.exit(1); }
const appUrl = new URL(appSrc, BASE).toString();
const appRes = await fetch(appUrl);
ok(appRes.status === 200, `JS de l'app servi en 200 (${appUrl})`);
const appJs = await appRes.text();
const cssHref = html.match(/href="([^"]+\.css)"/)?.[1];
const cssRes = cssHref ? await fetch(new URL(cssHref, BASE).toString()) : null;
ok(!cssHref || cssRes!.status === 200, "CSS servi en 200");
const taille = appJs.length + (cssRes ? Number(cssRes.headers.get("content-length") ?? (await cssRes.text()).length) : 0);
ok(taille < 8 * 1024 * 1024, `bundle < 8 Mo (${(taille / 1024).toFixed(0)} Ko)`);

const scriptPos = html.indexOf("<script>");
const cssPos = html.indexOf('rel="stylesheet"');
ok(scriptPos >= 0 && cssPos >= 0 && scriptPos < cssPos, "script de thème AVANT le CSS (zéro flash)");
ok(/data-theme/.test(html) && !/theme-toggle|toggle-theme/i.test(html), "thème piloté par ?theme=/prefers, aucun toggle custom");

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
for (const e of (await (await fetch(`${BASE}/api/events`)).json()).events as { id: string; titre: string }[]) {
  if (e.titre.includes(NETTOYAGE)) await fetch(`${BASE}/api/events/${e.id}`, { method: "DELETE" });
}
const echappe = await (await fetch(`${BASE}/api/events`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ titre: `${NETTOYAGE} <b>gras</b>`, d1: "2026-11-10", h1: "09:00", d2: "2026-11-10", h2: "10:00", source: "uitest-cal" }),
})).json() as { event: { id: string } };

const w2 = await fenetre(BASE + "/?theme=light", html, appJs);
const doc2 = w2.document as unknown as Document;
const carte = [...doc2.querySelectorAll(".evt h3")].find((h) => h.textContent?.includes(NETTOYAGE));
ok(!!carte, "événement créé via l'API rendu dans la liste (fenêtre fraîche)");
ok(carte?.innerHTML === `${NETTOYAGE} &lt;b&gt;gras&lt;/b&gt;`, "titre échappé (pas de balise réelle)");
const badge = carte?.closest(".evt")?.querySelector(".badge");
ok(!!badge && badge.textContent === "uitest-cal", "badge source affiché");
const opts = [...doc2.querySelectorAll<HTMLSelectElement>("#fSource option")].map((o) => o.value);
ok(opts.includes("uitest-cal"), "source connue présente dans le filtre");
await w2.happyDOM.abort();

// ---------- nettoyage ----------
const del = await fetch(`${BASE}/api/events/${echappe.event.id}`, { method: "DELETE" });
ok(del.status === 200, "événement de test supprimé");

console.log(fail ? `\n${fail} échec(s)` : "\ntous les cas UI passent");
process.exit(fail ? 1 : 0);
