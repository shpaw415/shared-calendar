// Couleurs par défaut des sources connues (le serveur en assigne une aux nouvelles)
const COULEURS: Record<string, string> = { manuel: "#6366f1", "fb-message-guardian": "#3b82f6", "price-scout": "#22c55e", "prompt-shield": "#f59e0b" };

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
}
interface Src {
  id: string;
  couleur: string;
}

// État
let events: Evt[] = [];         // événements chargés (filtres courants)
let sources: Src[] = [];        // [{id,couleur}]
let affAnnee: number, affMois: number;  // mois affiché
let jourSel: string | null = null;      // AAAA-MM-JJ sélectionné par clic
let editId: string | null = null;       // id en édition
let demo = false;        // API injoignable -> données de démo
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const grille = $("grille"), liste = $("liste"), moisLabel = $("moisLabel");

function esc(s: unknown): string { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)); }

function bandeau(mode: string | null, msg?: string): void {
  const b = $("bandeau");
  b.className = "bandeau" + (mode ? " " + mode : "");
  b.textContent = msg || "";
  b.style.display = msg ? "block" : "none";
}

// Utilitaires date
function pad(n: number): string { return String(n).padStart(2, "0"); }
function isoJour(d: Date): string { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function dateDebut(e: Pick<Evt, "d1" | "h1" | "allDay">): Date { return new Date(e.d1 + "T" + (e.allDay ? "00:00" : (e.h1 || "00:00")) + ":00"); }
function dateFin(e: Pick<Evt, "d2" | "h2" | "allDay">): Date { return new Date(e.d2 + "T" + (e.allDay ? "23:59" : (e.h2 || "23:59")) + ":00"); }
function fdate(iso: string): string { const [a, m, j] = iso.split("-"); return j + "/" + m + "/" + a; }
function joli(e: Evt): string { // libellé date/heure
  if (e.allDay) return fdate(e.d1) + (e.d2 !== e.d1 ? " → " + fdate(e.d2) : "") + " · journée entière";
  const memeJour = e.d1 === e.d2;
  const mm = fdate(e.d1).slice(0, 5);
  return memeJour ? mm + " " + (e.h1 || "") + " → " + (e.h2 || "")
    : mm + " " + (e.h1 || "") + " → " + fdate(e.d2).slice(0, 5) + " " + (e.h2 || "");
}

// Démo : utilisée SEULEMENT si l'API est injoignable (page ouverte hors serveur)
function demoEvents(): Evt[] {
  const now = new Date(), y = now.getFullYear(), m = pad(now.getMonth() + 1);
  const y2 = m === "12" ? y + 1 : y, m2 = m === "12" ? "01" : pad(+m + 1);
  return [
    { id: "d1", titre: "Revue scans gardien", desc: "Vérifier les réponses auto du week-end.", d1: `${y}-${m}-05`, h1: "09:30", d2: `${y}-${m}-05`, h2: "10:30", allDay: false, source: "fb-message-guardian", couleur: COULEURS["fb-message-guardian"] },
    { id: "d2", titre: "Veille prix Orange Pi", desc: "Comparer kits gpio-companion.", d1: `${y}-${m}-08`, h1: "14:00", d2: `${y}-${m}-08`, h2: "15:00", allDay: false, source: "price-scout", couleur: COULEURS["price-scout"] },
    { id: "d3", titre: "Marché municipal", desc: "Kiosque communautaire, démos.", d1: `${y}-${m}-12`, h1: null, d2: `${y}-${m}-13`, h2: null, allDay: true, source: "manuel", couleur: COULEURS.manuel },
    { id: "d4", titre: "Rejouer corpus prompt-shield", desc: "Tests anti-injection.", d1: `${y}-${m}-20`, h1: "10:00", d2: `${y}-${m}-20`, h2: "11:00", allDay: false, source: "prompt-shield", couleur: COULEURS["prompt-shield"] },
    { id: "d5", titre: "Atelier", desc: "Préparer le matériel.", d1: `${y2}-${m2}-07`, h1: null, d2: `${y2}-${m2}-07`, h2: null, allDay: true, source: "manuel", couleur: COULEURS.manuel }
  ];
}

// Charger les événements depuis l'API selon les filtres courants
async function charger(): Promise<void> {
  const p = new URLSearchParams();
  if (($("fDu") as HTMLInputElement).value) p.set("from", ($("fDu") as HTMLInputElement).value);
  if (($("fAu") as HTMLInputElement).value) p.set("to", ($("fAu") as HTMLInputElement).value);
  if (($("fSource") as HTMLSelectElement).value) p.set("source", ($("fSource") as HTMLSelectElement).value);
  const q = ($("fQ") as HTMLInputElement).value.trim(); if (q) p.set("q", q);
  if (jourSel) { p.set("from", jourSel); p.set("to", jourSel); }
  try {
    const r = await fetch("api/events?" + p.toString(), { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = (await r.json()) as { events?: Evt[] };
    events = j.events || [];
    if (demo) { demo = false; bandeau(null, ""); }
  } catch (ex) {
    if (!demo) { demo = true; bandeau("demo", "API injoignable — données de démonstration (lecture seule)."); }
    events = demoEvents();
  }
  renduCal(); renduListe();
}

// Rendu calendrier (les filtres sont déjà appliqués côté serveur)
function renduCal(): void {
  const prem = new Date(affAnnee, affMois, 1);
  moisLabel.textContent = prem.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  $("nomsJours").innerHTML = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((j) => `<div class="jour-nom">${j}</div>`).join("");
  const decal = (prem.getDay() + 6) % 7; // lundi=0
  const nbJ = new Date(affAnnee, affMois + 1, 0).getDate();
  const nbPrev = new Date(affAnnee, affMois, 0).getDate();
  const auj = isoJour(new Date());
  let html = "";
  for (let i = 0; i < 42; i++) {
    const n = i - decal + 1; let d: number, m2 = affMois, y2 = affAnnee, autre = false;
    if (n < 1) { d = nbPrev + n; m2 = affMois - 1; autre = true; }
    else if (n > nbJ) { d = n - nbJ; m2 = affMois + 1; autre = true; }
    else d = n;
    if (m2 < 0) { m2 = 11; y2--; } if (m2 > 11) { m2 = 0; y2++; }
    const iso = `${y2}-${pad(m2 + 1)}-${pad(d)}`;
    const ev = events.filter((e) => e.d1 <= iso && e.d2 >= iso);
    const puces = ev.slice(0, 3).map((e) => `<div class="puce" title="${esc(e.titre)}"><i style="background:${esc(e.couleur)}"></i><span class="puce-t">${esc(e.titre)}</span></div>`).join("");
    const plus = ev.length > 3 ? `<div class="plus">+${ev.length - 3} autres</div>` : "";
    const cls = "jour" + (autre ? " autre" : "") + (iso === auj ? " auj" : "") + (iso === jourSel ? " sel" : "");
    html += `<button class="${cls}" data-j="${iso}"><div class="num">${d}</div>${puces}${plus}</button>`;
    if (i >= decal + nbJ - 1 && (i + 1) % 7 === 0) break; // coupe les semaines vides
  }
  grille.innerHTML = html;
  grille.querySelectorAll<HTMLElement>(".jour").forEach((b) => b.onclick = () => {
    jourSel = (jourSel === b.dataset.j) ? null : b.dataset.j!;
    $("jourFiltre").textContent = jourSel ? ("Jour : " + jourSel + " — cliquer à nouveau pour annuler") : "";
    if (jourSel) { ($("cD1") as HTMLInputElement).value = jourSel; ($("cD2") as HTMLInputElement).value = jourSel; }
    charger();
  });
}

// Rendu liste latérale
function renduListe(): void {
  $("compte").textContent = `(${events.length})`;
  if (!events.length) { liste.innerHTML = `<div class="vide">Aucun événement.</div>`; return; }
  liste.innerHTML = events.map((e) => `
   <div class="evt">
    <div class="actions"><button data-m="${e.id}">Modifier</button><button data-s="${e.id}">Suppr.</button></div>
    <div class="meta"><span class="badge" style="background:${esc(e.couleur)}">${esc(e.source)}</span><span>${esc(joli(e))}</span></div>
    <h3>${esc(e.titre)}</h3><p>${esc(e.desc || "")}</p>
   </div>`).join("");
  liste.querySelectorAll<HTMLElement>("[data-m]").forEach((b) => b.onclick = () => ouvrirForm(b.dataset.m));
  liste.querySelectorAll<HTMLElement>("[data-s]").forEach((b) => b.onclick = () => supprimer(b.dataset.s!));
}

async function api(method: string, url: string, body?: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(url, { method, headers: { "content-type": "application/json", Accept: "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = (await r.json().catch(() => ({ ok: false, erreur: "réponse illisible" }))) as Record<string, unknown>;
  if (!r.ok || j.ok === false) throw new Error((j.erreur as string) || ("HTTP " + r.status));
  return j;
}

async function supprimer(id: string): Promise<void> {
  if (demo) { bandeau("err", "Mode démo : suppression désactivée."); return; }
  try { await api("DELETE", "api/events/" + id); charger(); }
  catch (ex) { bandeau("err", "Suppression impossible : " + (ex as Error).message); }
}

// Sources connues -> filtre + datalist du formulaire
async function initSources(): Promise<void> {
  try {
    const j = await api("GET", "api/sources");
    sources = (j.sources as Src[]) || [];
  } catch (ex) { sources = Object.keys(COULEURS).map((id) => ({ id, couleur: COULEURS[id] })); }
  $("fSource").innerHTML = `<option value="">Toutes</option>` + sources.map((s) => `<option value="${esc(s.id)}">${esc(s.id)}</option>`).join("");
  $("lSources").innerHTML = sources.map((s) => `<option value="${esc(s.id)}">`).join("");
}
function couleurDe(id: string): string {
  return ((sources.find((s) => s.id === id) || {}) as Partial<Src>).couleur || COULEURS[id] || "#6366f1";
}

// Modale
function ouvrirForm(id?: string | null): void {
  editId = id || null;
  $("err").textContent = "";
  $("formTitre").textContent = id ? "Modifier l'événement" : "Nouvel événement";
  if (id) {
    const e = events.find((x) => x.id === id)!;
    ($("cTitre") as HTMLInputElement).value = e.titre; ($("cDesc") as HTMLTextAreaElement).value = e.desc || "";
    ($("cD1") as HTMLInputElement).value = e.d1; ($("cH1") as HTMLInputElement).value = e.h1 || "09:00";
    ($("cD2") as HTMLInputElement).value = e.d2; ($("cH2") as HTMLInputElement).value = e.h2 || "10:00";
    ($("cAll") as HTMLInputElement).checked = !!e.allDay; ($("cSource") as HTMLInputElement).value = e.source; ($("cCouleur") as HTMLInputElement).value = e.couleur;
  } else {
    ($("form") as HTMLFormElement).reset(); ($("cSource") as HTMLInputElement).value = "manuel"; ($("cCouleur") as HTMLInputElement).value = couleurDe("manuel");
    const t = new Date(); const jour = jourSel || isoJour(t);
    ($("cD1") as HTMLInputElement).value = jour; ($("cD2") as HTMLInputElement).value = jour;
  }
  const tout = ($("cAll") as HTMLInputElement).checked;
  ($("cH1") as HTMLInputElement).disabled = tout; ($("cH2") as HTMLInputElement).disabled = tout;
  $("overlay").classList.add("ouvert");
}
function fermerForm(): void { $("overlay").classList.remove("ouvert"); }

// Événements UI
$("prev").onclick = () => { affMois--; if (affMois < 0) { affMois = 11; affAnnee--; } renduCal(); };
$("next").onclick = () => { affMois++; if (affMois > 11) { affMois = 0; affAnnee++; } renduCal(); };
$("today").onclick = () => { const n = new Date(); affAnnee = n.getFullYear(); affMois = n.getMonth(); jourSel = null; $("jourFiltre").textContent = ""; charger(); };
$("newBtn").onclick = () => ouvrirForm(null);
$("cancel").onclick = fermerForm;
$("overlay").onclick = (e) => { if ((e.target as HTMLElement).id === "overlay") fermerForm(); };
let deb: ReturnType<typeof setTimeout>;
["fDu", "fAu", "fSource"].forEach((id) => $(id).addEventListener("input", charger));
$("fQ").addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(charger, 250); });
$("fReset").onclick = () => { ($("fDu") as HTMLInputElement).value = ""; ($("fAu") as HTMLInputElement).value = ""; ($("fSource") as HTMLSelectElement).value = ""; ($("fQ") as HTMLInputElement).value = ""; jourSel = null; $("jourFiltre").textContent = ""; charger(); };
$("cSource").addEventListener("input", (e) => { // couleur auto selon la source
  ($("cCouleur") as HTMLInputElement).value = couleurDe((e.target as HTMLInputElement).value.trim() || "manuel");
});
$("cAll").addEventListener("change", (e) => {
  const tout = (e.target as HTMLInputElement).checked;
  ($("cH1") as HTMLInputElement).disabled = tout; ($("cH2") as HTMLInputElement).disabled = tout;
});
$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = { titre: ($("cTitre") as HTMLInputElement).value.trim(), desc: ($("cDesc") as HTMLTextAreaElement).value.trim(), d1: ($("cD1") as HTMLInputElement).value, h1: ($("cAll") as HTMLInputElement).checked ? null : (($("cH1") as HTMLInputElement).value || null), d2: ($("cD2") as HTMLInputElement).value, h2: ($("cAll") as HTMLInputElement).checked ? null : (($("cH2") as HTMLInputElement).value || null), allDay: ($("cAll") as HTMLInputElement).checked, source: (($("cSource") as HTMLInputElement).value.trim() || "manuel"), couleur: ($("cCouleur") as HTMLInputElement).value };
  if (dateFin(v) < dateDebut(v)) { $("err").textContent = "La fin doit être après le début."; return; }
  if (demo) { $("err").textContent = "Mode démo : enregistrement désactivé."; return; }
  try {
    if (editId) await api("PUT", "api/events/" + editId, v);
    else await api("POST", "api/events", v);
    fermerForm(); charger();
  } catch (ex) { $("err").textContent = (ex as Error).message; }
});

// Init
(async () => {
  const n = new Date(); affAnnee = n.getFullYear(); affMois = n.getMonth();
  await initSources();
  await charger();
})();
