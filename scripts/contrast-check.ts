/**
 * shared-calendar — audit de contraste WCAG des deux thèmes (règle : dark + light).
 * Extrait les variables CSS de la page servie et vérifie les paires texte/fond (min 4.5).
 * Usage : UI_PORT=4741 bun scripts/contrast-check.ts
 */
const PORT = Number(process.env.UI_PORT ?? 4741);
const html = await (await fetch(`http://127.0.0.1:${PORT}/`)).text();

function varsOf(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}
const css = html.match(/<style>([\s\S]*?)<\/style>/)![1];
// premier SÉLECTEUR du bloc sombre (l'accolade évite les faux positifs dans les commentaires)
const darkAt = css.indexOf('html[data-theme="dark"]{');
if (darkAt < 0) {
  console.error("✗ bloc html[data-theme=\"dark\"] introuvable — page mono-thème ?");
  process.exit(1);
}
const light = varsOf(css.slice(0, darkAt));
const dark = varsOf(css.slice(darkAt));

function lum(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(fg: string, bg: string): number {
  const [a, b] = [lum(fg), lum(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Couleurs fixes des composants (identiques dans les deux thèmes)
const PRIMARY = "#6366f1";       // bouton .primary (fond et hover #5457e5)
const PRIMARY_HOVER = "#5457e5";
const PRIMARY_TEXT = "#ffffff";  // texte du bouton primaire
const WHITE = "#ffffff";         // texte des badges sur couleur de source

let fail = 0;
function check(name: string, fg: string, bg: string, min = 4.5) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${name}: ${r.toFixed(2)}:1 (min ${min})  [${fg} sur ${bg}]`);
}

for (const [theme, v] of [["light", light], ["dark", dark]] as const) {
  console.log(`\n— thème ${theme} —`);
  check(`${theme} body (text/bg)`, v.text, v.bg);
  check(`${theme} .btn (text/btn-bg)`, v.text, v["btn-bg"]);
  check(`${theme} .btn:hover (text/btn-hover)`, v.text, v["btn-hover"]);
  check(`${theme} .btn.primary (fff/accent)`, PRIMARY_TEXT, v.accent ?? PRIMARY, 4.0);
  check(`${theme} .btn.primary:hover (fff/accent-hover)`, PRIMARY_TEXT, v["accent-hover"] ?? PRIMARY_HOVER, 4.0);
  check(`${theme} inputs (text/bg)`, v.text, v.bg);
  check(`${theme} .jour (text/panel2)`, v.text, v.panel2);
  check(`${theme} .jour.auj (text/sel)`, v.text, v.sel);
  check(`${theme} .puce (text/btn-bg)`, v.text, v["btn-bg"]);
  check(`${theme} .plus (muted/panel2)`, v.muted, v.panel2);
  check(`${theme} .evt p (soft/panel2)`, v.soft, v.panel2);
  check(`${theme} .jour-nom/.meta/.vide (muted/panel)`, v.muted, v.panel);
  check(`${theme} .badge (fff/accent)`, WHITE, v.accent ?? PRIMARY, 3.0);
  check(`${theme} #jourFiltre (accent-text/panel)`, v["accent-text"], v.panel);
  check(`${theme} .bandeau.err (err-text/err-bg)`, v["err-text"], v["err-bg"]);
  check(`${theme} .bandeau.demo (demo-text/demo-bg)`, v["demo-text"], v["demo-bg"]);
  check(`${theme} .erreur (err-text/panel)`, v["err-text"], v.panel);
}

console.log(fail ? `\n${fail} échec(s)` : "\ntous les contrastes passent");
process.exit(fail ? 1 : 0);
