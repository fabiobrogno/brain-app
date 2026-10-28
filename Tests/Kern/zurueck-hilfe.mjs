// .tools/tests/zurueck-hilfe.mjs — gemeinsame Bausteine der Tests zu „brain zurueck" (B2, Task 12): ein Tageslauf im Kleinen
// mit den Bausteinen aus Task 7 und der ECHTEN Commit-Prüfung, plus der Vergleichsmaßstab „als wäre es nie passiert".
// Jede Testdatei ruft isoliere() selbst auf (HOME/Arbeitskopien in Temp).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { neuerTestVault, legeVorschlagAn, seitenText, git, schnappschuss, JETZT } from "./tageslauf-hilfe.mjs";
export { JETZT, git, seitenText, neuerTestVault };
export const Zr = await import("../tageslauf/zurueck.mjs");
export const W = await import("../tageslauf/arbeitskopie.mjs");
export const B = await import("../tageslauf/bestand.mjs");
export const P = await import("../tageslauf/protokoll.mjs");

export const SEITE = "09_wiki/projekte/entitaet_alpha.md";
export const ALT = "- Backups täglich · Stand 01.10.2026 · [[x]]";
const FM = { name: "alpha", description: "Alpha" };
export const MIT_FAKTEN = `# Alpha\n\nText.\n\n## Fakten\n\n${ALT}\n`;
export const OHNE_FAKTEN = "# Alpha\n\nBackups laufen täglich (Fließtext).\n";
export const MIT_STAND = `# Alpha\n\n## Stand\n\nStand 01.10.2026 · [[x]]\n\n- Erledigt: alt\n\n## Fakten\n\n${ALT}\n`;
export const OHNE_STAND = `# Alpha\n\n## Fakten\n\n${ALT}\n`;
export const VERLAUF10 = Array.from({ length: 10 }, (_, i) => `- 0${i}.09.2026: Erledigt: v${i}`).join("\n");
export const MIT_VERLAUF = `${MIT_STAND}\n## Verlauf\n\n${VERLAUF10}\n`;

export const vault = (rumpf = MIT_FAKTEN, fm = {}, hook = "echt") => neuerTestVault({ hook, seiten: { [SEITE]: seitenText({ fm: { ...FM, ...fm }, rumpf }) } });
export const vo = (v, id, text, art = "fakt") => {
  legeVorschlagAn(v, { id, art, titel: `Titel ${id}`, text, zitat: text, herkunft: "du", fundstelle: `s1#u-${id} 2026-10-20T10:00:00Z` });
  return B.ladeVorschlag(v, "_vorschlaege", id);
};
export const seite = (v) => readFileSync(join(v, SEITE), "utf8");
export const link = (id) => `10_projekte/belege/2026-10/${id}`;
export const zeileVon = (id, text) => `- ${text} · Stand 20.10.2026 · [[${link(id)}]]`;

// Ein Tageslauf im Kleinen: Commits über die Arbeitskopie, Aktionen wie Task 11 sie schreibt.
export function simuliereLauf(v, n, auftraege, { aussortiert = [] } = {}) {
  const ctx = P.neuerLauf(v, { claudeBefehl: null, jetzt: JETZT + n * 60e3 });
  const kopie = W.legeArbeitskopieAn(v, ctx.lauf);
  const ok = auftraege.map((a) => ({ a, r: W.commitAuftrag(v, kopie, a, { lauf: ctx.lauf, jetzt: ctx.jetzt }) }));
  assert.ok(ok.every((x) => x.r.ok), JSON.stringify(ok.map((x) => x.r)));
  assert.ok(W.uebernehmen(v, kopie).ok);
  W.verwerfeArbeitskopie(v, kopie);
  const h = W.commitsDesLaufs(v, ctx.lauf, ok.length);
  for (const { a, r } of ok) {
    const id = a.v?.id || a.ref;
    const verschoben = a.v ? B.verschiebeVorschlag(ctx, a.v, "90_archiv/vorschlaege-uebernommen") : null;
    const stufe = a.art === "feld" ? "feld" : a.art === "stand" ? "stand" : "uebernehmen";
    P.notiere(ctx, { id, stufe, ziel: a.seite, commit: h.get(id), auto: true, beleg: r.beleg, feld: a.feld, verschoben });
  }
  for (const x of aussortiert) B.aussortieren(ctx, x, "dublette");
  P.schreibeAktionen(ctx);
  return ctx.lauf;
}
// Auftrags-Bauer: jeder liefert (v) → Schreibauftrag; simuliereAuftrag führt ihn als eigenen Lauf aus und gibt die ID zurück.
export const fakt = (v, id, text) => ({ art: "fakt", seite: SEITE, v: vo(v, id, text), titel: id });
export const fa = (id, text) => (v) => fakt(v, id, text);
export const ersetzen = (id, text, zeile) => (v) => ({ art: "ersetzen", seite: SEITE, v: vo(v, id, text), zeile, titel: id });
export const stand = (id, text) => (v) => ({ art: "stand", seite: SEITE, v: vo(v, id, text, "stand"), titel: id });
export const feld = (ref, wert) => () => ({ art: "feld", seite: SEITE, feld: "zweifel", wert, ref, titel: "Zweifel" });
export function simuliereAuftrag(v, n, f) { const a = f(v); simuliereLauf(v, n, [a]); return a.v?.id || a.ref; }

// Alle versionierten Dateien außer _log.md und Hook, rev neutralisiert — der Vergleichsmaßstab „als wäre nichts gewesen".
export function zustand(v) {
  const out = {};
  for (const p of git(v, "ls-files").split("\n").filter(Boolean)) {
    if (!p.endsWith("_log.md") && !p.startsWith(".hooks/")) out[p] = readFileSync(join(v, p), "utf8").replace(/^rev: \d+$/m, "rev: N");
  }
  return out;
}
// A wird übernommen, danach B (falls gegeben), dann A zurückgenommen. Gegenprobe: zweiter Vault, in dem nur B passiert ist.
// hook: "echt" lässt X mit der echten Commit-Prüfung laufen (rev+1, _log) — sonst nur mit dem schnellen grünen Hook, damit die Dateien unter 15 s bleiben.
export function alsWaerNieGewesen({ rumpf = MIT_FAKTEN, fm = {}, a, b = null, hook = "gruen" }) {
  const x = vault(rumpf, fm, hook), y = vault(rumpf, fm, "gruen");
  const idA = simuliereAuftrag(x, 1, a);
  if (b) { simuliereAuftrag(x, 2, b); simuliereAuftrag(y, 2, b); }
  const r = Zr.nimmZurueck(x, { ids: [idA], jetzt: JETZT + 9 * 60e3 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(zustand(x), zustand(y));
  assert.equal(git(x, "status", "--porcelain"), "");
  assert.deepEqual(Zr.findeCommits(x, { ids: [idA] }), []);
  return { x, y };
}

const aktionenAnzahl = (v) => { try { return readFileSync(join(v, ".logs", "tageslauf", "aktionen.jsonl"), "utf8").split("\n").filter(Boolean).length; } catch { return 0; } };
// Was nicht sauber geht, ändert NICHTS: weder Dateien, HEAD, Branches, Arbeitskopien noch Protokoll.
export function aendertNichts(v, fn) {
  const stand = () => [schnappschuss(v), aktionenAnzahl(v), P.lesePruefungen(v).length];
  const vorher = stand();
  const r = fn();
  assert.deepEqual(stand(), vorher, "Vault und Protokoll unverändert");
  assert.equal(git(v, "branch", "--list", "tageslauf/*"), "");
  return r;
}
