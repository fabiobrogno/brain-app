#!/usr/bin/env node
// tageslauf/zurueck.mjs — „brain zurueck <lauf|id>" (Spec §5.4). Nimmt automatische Änderungen des Tageslaufs zurück:
// EIN neuer Commit (nichts wird umgeschrieben), gebaut als gezielte Gegenänderung je Aktion statt `git revert` — ein Revert
// kollidiert an rev, quellen und benachbarten Fakt-Zeilen, sobald danach noch etwas auf derselben Seite dazukam. Je Aktion:
// Fakt-Zeile mit ihrem Beleg-Link entfernen (beim Ersetzen die alte Zeile wiederherstellen), Stand-Abschnitt samt Verlauf auf
// den Stand vor dem Commit, Feld auf den alten Wert; Beleg-Datei löschen, quellen/quellen_sha bereinigen; je Seite
// rev = rev auf main + 1; _log.md bekommt einen NEUEN Eintrag oben. Normaler pre-commit, ff-Merge wie im Lauf.
// Maßstab: danach sieht die Seite aus, als wäre die Aktion nie passiert (spätere Änderungen bleiben). Wurde die Seite inzwischen verschoben, wird dort zurückgenommen,
// wo der Beleg-Link der Zeile jetzt steht (genau eine Seite; mehrdeutig → nicht anfassen). Jede Stelle, die der
// Commit angefasst hat, wird gegen den Wortlaut des Commits geprüft — weicht sie ab (von Hand geändert, später überschrieben),
// wird DIESE Aktion nicht angefasst und mit Grund gemeldet; ein Commit entsteht nur, wenn mindestens eine Aktion sauber geht.
// Betroffene Vorschläge → 90_archiv/vorschlaege-abgelehnt/; beim ganzen Lauf kommen die nicht versionierten Verschiebungen
// (aussortiert, abgelehnt, Inbox) zurück nach _vorschlaege. Rücknahme einer automatischen Übernahme zählt als Fehler (§6.3).
// Pflege-Commits von B3 (pflege(<lauf>): …) nimmt pflege-zurueck.mjs zurück; die CLI ruft beides (Pflege zuerst).
// CLI: node tageslauf/zurueck.mjs <vault> <lauf|id>        Exit 0 · 1 (nichts gefunden / nicht möglich) · 64
import { readFileSync, writeFileSync, existsSync, realpathSync, readdirSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { ordner, vaultPfadOderEnde } from "../pfade.mjs";
import { ladeVorschlagDatei, verschiebeVorschlag, ablehnen, UNTERORDNER } from "./bestand.mjs";
import { neuerLauf, laufId, notiere, merkePruefung, leseAktionen, schreibeAktionen } from "./protokoll.mjs";
import { git, legeArbeitskopieAn, verwerfeArbeitskopie, uebernehmen, nimmIngestSperre, gibIngestSperreFrei, BETREFF_MUSTER } from "./arbeitskopie.mjs";
import { heileProtokoll, notiereHeilung } from "./heilung.mjs";
import { abschnitt, verlaufZeile, leseFeld, setzeFeld, erhoeheRev, fuegeLogEin, logZeit, BELEG_MUSTER } from "./schreiben.mjs";
import { nimmSperre, gibSperreFrei } from "./zeitplan.mjs";
import { nimmPflegeZurueck } from "./pflege-zurueck.mjs";

export const LAUF_MUSTER = /^\d{8}-\d{6}$/;
const BETREFF = BETREFF_MUSTER;
const LISTE = /^\s*[-*] /;
const STRIKE = /^(\s*)[-*] ~~(.+)~~ · ersetzt am .+ durch die Zeile darunter$/;
const FELD_MUSTER = /^[a-z][a-z0-9_]{0,29}$/;
const FELD_STRUKTUR = new Set(["rev", "quellen", "quellen_sha", "kritisch", "typ"]);
export { BELEG_MUSTER };   // <cluster>/belege/<JJJJ-MM>/<id>.md (Definition in schreiben.mjs)
const lf = (t) => String(t).replace(/\r\n/g, "\n");
const norm = (s) => String(s).replace(/\s+/g, " ").trim();
const aussageVon = (z) => norm(z.replace(LISTE, "").split(" · Stand ")[0]);

export function findeCommits(vault, { lauf = null, ids = null, aktionen = leseAktionen(vault) } = {}) {
  const schon = new Set(aktionen.filter((a) => a.stufe === "zurueck" && a.von).map((a) => a.von));
  let log = "";
  try { log = git(vault, vault, ["log", "--format=%H%x09%s", "--grep=^auto(", "main"]); } catch { return []; }
  const out = [];
  for (const z of log.split("\n").filter(Boolean)) {
    const [hash, betreff = ""] = z.split("\t");
    const m = betreff.match(BETREFF);
    if (!m || schon.has(hash) || (lauf && m[1] !== lauf) || (ids && !ids.includes(m[2]))) continue;
    out.push({ hash, lauf: m[1], id: m[2], aktion: aktionen.find((a) => a.commit === hash) || null });
  }
  return out;
}

// Wo steht der Beleg-Link `[[link]]` einer Übernahme jetzt im Wiki unter `wurzel`? Alle Wiki-Seiten (ohne _-Dateien und Punkt-Ordner), die ihn tragen → Pfade relativ zu
// `wurzel`, sortiert. Ist eine Seite verschoben oder umbenannt worden (ENOENT am alten Pfad), steht die Zeile am neuen weiter. WIRFT, wenn der Wiki-Ordner oder eine Seite
// nicht lesbar ist — ein „nicht gefunden“ trotz Lesefehler wäre ein falscher Beweis, dass die Zeile weg ist.
export function seitenMitLink(wurzel, wiki, link) {
  const marke = `[[${link}]]`, treffer = [];
  const lauf = (rel) => {
    const eintraege = readdirSync(join(wurzel, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const d of eintraege) {
      if (d.name.startsWith(".")) continue;
      const r = `${rel}/${d.name}`;
      if (d.isDirectory()) lauf(r);
      else if (d.isFile() && d.name.endsWith(".md") && !d.name.startsWith("_") && readFileSync(join(wurzel, r), "utf8").includes(marke)) treffer.push(r);
    }
  };
  lauf(wiki);
  return treffer;
}

// ── Textbausteine der Gegenänderung (alles reine Funktionen auf Seitentext; Fehler → werfen, macheRueckgaengig fängt) ──
function fmZeilen(text) {
  const t = lf(text);
  const ende = t.startsWith("---\n") ? t.indexOf("\n---", 3) : -1;
  if (ende < 0) throw new Error("seite-unlesbar");
  const fm = t.slice(4, ende);
  return { zeilen: fm ? fm.split("\n") : [], rest: t.slice(ende) };
}
const schluessel = (text) => fmZeilen(text).zeilen.map((z) => (z.match(/^([A-Za-z_][\w-]*):/) || [])[1]).filter(Boolean);
// roh === null: Feld entfernen; sonst die Zeile „feld: roh" so wie sie war wiederherstellen (JSON-Neuschreibung würde den Wortlaut ändern).
function feldRoh(text, feld, roh) {
  const { zeilen, rest } = fmZeilen(text);
  const i = zeilen.findIndex((z) => z.startsWith(`${feld}:`));
  if (roh === null) { if (i >= 0) zeilen.splice(i, 1); }
  else { const z = `${feld}: ${roh}`.trimEnd(); if (i >= 0) zeilen[i] = z; else zeilen.push(z); }
  return `---\n${zeilen.join("\n")}${rest}`;
}
function ohneQuelle(text, eltern, pfad) {
  const lies = (t, k) => {
    const z = fmZeilen(t).zeilen, i = z.findIndex((x) => x.startsWith(`${k}:`));
    if (i < 0) return null;
    const w = z[i].slice(k.length + 1).trim();
    if (!w) { if (/^\s+-/.test(z[i + 1] || "")) throw new Error("Blockliste"); return []; }
    const x = JSON.parse(w);
    if (!Array.isArray(x)) throw new Error("keine Liste");
    return x;
  };
  const q = lies(text, "quellen"), s = lies(text, "quellen_sha");
  if (!q || !s || q.length !== s.length) throw new Error("seite-unlesbar");
  const i = q.indexOf(pfad);
  if (i < 0) return text;
  q.splice(i, 1);
  s.splice(i, 1);
  let t = text;
  for (const [k, liste] of [["quellen", q], ["quellen_sha", s]]) {
    const vorher = lies(eltern, k);
    if (vorher === null && !liste.length) t = feldRoh(t, k, null);                                  // Feld gab es vorher nicht
    else if (vorher !== null && JSON.stringify(vorher) === JSON.stringify(liste)) t = feldRoh(t, k, leseFeld(eltern, k));   // Bestandsformat zurück
    else t = setzeFeld(t, k, liste);
  }
  return t;
}
const abschnittText = (t, a) => (a ? t.slice(a.kopfStart, a.ende).trim() : null);
const schneide = (t, a) => { const vor = t.slice(0, a.kopfStart); return a.letzter ? vor.replace(/\n*$/, "\n") : vor + t.slice(a.ende); };
function setzeAbschnitt(t, a, eltern, ea) {      // a: Abschnitt im heutigen Text; ea: derselbe Abschnitt vor dem Commit (oder null → Abschnitt weg)
  if (!ea) return schneide(t, a);
  const block = eltern.slice(ea.kopfStart, ea.ende).replace(/\n*$/, "\n");
  return `${t.slice(0, a.kopfStart)}${block}${a.letzter ? "" : "\n"}${t.slice(a.ende)}`;
}
function ohneLeerenAbschnitt(t, kopf, eltern) {   // hat der Commit „## Fakten" erst angelegt und ist er jetzt leer, verschwindet er wieder
  if (abschnitt(eltern, kopf)) return t;
  const a = abschnitt(t, kopf);
  return a && !t.slice(a.start, a.ende).trim() ? schneide(t, a) : t;
}
function fehlend(eltern, commit) {   // Zeilen, die vor dem Commit da waren und im Commit-Text (zählend) nicht mehr
  const n = new Map();
  for (const z of commit) n.set(z, (n.get(z) || 0) + 1);
  return eltern.filter((z) => { const k = n.get(z) || 0; if (k > 0) { n.set(z, k - 1); return false; } return true; });
}

function faktZurueck(text, eltern, commit, link) {
  const z = text.split("\n");
  const hat = (x) => LISTE.test(x) && x.includes(`[[${link}]]`);
  const i = z.findIndex(hat);
  if (i < 0) return null;
  const cz = commit ? commit.split("\n") : null;
  const ci = cz ? cz.findIndex(hat) : -1;
  if (cz && (ci < 0 || norm(cz[ci]) !== norm(z[i]))) return null;            // Zeile von Hand geändert
  const darueber = cz ? cz[ci - 1] || "" : z[i - 1] || "";
  const m = darueber.match(STRIKE);
  if (m) {                                                                  // Ersetzen: durchgestrichene + neue Zeile → die alte Zeile, wie sie war
    if (norm(z[i - 1] || "") !== norm(darueber)) return null;
    const alt = fehlend(lf(eltern).split("\n"), cz || z).find((x) => LISTE.test(x) && aussageVon(x) === norm(m[2]));
    if (alt === undefined) return null;
    z.splice(i - 1, 2, alt);
  } else z.splice(i, 1);
  return ohneLeerenAbschnitt(z.join("\n"), "Fakten", eltern);
}
function standZurueck(text, eltern, commit, link) {
  const jetzt = abschnitt(text, "Stand");
  if (!jetzt) return null;
  const heute = abschnittText(text, jetzt);
  if (!heute.includes(`[[${link}]]`)) return null;                          // inzwischen neuerer Stand
  if (commit && abschnittText(commit, abschnitt(commit, "Stand")) !== heute) return null;   // von Hand geändert
  const alt = abschnitt(eltern, "Stand"), vp = abschnitt(eltern, "Verlauf");
  let neu = setzeAbschnitt(text, jetzt, eltern, alt);
  const beruehrt = commit ? abschnittText(commit, abschnitt(commit, "Verlauf")) !== abschnittText(eltern, vp)
    : !!(alt && verlaufZeile(eltern.slice(alt.start, alt.ende).trim()));
  if (beruehrt) {                                                           // der Commit hat den alten Stand als Verlaufszeile abgelegt (und ggf. die älteste verdrängt)
    const vj = abschnitt(neu, "Verlauf");
    if (!vj || (commit && abschnittText(neu, vj) !== abschnittText(commit, abschnitt(commit, "Verlauf")))) return null;
    neu = setzeAbschnitt(neu, vj, eltern, vp);
  }
  return neu;
}
function feldZurueck(text, eltern, commit, feld) {
  if (typeof feld !== "string" || !FELD_MUSTER.test(feld) || FELD_STRUKTUR.has(feld)) return null;
  if (commit && leseFeld(text, feld) !== leseFeld(commit, feld)) return null;   // inzwischen anders gesetzt
  return feldRoh(text, feld, leseFeld(eltern, feld));
}
// Weitere Felder, die der Commit nebenbei geändert hat (z. B. zweifel beim Ersetzen im Fließtext): zurück auf den alten Wortlaut —
// außer sie sind inzwischen ohnehin neu gesetzt (dann hätte das Spätere sie auch ohne den Commit überschrieben).
function nebenfelder(text, eltern, commit, ausser) {
  if (!commit) return text;
  let neu = text;
  for (const k of new Set([...schluessel(eltern), ...schluessel(commit)])) {
    if (k === ausser || k === "rev" || k === "quellen" || k === "quellen_sha") continue;
    const vorher = leseFeld(eltern, k);
    if (vorher !== leseFeld(commit, k) && leseFeld(neu, k) === leseFeld(commit, k)) neu = feldRoh(neu, k, vorher);
  }
  return neu;
}

// Gegenänderung einer Aktion auf dem heutigen Text. elternText = Seite vor dem Commit der Aktion, commitText = Seite direkt
// danach (mit ihm wird geprüft, dass die Stellen unverändert sind; ohne ihn nur das Nötigste). null = nicht sauber möglich.
export function macheRueckgaengig(text, elternText, aktion, commitText = null) {
  try {
    const t = lf(text), e = lf(elternText), c = commitText === null || commitText === undefined ? null : lf(commitText);
    let neu;
    if (aktion.stufe === "feld") neu = feldZurueck(t, e, c, aktion.feld);
    else {
      const beleg = String(aktion.beleg || "");
      if (!BELEG_MUSTER.test(beleg)) return null;
      const link = beleg.replace(/\.md$/, "");
      neu = aktion.stufe === "stand" ? standZurueck(t, e, c, link) : faktZurueck(t, e, c, link);
      if (neu !== null) neu = ohneQuelle(neu, e, beleg);
    }
    if (neu === null) return null;
    neu = nebenfelder(neu, e, c, aktion.stufe === "feld" ? aktion.feld : null);
    erhoeheRev(neu);                                                         // rev muss lesbar sein, sonst später kein Commit möglich
    return neu;
  } catch { return null; }
}

// ── Git-Teil ────────────────────────────────────────────────────────────────────────────────────────────────────────
function gegenaenderung(vault, kopie, commits, { jetzt }) {
  const wiki = ordner(vault).wiki;
  const g = (args) => git(vault, kopie.pfad, args);
  const zeige = (rev, pfad) => `${git(vault, vault, ["show", `${rev}:${pfad}`])}\n`;     // git() kürzt den Schlusszeilenumbruch
  const texte = new Map(), erledigt = [], uebersprungen = [], weg = [];
  const aktuell = (ziel) => texte.get(ziel) ?? readFileSync(join(kopie.pfad, ziel), "utf8");
  for (const k of commits) {                                                 // neueste zuerst
    const a = k.aktion;
    const ziel = String(a?.ziel || "");
    if (!a || !["uebernehmen", "stand", "feld"].includes(a.stufe) || !ziel.startsWith(`${wiki}/`) || !ziel.endsWith(".md") || ziel.split("/").includes("..")) {
      uebersprungen.push({ id: k.id, grund: "aktion-fehlt" });
      continue;
    }
    // Seite verschoben/umbenannt? Dann steht die Zeile unter ihrem Beleg-Link auf genau EINER anderen Seite — dort wird zurückgenommen (Texte vor/nach dem Commit kommen
    // weiter vom alten Pfad aus dem Git-Verlauf). Mehrdeutig oder nirgends → wie bisher „von Hand geändert“.
    let heute = ziel;
    if (!existsSync(join(kopie.pfad, ziel)) && a.stufe !== "feld" && BELEG_MUSTER.test(String(a.beleg || ""))) {
      try { const t = seitenMitLink(kopie.pfad, wiki, String(a.beleg).replace(/\.md$/, "")); if (t.length === 1) heute = t[0]; } catch { /* nicht lesbar → bleibt am alten Pfad → von Hand geändert */ }
    }
    let neu = null;
    try { neu = macheRueckgaengig(aktuell(heute), zeige(`${k.hash}^`, ziel), a, zeige(k.hash, ziel)); } catch { /* Seite weg → von Hand geändert */ }
    if (neu === null) { uebersprungen.push({ id: k.id, grund: "von-hand-geaendert" }); continue; }
    texte.set(heute, neu);
    k.seite = heute;
    if (a.stufe !== "feld" && a.beleg) weg.push(a.beleg);
    erledigt.push(k);
  }
  if (!erledigt.length) return { erledigt, uebersprungen };
  const revs = [];
  for (const [ziel, text] of texte) {
    const r = erhoeheRev(text);                                              // je Seite einmal: rev auf main + 1
    writeFileSync(join(kopie.pfad, ziel), r.text);
    revs.push(`${ziel.slice(wiki.length + 1)} (rev ${r.rev}: automatische Änderung zurückgenommen)`);
  }
  const logRel = `${wiki}/_log.md`;
  const logDatei = join(kopie.pfad, logRel);
  const eintrag = [`## ${logZeit(new Date(jetzt))} — zurueck: ${erledigt.length} automatische Änderung(en) zurückgenommen`,
    `- Seiten geändert: ${revs.join(", ")}`, `- Zurückgenommen: ${erledigt.map((k) => `${k.id} (${k.hash.slice(0, 8)})`).join(", ").slice(0, 400)}`].join("\n");
  const altLog = existsSync(logDatei) ? readFileSync(logDatei, "utf8") : "# Ingest-Protokoll (append-only, neuester Eintrag oben)\n";
  writeFileSync(logDatei, fuegeLogEin(altLog, eintrag));
  try {
    for (const b of weg) { try { g(["rm", "-q", "--", b]); } catch { /* schon weg */ } }
    g(["add", "--", logRel, ...texte.keys()]);
    g(["commit", "-q", "-m", `zurueck: ${erledigt.map((k) => k.id).join(", ").slice(0, 100)} (${erledigt.length} Änderung(en))`]);
  } catch { return { erledigt: [], uebersprungen, grund: "pruefung-rot" }; }
  return { erledigt, uebersprungen };
}

// Ohne mitgegebenen ctx (CLI) schreibt nimmZurueck sein eigenes Aktionsprotokoll — genau einmal, am Ende.
export function nimmZurueck(vault, opt = {}) {
  const c = opt.ctx || neuerLauf(vault, { jetzt: opt.jetzt ?? Date.now(), claudeBefehl: null });
  try { return zuruecknehmenMit(vault, c, opt); }
  finally { if (!opt.ctx) schreibeAktionen(c); }
}

function zuruecknehmenMit(vault, c, { lauf = null, ids = null, jetzt = Date.now(), alsFehler = true } = {}) {
  if (c.probe) return { ok: false, grund: "probe" };                         // Probemodus schreibt nie
  // Selbstheilung (heilung.mjs): Commits des Tageslaufs, deren Aktion nie ins Protokoll kam (Doppelausfall nach dem Merge), werden für diese Lauf-Nummer/ID nachgetragen —
  // sonst fände findeCommits sie nicht. Gezielt, ohne Altersgrenze; ein Fehler dabei ändert nichts am Zurücknehmen der bekannten Aktionen.
  try { notiereHeilung(c, heileProtokoll(vault, { lauf, ids, jetzt })); } catch { /* Protokoll bleibt, wie es ist */ }
  const aktionen = leseAktionen(vault);
  const commits = findeCommits(vault, { lauf, ids, aktionen });
  const gesehen = new Set();
  const verschiebungen = (lauf && !ids
    ? aktionen.filter((a) => a.lauf === lauf && a.verschoben && ["aussortieren", "abgelehnt", "inbox"].includes(a.stufe)) : [])
    .filter((a) => !gesehen.has(a.verschoben) && gesehen.add(a.verschoben))
    .map((a) => ({ a, v: ladeVorschlagDatei(vault, a.verschoben) })).filter((x) => x.v);      // nur, was noch dort liegt
  if (!commits.length && !verschiebungen.length) return { ok: false, grund: "nichts-gefunden" };
  const erg = { ok: true, zurueck: 0, verschoben: 0, commit: null, uebersprungen: [] };
  if (commits.length) {
    if (!nimmIngestSperre(vault)) return { ok: false, grund: "ingest-laeuft" };
    let kopie = null;
    try {
      kopie = legeArbeitskopieAn(vault, `zurueck-${laufId(new Date(jetzt))}`);
      const r = gegenaenderung(vault, kopie, commits, { jetzt });
      erg.uebersprungen = r.uebersprungen;
      if (!r.erledigt.length) {
        const erster = r.uebersprungen[0]?.grund;
        return { ok: false, grund: r.grund || (erster === "aktion-fehlt" ? "nichts-gefunden" : "von-hand-geaendert"), uebersprungen: r.uebersprungen };
      }
      const m = uebernehmen(vault, kopie);
      if (!m.ok) return { ok: false, grund: m.grund };
      try { erg.commit = git(vault, vault, ["rev-parse", "HEAD"]); } catch { /* nur Anzeige */ }
      for (const k of r.erledigt) {                                          // erst Protokoll (nichts kann fehlschlagen), dann die Dateiverschiebung
        const a = k.aktion;
        notiere(c, { id: k.id, stufe: "zurueck", ziel: k.seite || a.ziel, von: k.hash, commit: erg.commit, grund: "zurückgenommen" });   // k.seite: wo die Zeile jetzt stand (verschobene Seite)
        erg.zurueck++;
        if (alsFehler && a.auto) { try { merkePruefung(c, { art: "zurueck", fehler: true, ref: `zurueck:${k.hash}`, seite: a.ziel, aktion: k.id }); } catch { /* Protokoll nicht schreibbar */ } }
        try { const v = a.verschoben ? ladeVorschlagDatei(vault, a.verschoben) : null; if (v) ablehnen(c, v, "zurueckgenommen"); } catch { /* Vorschlag bleibt liegen */ }
      }
    } catch { return { ok: false, grund: "fehler" }; }
    finally {
      if (kopie) verwerfeArbeitskopie(vault, kopie);
      gibIngestSperreFrei(vault);
    }
  }
  for (const { a, v } of verschiebungen) {
    try {
      const z = verschiebeVorschlag(c, v, `${ordner(vault).inbox}/${UNTERORDNER.vorschlaege}`);
      notiere(c, { id: a.id, stufe: "zurueckverschoben", ziel: z, grund: `vorher ${a.stufe}` });
      erg.verschoben++;
    } catch { /* bleibt im Archiv */ }
  }
  return erg;
}

const TEXT = {
  "nichts-gefunden": "Dazu gibt es keine automatische Änderung (mehr). Die Lauf-Nummer steht im Bericht unter .logs/tageslauf/.",
  "ingest-laeuft": "Gerade läuft ein /ingest — bitte danach noch einmal.",
  "von-hand-geaendert": "Die Stelle wurde inzwischen von Hand geändert — bitte selbst anpassen.",
  "pruefung-rot": "Die Commit-Prüfung hat die Rücknahme blockiert.",
  "vault-nicht-auf-main": "Das Brain steht nicht auf main.",
  konflikt: "Die Seite hat sich währenddessen geändert — bitte noch einmal.",
  "lokale-aenderung": "Es gibt ungespeicherte Änderungen an der Seite — erst speichern oder verwerfen.",
};

const selbst = fileURLToPath(import.meta.url);
let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf && aufruf === realpathSync(selbst)) {
  // <vault> <lauf|id> (so ruft brain.mjs auf) oder <lauf|id> mit --vault/BRAIN_VAULT/aktivem App-Vault
  const a0 = process.argv.slice(2);
  const [vault, ziel] = a0.length && isAbsolute(a0[0]) ? a0 : [vaultPfadOderEnde([]), ...a0];
  if (!ziel || !/^[A-Za-z0-9-]{1,80}$/.test(ziel)) {
    console.error("Nutzung: brain zurueck <lauf|id> — die Lauf-Nummer steht im Tageslauf-Bericht (.logs/tageslauf/).");
    process.exit(64);
  }
  if (!nimmSperre(vault)) { console.error("Der Tageslauf läuft gerade — bitte gleich noch einmal versuchen."); process.exit(1); }
  const auswahl = LAUF_MUSTER.test(ziel) ? { lauf: ziel } : { ids: [ziel] };
  let rp, r;
  try {
    try { rp = nimmPflegeZurueck(vault, auswahl); } catch { rp = { ok: false, grund: "fehler" }; }   // B3 zuerst: die jüngeren Commits
    try { r = nimmZurueck(vault, auswahl); } catch { r = { ok: false, grund: "fehler" }; }
  } finally { gibSperreFrei(vault); }
  const nichtsDa = (x) => x.grund === "nichts-gefunden";
  const fehlerText = (x) => `${TEXT[x.grund] || "Zurücknehmen hat nicht geklappt."}${x.uebersprungen?.length ? ` (${x.uebersprungen.map((u) => u.id).join(", ")})` : ""}`;
  if (rp.ok) {
    const nicht = rp.uebersprungen.length ? ` Nicht möglich (von Hand geändert): ${rp.uebersprungen.map((u) => u.id).join(", ")}.` : "";
    console.log(`Pflege zurückgenommen: ${rp.zurueck} Änderung(en)${rp.commit ? ` (Commit ${rp.commit.slice(0, 8)})` : ""}`
      + `${rp.inbox.length ? `, ${rp.inbox.length} Notiz(en) zurück in der Inbox (für die Pflege gesperrt)` : ""}.${nicht}`);
  } else if (!nichtsDa(rp)) console.error(`Pflege: ${fehlerText(rp)}`);
  if (r.ok) {
    const nicht = r.uebersprungen.length ? ` Nicht möglich (von Hand geändert): ${r.uebersprungen.map((u) => u.id).join(", ")}.` : "";
    console.log(`Zurückgenommen: ${r.zurueck} Änderung(en)${r.commit ? ` (Commit ${r.commit.slice(0, 8)})` : ""}`
      + `${r.verschoben ? `, ${r.verschoben} Vorschläge zurück in der Inbox` : ""}.${nicht} Betroffene Vorschläge liegen unter 90_archiv/vorschlaege-abgelehnt/.`);
  } else if (!nichtsDa(r) || (!rp.ok && nichtsDa(rp))) console.error(fehlerText(r));
  process.exit(rp.ok || r.ok ? 0 : 1);
}
