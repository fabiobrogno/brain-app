// .tools/tageslauf/diffpruefung.mjs — Diff-Prüfung nach jedem Schreiblauf von B3 (Spec §6.2). REIN: bekommt die geänderten
// Dateien mit altem und neuem Text, liest nichts. Jeder Befund verwirft die ganze Einheit (= den ganzen Quellen-Commit).
//   tools · generiert · pfad   erlaubt sind nur Wiki-Seiten, <wiki>/_log.md und neue Dateien, die die Einheit ausdrücklich
//                              anmeldet (einsortierte Quelle: neueQuellen; Beleg-Dateien <cluster>/belege/JJJJ-MM/<id>.md: neueBelege —
//                              nur neue-seiten.mjs, wo Node die Belege selbst schreibt; sonst ist jede neue Beleg-Datei ein Verstoß);
//                              Symlinks, „..“-Pfade und versteckte Ordner (außer .tools → eigene Regel) sind nie erlaubt
//   gesperrt                   Dateien, die ein ausgeschlossenes Thema nennen (Themen-Guard), dürfen nie berührt werden
//   geloescht                  nichts wird gelöscht
//   binaer                     Binärdateien (NUL-Byte / kein UTF-8) sind in Pflege-Einheiten nie erlaubt: sie ließen sich nicht als Diff zeigen
//   log                        _log.md nur ergänzt (keine alte Zeile fehlt)
//   fremde-seite               mit nurSeiten: keine andere Wiki-Seite
//   kritisch                   kritisch vorher ODER nachher → unberührt lassen (auch: KI setzt kritisch selbst)
//   zu-viel-entfernt           je Seite ≤ 20 % der nichtleeren Rumpfzeilen entfernt oder umgeschrieben; ersetzte Zeilen älter
//                              als 90 Tage und die Zeilen eines ausdrücklich aufgelösten Kastens zählen nicht
//   beleg-link                 jeder vorher vorhandene [[<cluster>/belege/…]]-Link ist noch da (auch im Fließtext)
//   quellen                    kein vorher vorhandener quellen-Eintrag fehlt
//   konflikt-aufgeloest        offene [!KONFLIKT]-Kästen bleiben — außer dem, den der Nutzer entschieden hat (aufgeloest: [fp])
//   umgezogen                  Zeilen, die nachweislich nur umgezogen sind (Konsolidieren: Fakt-Zeile im Fließtext, von der
//                              Haiku-Gegenprobe bestätigt) zählen nicht für die 20 % — Beleg-Links und quellen bleiben Pflicht
// Lint und pre-commit laufen danach beim Commit (pflege-kopie.mjs#einheit).
import { istWikiSeite, istGeneriert } from "../wiki-pfade.mjs";
import { leseSeitenFelder } from "../seitenfelder.mjs";
import { konfliktKaesten } from "../konflikte.mjs";
import { BELEG_LINK_MUSTER } from "../fakten.mjs";

export const MAX_ENTFERNT = 0.2, ERSETZT_TAGE = 90;
const TAG = 86400e3;
const ERSETZT = /^\s*- ~~.+~~ · ersetzt am (\d{2})\.(\d{2})\.(\d{4}) durch die Zeile darunter\s*$/;
const BELEG_DATEI = /^([^/]+)\/belege\/\d{4}-(?:0[1-9]|1[0-2])\/[a-z0-9-]{1,80}\.md$/;
const KOPF = /^\s*>\s*\[!KONFLIKT\]/i;
const AB = /^\s*>\s*(?:[-*+]\s+)?(?:\*\*|__)?[AaBb](?:\*\*|__)?\s*:/;
const GENERIERT_WURZEL = new Set(["INDEX.md", "graph.json", "AGENTS.md"]);
const lf = (t) => String(t ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
const norm = (p) => String(p ?? "").split("\\").join("/").replace(/^(?:\.\/)+/, "");
// Ein Pfad, dem man eine neue Datei anvertrauen darf: relativ, ohne „..“, ohne versteckte Ordner/Dateien.
const sauberPfad = (p) => !!p && !p.startsWith("/") && !/^[A-Za-z]:/.test(p) && p.split("/").every((s) => s && s !== "." && !s.startsWith("."));

export function rumpfZeilen(text) {
  const t = lf(text);
  const m = /^---\n[\s\S]*?\n---(?:\n|$)/.exec(t);
  return (m ? t.slice(m[0].length) : t).split("\n");
}
export function belegLinks(text) {
  const out = new Set();
  for (const m of lf(text).matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) {
    const z = m[1].trim();
    if (BELEG_LINK_MUSTER.test(z)) out.add(z);
  }
  return out;
}
export function quellenListe(text) {
  const t = lf(text);
  const fm = t.startsWith("---\n") ? t.slice(4, Math.max(4, t.indexOf("\n---", 3))) : "";
  const m = /^quellen:[ \t]*(\[.*\])[ \t]*$/m.exec(fm);
  if (!m) return [];
  try { const a = JSON.parse(m[1]); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
}

// Bereich des offenen Kastens mit Fingerabdruck fp: Kopfzeile + folgende „>"-Zeilen (eine Leerzeile mitten im Kasten nur,
// wenn direkt danach eine A/B-Zeile folgt — wie der Parser in konflikte.mjs); endet vor dem nächsten Kasten.
export function kastenBereich(text, fp) {
  const t = lf(text);
  const k = konfliktKaesten(t).konflikte.find((x) => x.fp === fp);
  if (!k) return null;
  const z = t.split("\n");
  let ende = k.zeile;                                        // k.zeile ist 1-basiert = Index der Zeile nach dem Kopf
  while (ende < z.length && !KOPF.test(z[ende])
    && (/^\s*>/.test(z[ende]) || (!z[ende].trim() && ende + 1 < z.length && AB.test(z[ende + 1])))) ende++;
  return { start: k.zeile - 1, ende };
}

function alteErsetzte(zeile, jetzt) {
  const m = ERSETZT.exec(zeile);
  return !!m && jetzt - Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) > ERSETZT_TAGE * TAG;
}
// Nichtleere Rumpfzeilen von alt, die in neu fehlen (Mehrfachmenge, Leerraum am Rand egal).
export function entfernteZeilen(alt, neu, { jetzt = Date.now(), ausnahmen = new Set() } = {}) {
  const rest = new Map();
  for (const z of rumpfZeilen(neu)) { const k = z.trim(); if (k) rest.set(k, (rest.get(k) || 0) + 1); }
  let gesamt = 0, entfernt = 0;
  for (const z of rumpfZeilen(alt)) {
    const k = z.trim();
    if (!k) continue;
    gesamt++;
    if (rest.get(k) > 0) { rest.set(k, rest.get(k) - 1); continue; }
    if (alteErsetzte(z, jetzt) || ausnahmen.has(k)) continue;
    entfernt++;
  }
  return { gesamt, entfernt, anteil: gesamt ? entfernt / gesamt : 0 };
}

export function pruefeDiff(dateien, { wiki = "09_wiki", cluster = [], jetzt = Date.now(), neueQuellen = [], neueBelege = [], aufgeloest = [], umgezogen = [], nurSeiten = null, gesperrt = [] } = {}) {
  const befunde = [];
  const b = (pfad, regel, meldung) => befunde.push({ pfad, regel, meldung });
  for (const d of dateien) {
    const p = norm(d.pfad);
    if (gesperrt.map(norm).includes(p)) { b(p, "gesperrt", "diese Datei nennt ein ausgeschlossenes Thema und darf nicht berührt werden"); continue; }
    if (/^\.tools(?:\/|$)/i.test(p)) { b(p, "tools", "Werkzeug-Code darf die Pflege nicht ändern"); continue; }
    if (GENERIERT_WURZEL.has(p) || istGeneriert(p, wiki)) { b(p, "generiert", "generierte Datei"); continue; }
    if (!sauberPfad(p) && d.status !== "geloescht") { b(p, "pfad", "Datei außerhalb der erlaubten Bereiche (Pfad nicht zulässig)"); continue; }
    if (d.symlink) { b(p, "pfad", "Symlinks sind nicht erlaubt"); continue; }
    if (d.status === "geloescht") { b(p, "geloescht", "die Pflege löscht nichts"); continue; }
    if (d.binaer) { b(p, "binaer", "Binärdatei — die Pflege schreibt nur Text (sie ließe sich nicht als Diff vorlegen)"); continue; }
    if (p === `${wiki}/_log.md`) {
      if (d.status !== "geaendert" || entfernteZeilen(d.alt, d.neu, { jetzt: 0 }).entfernt) b(p, "log", "_log.md ist append-only");
      continue;
    }
    if (!istWikiSeite(p, wiki)) {
      const beleg = BELEG_DATEI.exec(p);
      if (!(d.status === "neu" && (neueQuellen.map(norm).includes(p) || (beleg && cluster.includes(beleg[1]) && neueBelege.map(norm).includes(p))))) b(p, "pfad", "Datei außerhalb der erlaubten Bereiche");
      continue;
    }
    if (nurSeiten && !nurSeiten.map(norm).includes(p)) b(p, "fremde-seite", "diese Einheit darf nur ihre eigene Seite ändern");   // weiter prüfen: kritisch & Co. bleiben sichtbar
    if ((d.alt !== null && leseSeitenFelder(d.alt).kritisch) || leseSeitenFelder(d.neu ?? "").kritisch) { b(p, "kritisch", "kritische Seite"); continue; }
    if (d.status !== "geaendert") continue;
    const ausnahmen = new Set(umgezogen.map((z) => String(z).trim()).filter(Boolean));
    for (const fp of aufgeloest) {
      const r = kastenBereich(d.alt, fp);
      if (r) for (const z of lf(d.alt).split("\n").slice(r.start, r.ende)) if (z.trim()) ausnahmen.add(z.trim());
    }
    const e = entfernteZeilen(d.alt, d.neu, { jetzt, ausnahmen });
    if (e.anteil > MAX_ENTFERNT) b(p, "zu-viel-entfernt", `${e.entfernt} von ${e.gesamt} Zeilen entfernt oder umgeschrieben (mehr als 20 %)`);
    const links = belegLinks(d.neu);
    for (const l of belegLinks(d.alt)) if (!links.has(l)) b(p, "beleg-link", `Beleg-Link [[${l}]] fehlt`);
    const q = new Set(quellenListe(d.neu));
    for (const x of quellenListe(d.alt)) if (!q.has(x)) b(p, "quellen", `Quelle ${x} fehlt in quellen`);
    const bleiben = new Set(konfliktKaesten(lf(d.neu)).konflikte.map((k) => k.fp));
    for (const k of konfliktKaesten(lf(d.alt)).konflikte) {
      if (!bleiben.has(k.fp) && !aufgeloest.includes(k.fp)) b(p, "konflikt-aufgeloest", `Konflikt-Kasten „${k.a.text.slice(0, 40)}" ist verschwunden — Widersprüche löst nie die KI`);
    }
  }
  return { ok: !befunde.length, befunde };
}
