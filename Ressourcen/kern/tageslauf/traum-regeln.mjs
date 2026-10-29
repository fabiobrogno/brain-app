// tageslauf/traum-regeln.mjs — Regelprüfung des Traums, OHNE KI (0 Tokens), rein auf Texten (kein Dateizugriff, kein Git). Die KI hat im Arbeitsordner
// ein bereinigtes Gedächtnis hinterlassen und einen Bericht traum-bericht.json [{ datei, art, grund, beleg, nichtUebernommen? }]. Was davon gilt, entscheidet allein diese Prüfung:
//   Gesamtverwurf (nichts wird vorgeschlagen): eine gelöschte oder umbenannte Datei · ein Zugangsdaten-Muster in neu geschriebenen Zeilen oder im Bericht.
//   Dateiebene (die Änderung an GENAU dieser Datei fällt weg, der Rest bleibt): ohne Begründung im Bericht · Beleg-Zitat steht nicht wörtlich im Verlauf
//     (Pflicht bei neu/ueberholt/erledigt; bei neu in feedback-/user-Dateien nur ein Zitat des NUTZERS; Belegquelle sind NUR Nachrichtentexte — verlaeufe[].nachrichten —, nie die vom Kit
//     erzeugten Kopf-/Trenn-/Auslassungszeilen) · HERKUNFT JEDER NEUEN ZEILE (unabhängig von der Art): sie steht Zeichen für Zeichen (Leerraum normalisiert) schon in einer Datei des
//     Eingabe-Gedächtnisses (aus ANDERER Datei nur bei gleichem Typ UND „Zusammengeführt in <Ziel>.md“ in der Quelle; Konflikt-Kopie und Original sind ein Dokument; fällt die Quelle
//     weg, fällt das Ziel mit) ODER ein gültiges Beleg-Zitat TRÄGT genau diese Zeile (mindestens 60 % ihrer Wörter ab 4 Buchstaben, ohne Markdown, stehen im Zitat; in feedback/user nur ein
//     Nutzer-Zitat; eine Zeile, die wie Anweisung/Regel aussieht — istAnweisungsZeile —, braucht in JEDEM Typ ein Nutzer-Zitat: Claude-Zitate tragen nur Sachstände); frei erlaubt sind nur Frontmatter-Gerüst (---, metadata, node_type, type; name nur als ERSTE Zeile oben und nur bei einer neuen Datei passend zum Dateinamen — jede weitere name:-Zeile und jedes unbekannte Feld ist eine gewöhnliche neue Zeile), „status: erledigt“ (nur mit Eintrag „erledigt“ + Beleg), „Zusammengeführt in <Datei>.md“ und bei
//     Konflikt-Kopien „status: aufgeloest“/„Aufgelöst in <Original>.md“ · Art „konflikt“ nur für Dateien mit offener Konflikt-Kopie · „status: aufgeloest“ an einer Kopie nur, wenn
//     jede Inhaltszeile der Kopie im Ergebnis-Original steht oder der Bericht sie mit „nichtUebernommen“ (Begründung) bewusst verwirft · mehr als 30 % Zeilen entfernt
//     (alle Typen; Ausnahme nur Nicht-feedback/user mit Art „erledigt“ + gültigem Beleg, der die Mehrheit der entfernten Zeilen nennt — und nie die ganze Datei leeren) · eine entfernte
//     Zeile, die mit „:“ endet oder einschränkt (nur/gilt/außer/nicht/nie/kein/im …), ohne ein Beleg-Zitat, das sie trägt · neue Zeilen nennen ein ausgeschlossenes Thema ·
//     Frontmatter fehlt/kaputt oder der Typ wurde geändert · Platzhalter geschützter Zeilen fehlen/doppelt.
//   MEMORY.md: höchstens 200 Zeilen · neue Zeilen nur Index-Zeilen „- [Titel](datei.md) — …“ auf eine im Ergebnis vorhandene Datei (keine Freitext-Zeile, keine neue/geänderte
//     Überschrift; Titel UND Haken einer neuen/geänderten Zeile: wörtlich aus Name/description der Ziel-Datei oder von einem NUTZER-Zitat getragen) · ein entfernter Verweis braucht eine angenommene Änderung der Datei (Hinweis „zusammengeführt in …“/erledigt/aufgelöst
//     statt Löschen) · jede neue Datei steht im Index. Fällt MEMORY.md weg, fallen neue Dateien mit weg.
//   _konflikte.md: nur Zeilen entfernen (nie neue), und nur die von Kopien, die im Ergebnis aufgelöst sind.
// Das Ergebnis enthält nie das Wort eines ausgeschlossenen Themas und nie einen Zugangsdaten-Wert — nur Datei, Regel und Zeilennummer.
import { nenntThema } from "../thema-ausschluss.mjs";
import { zeilenMitSecrets, hatSecretsImKontext } from "../secrets-muster.mjs";
import { hinzugefuegt } from "./pflege-thema.mjs";
import { ANWEISUNG_MUSTER } from "./pflege-deckung.mjs";                                  // EIN Satz Anweisungsmuster im Kit (trage … ein, ins Wiki, schreibe, ignoriere …) — hier wiederverwendet, nicht kopiert
import { PLATZHALTER_MUSTER, DATEINAME, istKonfliktKopieMd, zeilenZahl } from "./traum-eingabe.mjs";
import { leseKonfliktName, istAufgeloesteKopie, leseKonfliktEintraege } from "../gedaechtnis.mjs";      // EIN Format der Konflikt-Kopien (kein zweiter Parser)

export const ARTEN = ["zusammengefuehrt", "ueberholt", "erledigt", "neu", "konflikt", "brain-kandidat"];
export const BELEG_PFLICHT = ["neu", "ueberholt", "erledigt"];
export const ENTFERNT_OK = ["zusammengefuehrt", "erledigt", "konflikt", "ueberholt"];      // Arten, die einen Index-Eintrag entfernen dürfen
export const TYPEN_GEDAECHTNIS = ["user", "feedback", "project", "reference", "session"];
export const MAX_MEMORY_ZEILEN = 200, MAX_ENTFERNT_ANTEIL = 0.3, MIN_BELEG = 12, MAX_BRAIN_KANDIDATEN = 10, MIN_BEGRUENDUNG = 10;
export const MIN_WORTDECKUNG = 0.6, MIN_WORTLAENGE = 4;      // Bindung des Belegs an eine Zeile: mindestens 60 % ihrer Wörter ab 4 Buchstaben stehen im Zitat
const SPEZIAL = new Set(["MEMORY.md", "_konflikte.md"]);

export const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const kurz = (s, n) => norm(s).slice(0, n);
// Anführungszeichen und Auslassungspunkte um ein Zitat sind keine Zitat-Zeichen.
export const saubereBeleg = (b) => norm(b).replace(/^[\s"„“”'‚‘’»«…]+|[\s"„“”'‚‘’»«…]+$/gu, "").replace(/^\.{3}|\.{3}$/g, "").trim();
export function belegGefunden(beleg, normierteTexte) {
  const b = saubereBeleg(beleg);
  return b.length >= MIN_BELEG && normierteTexte.some((t) => t.includes(b));
}
// Belegquellen: NUR Nachrichtentexte — v.nachrichten = [{ rolle: "Nutzer"|"Claude", text }], von sammleVerlaeufe (traum-eingabe.mjs) strukturiert mitgegeben. Die vom Kit erzeugten Kopf-,
// Trenn- und Auslassungszeilen von v.text zählen nie; ein Verlauf ohne `nachrichten` liefert keine Belege (fail-closed, kein Raten nach Mustern). → [normierter Text je Nachricht]
export function nachrichtenTexte(verlaeufe, nurNutzer = false) {
  return (Array.isArray(verlaeufe) ? verlaeufe : []).flatMap((v) => (Array.isArray(v?.nachrichten) ? v.nachrichten : []))
    .filter((m) => m && typeof m.text === "string" && (!nurNutzer || m.rolle === "Nutzer")).map((m) => norm(m.text));
}
// Für das Siegel eines Vorschlags: je Beleg-Zitat des Berichts die Rolle, in der es im Verlauf stand → [{ rolle, text }] (text = bereinigtes Zitat). Damit läuft die Regelprüfung beim Anwenden
// erneut (gegen den dann aktuellen Stand), ohne dass die — bis dahin vielleicht rotierten — Verläufe noch gebraucht werden: nachrichtenTexte([{ nachrichten: nachweise }]) liefert dieselben Quellen.
export function belegNachweise(bericht, verlaeufe) {
  const alle = nachrichtenTexte(verlaeufe), nutzer = nachrichtenTexte(verlaeufe, true), gesehen = new Set(), out = [];
  for (const e of Array.isArray(bericht) ? bericht : []) {
    const b = saubereBeleg(e?.beleg);
    if (!b || gesehen.has(b)) continue;
    gesehen.add(b);
    if (belegGefunden(b, nutzer)) out.push({ rolle: "Nutzer", text: b });
    else if (belegGefunden(b, alle)) out.push({ rolle: "Claude", text: b });
  }
  return out;
}
// Sieht die Zeile wie eine Anweisung/Regel an künftige Sitzungen aus? Dann trägt sie in JEDEM Dateityp nur ein NUTZER-Zitat (Claude-Zitate tragen nur Sachstände) — Claudes eigene Sätze können
// aus einer Webseite oder einem Tool-Ergebnis stammen. Muster: die der Pflege-Deckung (ANWEISUNG_MUSTER) plus Regel-/Imperativwörter. Im Zweifel „Anweisung“: lieber Lücke als Fehler.
const regelWort = (quelle) => new RegExp(`(?<![\\p{L}])(?:${quelle})(?![\\p{L}])`, "iu");
const REGEL_MUSTER = [
  regelWort("immer|stets|nie|niemals|zuerst|unbedingt|verboten|untersagt|pflicht|jedes\\s?mal|jederzeit|ausnahmslos"),
  /(?<![\p{L}])(?:vor|bei|nach|für|zu)\s+jed(?:er|em|en|es)(?![\p{L}])/iu,                       // vor jeder Antwort, bei jedem Start …
  regelWort("muss|musst|müssen|müsst|soll|sollst|sollen|sollt|sollte|sollten|darfst|dürft"),
  regelWort("ausführen|starte|startest|führe\\s+[^.!?\\n]{0,60}?\\s+aus|laufen\\s+lassen"),
  /(?<![\p{L}])WICHTIG(?![\p{L}])/u, /(?<![\p{L}])(?:wichtig|achtung|hinweis)\s*:/iu,
  regelWort("always|never|must|should|important|ignore|before\\s+every|each\\s+time|do\\s+not|don't"),
];
export const istAnweisungsZeile = (z) => { const t = String(z ?? ""); return [...ANWEISUNG_MUSTER, ...REGEL_MUSTER].some((re) => re.test(t)); };
// Wörter eines Textes: ohne Markdown (Links, Code, Auszeichnung, Checkbox), klein, nur Buchstaben — „feedback_x“ und „Commit-Nachrichten“ zerfallen in ihre Wörter.
const ohneMarkdown = (t) => String(t ?? "").normalize("NFC").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/`/g, " ").replace(/<[^>]*>/g, " ");
const woerterVon = (t) => [...new Set(ohneMarkdown(t).toLowerCase().match(/\p{L}+/gu) ?? [])];
// Anteil der Wörter (≥ 4 Buchstaben) der Zeile, die im Zitat vorkommen. Eine Zeile ohne solches Wort ist durch kein Zitat zu tragen (0). `kopf`: Frontmatter-Zeile — der Feldname zählt nicht.
export function wortDeckung(zeile, zitat, { kopf = false } = {}) {
  const lang = woerterVon(kopf ? String(zeile).replace(/^[A-Za-z_][\w-]*:\s*/, "") : zeile).filter((w) => [...w].length >= MIN_WORTLAENGE);
  if (!lang.length) return 0;
  const imZitat = new Set(woerterVon(zitat));
  return lang.filter((w) => imZitat.has(w)).length / lang.length;
}

export function parseFm(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(String(text ?? ""));
  if (!m) return null;
  const f = m[1];
  const feld = (k) => { const x = new RegExp(`^${k}:[ \\t]*(.*)$`, "m").exec(f); return x ? x[1].trim().replace(/^["']|["']$/g, "") : ""; };
  const typ = /^[ \t]*type:[ \t]*([A-Za-z]+)[ \t]*$/m.exec(f);
  return { name: feld("name"), description: feld("description"), type: typ ? typ[1] : "" };
}
const dateiTyp = (rel, fm) => fm?.type || (/^feedback_/.test(rel) ? "feedback" : /^user_/.test(rel) ? "user" : "");
const geschuetzteArt = (rel, fm) => /^(feedback|user)_/.test(rel) || ["feedback", "user"].includes(fm?.type);

const nichtLeer = (t) => String(t).split(/\r?\n/).map((z) => z.trim()).filter(Boolean);
const zaehler = (zeilen) => { const m = new Map(); for (const z of zeilen) m.set(z, (m.get(z) || 0) + 1); return m; };
// Anteil der ursprünglichen (nicht leeren) Zeilen, die im neuen Text nicht mehr vorkommen — mit Vielfachheit.
export function entferntAnteil(alt, neu) {
  const a = nichtLeer(alt), n = zaehler(nichtLeer(neu));
  if (!a.length) return 0;
  let weg = 0;
  for (const z of a) { const c = n.get(z) || 0; if (c > 0) n.set(z, c - 1); else weg++; }
  return weg / a.length;
}
const verweise = (text) => new Set([...String(text).matchAll(/\]\(([^)#\s]+\.md)\)/g)].map((m) => m[1]));

// ---------- Herkunft neuer Zeilen ----------
const normZeilen = (t) => nichtLeer(t).map(norm);
const KOPF_GERUEST = [/^metadata:$/, /^node_type:\s*\w+$/, /^type:\s*(user|feedback|project|reference|session)$/];     // Frontmatter-Gerüst: Typ, kein Freitext (description und name gehören NICHT dazu — name nur als erste Zeile oben, siehe nameOk)
const AUFGELOEST_ZEILE = /^status:\s*["']?aufgeloest["']?$/;
const ERLEDIGT_ZEILE = /^status:\s*["']?erledigt["']?$/;           // nur mit Eintrag „erledigt“ + gültigem Beleg (Sitzungs-Handoffs: nie feedback/user)
const RESTRIKTION = /(?<!\p{L})(?:nur|gilt|gelten|außer|ausser|nicht|nie|niemals|kein|keine|keinen|keiner|keinem|im|sonst|solange|sofern|ausschließlich|ausschliesslich)(?!\p{L})/iu;     // Einschränkungswörter
const GERUEST_ENTFERNT = /^(?:---|metadata:|node_type:.*|type:.*|name:.*)$/;       // Frontmatter-Gerüst zählt beim Entfernen nie als Inhalt
const HINWEIS_ZUSAMMEN = /^Zusammengeführt in ([A-Za-z0-9_][A-Za-z0-9._-]{0,150}\.md)\.?$/, HINWEIS_AUFGELOEST = /^Aufgelöst in ([A-Za-z0-9_][A-Za-z0-9._-]{0,150}\.md)\.?$/;
const INDEX_ZEILE = /^[-*]\s+\[([^\]\n]+)\]\(([^)\s#]+\.md)\)(?:\s*[—–-]\s*(.*))?$/;      // 1 Titel, 2 Ziel-Datei, 3 Haken
// Zeilen, die in `neu` stehen und in `alt` nicht (Leerraum normalisiert), ohne Leerzeilen und ohne das erlaubte Frontmatter-Gerüst. `kopfOk(z)`: weitere erlaubte Frontmatter-Zeilen.
// `name:` ist nur als ERSTE Zeile auf oberster Ebene (nicht eingerückt) Gerüst und nur, wenn `nameOk(z)` es erlaubt (neue Datei: passt zum Dateinamen); jede weitere name:-Zeile und
// jede eingerückte ist eine gewöhnliche neue Zeile mit Herkunftstest. Bei bestehenden Dateien gilt `name:` nur unverändert (dann ist es ohnehin keine neue Zeile).
function neueZeilenDetail(alt, neu, { kopfOk = () => false, nameOk = () => false } = {}) {
  const vorhanden = new Set(String(alt ?? "").split(/\r?\n/).map(norm));
  const out = [];
  let imKopf = false, kopfFertig = false, nameGesehen = false;
  String(neu ?? "").split(/\r?\n/).forEach((roh, i) => {
    const z = norm(roh);
    let geruest = false;
    if (!kopfFertig && !imKopf && i === 0 && z === "---") { imKopf = true; geruest = true; }
    else if (imKopf && z === "---") { imKopf = false; kopfFertig = true; geruest = true; }
    else if (imKopf && /^name:/.test(roh)) { geruest = !nameGesehen && nameOk(z); nameGesehen = true; }       // oberste Ebene: Zeile beginnt in Spalte 0
    else if (imKopf) geruest = KOPF_GERUEST.some((r) => r.test(z)) || kopfOk(z);
    if (z && !geruest && !vorhanden.has(z)) out.push({ z, kopf: imKopf });
  });
  return out;                                                   // [{ z, kopf }] — kopf: die Zeile steht im Frontmatter
}
const neueZeilen = (alt, neu, optionen) => neueZeilenDetail(alt, neu, optionen).map((x) => x.z);
// kebab-case-Ableitung: „Feedback Antwort_Deutsch“ → „feedback-antwort-deutsch“.
const kebab = (t) => String(t ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
// Passt der name zum Dateinamen (mit oder ohne Typ-Präfix)? Nur dann ist die erste name:-Zeile einer NEUEN Datei Gerüst.
const nameZuDatei = (z, rel) => {
  const wert = z.replace(/^name:\s*/, "").replace(/^["']|["']$/g, ""), stamm = String(rel).replace(/\.md$/i, "");
  const k = kebab(wert);
  return !!k && (k === kebab(stamm) || k === kebab(stamm.replace(/^(?:feedback|user|project|reference|session)[_-]/, "")));
};
// Text ohne Frontmatter-Block (die Inhaltszeilen einer Datei), normalisiert.
const koerperZeilen = (t) => normZeilen(String(t ?? "").replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, ""));
// Die (normalisierten) Zeilen im Frontmatter-Block eines Textes.
const kopfZeilenVon = (t) => { const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(String(t ?? "")); return new Set(m ? m[1].split(/\r?\n/).map(norm) : []); };
// inhaltsSchluessel: Checkbox-/Markdown-neutral (für leertDatei) — „- [ ] Deploy“ und „- [x] Deploy“ sind derselbe Punkt.
const inhaltsSchluessel = (z) => woerterVon(z).join(" ");
// Inhaltszeilen von `alt`, die im neuen Text wörtlich nirgends mehr stehen (Leerraum normalisiert, ohne Frontmatter-Gerüst) — der wirklich verlorene Inhalt.
const entferntZeilen = (alt, neu) => { const bleibt = new Set(normZeilen(neu)); return [...new Set(normZeilen(alt))].filter((z) => !bleibt.has(z) && !GERUEST_ENTFERNT.test(z)); };
// „Datei geleert“: keine einzige Inhaltszeile des Körpers kommt im neuen Körper noch vor.
const leertDatei = (alt, neu) => { const rest = new Set(koerperZeilen(neu).map(inhaltsSchluessel)); return !koerperZeilen(alt).some((z) => inhaltsSchluessel(z) && rest.has(inhaltsSchluessel(z))); };

// Geschützte Zeilen zurück an ihren Platz. → { text } | { fehler }. Jeder Platzhalter muss genau einmal vorkommen, fremde Platzhalter sind verboten.
export function setzeMaskeEin(text, maske) {
  const zeilen = String(text).split("\n");
  const gefunden = new Map();
  for (const z of zeilen) { const t = z.trim(); if (PLATZHALTER_MUSTER.test(t)) gefunden.set(t, (gefunden.get(t) || 0) + 1); }
  for (const m of maske) if (gefunden.get(m.platzhalter) !== 1) return { fehler: "ein geschützter Platzhalter fehlt oder steht mehrfach" };
  if (gefunden.size !== maske.length) return { fehler: "ein erfundener Platzhalter" };
  const nach = new Map(maske.map((m) => [m.platzhalter, m.zeile]));
  return { text: zeilen.map((z) => nach.get(z.trim()) ?? z).join("\n") };
}

// → { gesamt: null | { regel, meldung }, dateien: Map<name, text>, neu: Set<name>, bericht: [Eintrag], verworfen: [{ datei, regel, meldung }],
//     brainKandidaten: [{ grund, beleg, datei }], secrets: [{ datei, zeile }], plus, minus, berichtFehlt }
//   basis: Map<name, Originaltext> der kopierten Dateien · vorschlag: Map<name, Text> aus dem Arbeitsordner (maskierte Dateien MIT Platzhaltern)
//   maske: Map<name, [{ platzhalter, zeile }]> · fremdeNamen: Dateien der Wurzel, die die KI nie sah (Name tabu für neue Dateien)
export function pruefeVorschlag({ basis, vorschlag, bericht, verlaeufe, woerter, maske = new Map(), fremdeNamen = new Set() }) {
  const out = { gesamt: null, dateien: new Map(), neu: new Set(), bericht: [], verworfen: [], brainKandidaten: [], secrets: [], plus: 0, minus: 0, berichtFehlt: false };
  const weg = (datei, regel, meldung) => out.verworfen.push({ datei: nenntThema(woerter, datei) ? "(ausgeschlossenes Thema)" : datei, regel, meldung });   // nie das Wort selbst weitergeben
  const gesamt = (regel, meldung) => { out.gesamt = { regel, meldung }; return out; };

  // 1. Löschen/Umbenennen: nie.
  for (const n of basis.keys()) if (!vorschlag.has(n)) return gesamt("geloescht", `Datei ${n} fehlt im Vorschlag (gelöscht oder umbenannt) — nichts wird vorgeschlagen`);

  // 2. Geschützte Zeilen einsetzen; Dateien, bei denen das misslingt, bleiben wie sie waren.
  const neuText = new Map();
  for (const [n, t] of vorschlag) {
    const r = setzeMaskeEin(t, maske.get(n) || []);
    if (r.fehler) { weg(n, "geschuetzt", r.fehler); if (basis.has(n)) neuText.set(n, basis.get(n)); continue; }      // neue Datei mit Platzhalter-Unfug: weggelassen
    neuText.set(n, r.text);
  }
  const geaendert = [...neuText].filter(([n, t]) => basis.has(n) && t !== basis.get(n)).map(([n]) => n);
  const neuDateien = [...neuText.keys()].filter((n) => !basis.has(n));

  // 3. Zugangsdaten in neu geschriebenen Zeilen oder im Bericht → Gesamtverwurf, gemeldet nur mit Datei und Zeile.
  const roh = Array.isArray(bericht) ? bericht : Array.isArray(bericht?.eintraege) ? bericht.eintraege : null;
  for (const n of [...geaendert, ...neuDateien]) {
    const alt = basis.get(n) ?? "", neu = neuText.get(n);
    const vorhanden = new Set(String(alt).split(/\r?\n/).map((z) => z.trim()));
    const { zeilen, treffer } = zeilenMitSecrets(neu);
    for (const i of treffer) if (!vorhanden.has(zeilen[i].trim())) out.secrets.push({ datei: n, zeile: i + 1 });
    if (!out.secrets.some((s) => s.datei === n) && hatSecretsImKontext(hinzugefuegt(alt, neu))) out.secrets.push({ datei: n, zeile: 0 });
  }
  for (const e of roh || []) if (e && typeof e === "object" && hatSecretsImKontext([e.datei, e.grund, e.beleg, e.nichtUebernommen].filter((x) => typeof x === "string").join("\n"))) out.secrets.push({ datei: "traum-bericht.json", zeile: 0 });
  if (out.secrets.length) return gesamt("secret", `Zugangsdaten-Muster im Vorschlag (${[...new Set(out.secrets.map((s) => s.datei))].join(", ")}) — verworfen`);

  // 4. Bericht: Form prüfen.
  if (!roh) out.berichtFehlt = true;
  const ber = [];
  for (const e of roh || []) {
    const art = e && typeof e === "object" ? String(e.art ?? "") : "";
    let datei = e && typeof e === "object" ? String(e.datei ?? "").trim().replace(/^\.\//, "").replace(/^gedaechtnis\//, "") : "";
    if (datei === "-") datei = "";
    if (!ARTEN.includes(art) || /[\\/]|\.\./.test(datei) || (art !== "brain-kandidat" && !datei) || !norm(e.grund)) { weg(datei || "-", "bericht-form", "Berichtseintrag unbrauchbar (Art, Datei oder Grund)"); continue; }
    const nichtUebernommen = typeof e.nichtUebernommen === "string" && norm(e.nichtUebernommen).length >= MIN_BEGRUENDUNG ? kurz(e.nichtUebernommen, 400) : "";
    ber.push({ datei, art, grund: kurz(e.grund, 400), beleg: kurz(e.beleg, 600), ...(nichtUebernommen ? { nichtUebernommen } : {}) });
  }
  const alleTexte = nachrichtenTexte(verlaeufe), nutzerTexte = nachrichtenTexte(verlaeufe, true);      // nur echte Nachrichten, nie Kopf-/Trenn-/Auslassungszeilen des Kits

  // 5. Brain-Kandidaten (ändern nichts am Gedächtnis).
  for (const e of ber.filter((x) => x.art === "brain-kandidat")) {
    if (out.brainKandidaten.length >= MAX_BRAIN_KANDIDATEN) break;
    if (!belegGefunden(e.beleg, alleTexte)) { weg(e.datei || "-", "beleg", "Vault-Kandidat ohne wörtliches Zitat aus einem Verlauf"); continue; }
    if (nenntThema(woerter, e.grund, e.beleg, e.datei)) { weg(e.datei || "-", "thema", "Vault-Kandidat nennt ein ausgeschlossenes Thema"); continue; }
    out.brainKandidaten.push({ grund: e.grund, beleg: e.beleg, datei: e.datei || "-" });
  }
  const eintraege = (n) => ber.filter((e) => e.art !== "brain-kandidat" && e.datei === n);

  // Herkunft: jede NEUE Zeile steht wörtlich in einer Datei des Eingabe-Gedächtnisses (Basis inkl. Konflikt-Kopien) — „aus anderer Datei“ aber nur unter den Bedingungen von herkunftAusDatei —
  // oder ein gültiges Beleg-Zitat trägt sie. zeilenQuellen: Zeile → Dateien der Basis, in denen sie steht.
  const zeilenQuellen = new Map();
  for (const [n, t] of basis) for (const z of new Set(normZeilen(t))) { if (!zeilenQuellen.has(z)) zeilenQuellen.set(z, []); zeilenQuellen.get(z).push(n); }
  const eingabeZeilen = new Set(zeilenQuellen.keys());
  const gleichesDokument = (a, b) => leseKonfliktName(a)?.original === b || leseKonfliktName(b)?.original === a;      // Konflikt-Kopie und ihr Original sind ein Dokument
  // Offene Konflikt-Kopien (Namensmuster des Abgleichs, noch nicht aufgelöst): nur zu diesen Dateien (Kopie oder Original) gibt es einen „konflikt“.
  const offeneKopien = [...basis].filter(([n, t]) => istKonfliktKopieMd(n) && !istAufgeloesteKopie(n, t)).map(([n]) => n);
  const konfliktBezug = (n) => n === "_konflikte.md" ? offeneKopien.length > 0 : offeneKopien.some((k) => k === n || leseKonfliktName(k)?.original === n);
  const istAufloesung = (n) => basis.has(n) && istKonfliktKopieMd(n) && neuText.has(n) && istAufgeloesteKopie(n, neuText.get(n)) && !istAufgeloesteKopie(n, basis.get(n));
  // Beleg je ZEILE gebunden: ein gültiges Zitat (feedback/user: nur des Nutzers) UND mindestens 60 % der Wörter ab 4 Buchstaben der Zeile stehen darin. `kopf`: Frontmatter-Zeile.
  // `neu`: eine NEUE Zeile, die wie eine Anweisung/Regel aussieht, braucht in jedem Dateityp ein Nutzer-Zitat (istAnweisungsZeile).
  const deckt = (z, eintr, typ, kopf = false, neu = false) => {
    const quellen = ["feedback", "user"].includes(typ) || (neu && istAnweisungsZeile(kopf ? z.replace(/^[A-Za-z_][\w-]*:\s*/, "") : z)) ? nutzerTexte : alleTexte;
    return eintr.some((e) => belegGefunden(e.beleg, quellen) && wortDeckung(z, e.beleg, { kopf }) >= MIN_WORTDECKUNG);
  };
  const existiertNach = new Set([...basis.keys(), ...neuDateien]);

  // 6. Themen-Dateien (nicht MEMORY.md/_konflikte.md): jede Änderung für sich. Aufgelöste Konflikt-Kopien zuletzt (sie hängen am Ergebnis ihres Originals).
  const angenommen = new Map();                                        // name → neuer Text
  const abhaengig = new Map();                                         // name → Dateien, auf deren angenommener Änderung seine Herkunft beruht (Quelle mit Hinweis, Original der Kopie)
  const kandidaten = [...geaendert, ...neuDateien].filter((x) => !SPEZIAL.has(x));
  for (const n of [...kandidaten.filter((x) => !istAufloesung(x)), ...kandidaten.filter(istAufloesung)]) {
    const alt = basis.get(n), neu = neuText.get(n), istNeu = alt === undefined;
    const fmAlt = istNeu ? null : parseFm(alt), fmNeu = parseFm(neu);
    const typ = dateiTyp(n, fmNeu);
    const ein = eintraege(n);
    const quellenDieserDatei = new Set();
    const fehler = (() => {
      if (istNeu && (!DATEINAME.test(n) || n.startsWith("_") || istKonfliktKopieMd(n) || fremdeNamen.has(n))) return ["neu-name", "Name der neuen Datei unzulässig oder schon vergeben"];
      if (nenntThema(woerter, n, hinzugefuegt(alt ?? "", neu)) || ein.some((e) => nenntThema(woerter, e.grund, e.beleg, e.nichtUebernommen))) return ["thema", "neue Zeilen oder die Begründung nennen ein ausgeschlossenes Thema"];
      if (istNeu && !(fmNeu && fmNeu.name && fmNeu.description && TYPEN_GEDAECHTNIS.includes(fmNeu.type))) return ["frontmatter", "neue Datei ohne gültiges Frontmatter (name, description, type)"];
      if (fmAlt && !(fmNeu && fmNeu.name && fmNeu.description)) return ["frontmatter", "Frontmatter kaputt oder entfernt"];
      if (fmAlt && fmAlt.type !== fmNeu.type) return ["frontmatter", "der Typ der Datei wurde geändert"];
      if (!ein.length) return ["ohne-begruendung", "keine Begründung im Bericht"];
      if (ein.some((e) => e.art === "konflikt") && !konfliktBezug(n)) return ["konflikt", "Eintrag „konflikt“, aber zu dieser Datei gibt es keine offene Konflikt-Kopie"];
      if (istNeu && !ein.some((e) => ["neu", "zusammengefuehrt"].includes(e.art))) return ["ohne-begruendung", "neue Datei ohne Eintrag „neu“ oder „zusammengefuehrt“"];
      for (const e of ein.filter((x) => BELEG_PFLICHT.includes(x.art))) {
        const quellen = e.art === "neu" && ["feedback", "user"].includes(typ) ? nutzerTexte : alleTexte;
        if (!belegGefunden(e.beleg, quellen)) return ["beleg", `Beleg-Zitat zu „${e.art}“ steht nicht wörtlich im Verlauf${quellen === nutzerTexte ? " (für feedback/user zählt nur ein Zitat des Nutzers)" : ""}`];
      }
      // Herkunft: unabhängig von der angegebenen Art — auch „zusammengefuehrt“ und „konflikt“ dürfen nichts Ungeprüftes einführen. JEDE neue Zeile für sich: wörtlich aus dem Gedächtnis
      // oder durch ein Zitat gedeckt, das sie inhaltlich trägt (kein Zitat deckt „die Datei“).
      const geschuetzt = geschuetzteArt(n, fmAlt ?? fmNeu);
      const erledigtBeleg = !geschuetzt && ein.some((e) => e.art === "erledigt" && belegGefunden(e.beleg, alleTexte));
      // „Aus anderer Datei“ zählt als Herkunft nur, wenn Quelle und Ziel DENSELBEN Typ haben UND die Quelle im selben Vorschlag „Zusammengeführt in <Ziel>.md“ bekommt (sonst würde aus einer
      // Ausnahme in einer project-Datei eine allgemeine Regel in feedback); Konflikt-Kopie und Original sind dasselbe Dokument. Die Quelle wird vermerkt: fällt ihre Änderung weg, fällt das Ziel mit.
      const hatHinweis = (s) => normZeilen(neuText.get(s) ?? "").some((x) => HINWEIS_ZUSAMMEN.exec(x)?.[1] === n);
      const herkunftAusDatei = (z) => {
        for (const s of zeilenQuellen.get(z) || []) {
          if (s === n) continue;
          if (gleichesDokument(n, s)) return true;
          if (SPEZIAL.has(s) || SPEZIAL.has(n)) continue;
          const styp = dateiTyp(s, parseFm(basis.get(s)));
          if (styp && styp === typ && hatHinweis(s)) { quellenDieserDatei.add(s); return true; }
        }
        return false;
      };
      const ohneHerkunft = neueZeilenDetail(alt, neu, { kopfOk: (z) => (istAufloesung(n) && AUFGELOEST_ZEILE.test(z)) || (erledigtBeleg && ERLEDIGT_ZEILE.test(z)), nameOk: (z) => istNeu && nameZuDatei(z, n) }).filter(({ z, kopf }) => {
        if (herkunftAusDatei(z)) return false;
        const hz = HINWEIS_ZUSAMMEN.exec(z);
        if (hz && hz[1] !== n && existiertNach.has(hz[1])) return false;
        const ha = HINWEIS_AUFGELOEST.exec(z);
        if (ha && istAufloesung(n) && leseKonfliktName(n)?.original === ha[1]) return false;
        return !deckt(z, ein, typ, kopf, true);
      });
      if (ohneHerkunft.length) return ["herkunft", `${ohneHerkunft.length} neue Zeile(n) ohne Herkunft: weder wörtlich aus dem Gedächtnis noch von einem wörtlichen Zitat aus einem Verlauf getragen${["feedback", "user"].includes(typ) ? " (für feedback/user: des Nutzers)" : ""}`];
      if (istAufloesung(n)) {
        const original = leseKonfliktName(n).original;
        const ergebnisOriginal = angenommen.has(original) ? angenommen.get(original) : basis.get(original);
        if (angenommen.has(original)) quellenDieserDatei.add(original);               // die Auflösung beruht auf der angenommenen Änderung des Originals
        if (ergebnisOriginal === undefined) return ["konflikt-nicht-uebernommen", "das Original der Konflikt-Kopie fehlt oder die Änderung daran wurde verworfen"];
        const imOriginal = new Set(normZeilen(ergebnisOriginal));
        const fehlend = koerperZeilen(alt).filter((z) => !imOriginal.has(z));
        if (fehlend.length && ![...ein, ...eintraege(original)].some((e) => e.art === "konflikt" && e.nichtUebernommen)) {
          return ["konflikt-nicht-uebernommen", `„status: aufgeloest“, aber ${fehlend.length} Zeile(n) der Kopie stehen nicht im Original und sind nicht als bewusst verworfen begründet (nichtUebernommen)`];
        }
      }
      // Entfernen: über 30 % nie — außer beim Abhaken (Art „erledigt“, nur Nicht-feedback/user): dann muss das Beleg-Zitat die entfernten Punkte im Kern nennen (Mehrheit der entfernten
      // Zeilen, gleiche Wortregel) — und die Datei bleibt, nie ganz geleert.
      if (!istNeu && entferntAnteil(alt, neu) > MAX_ENTFERNT_ANTEIL) {
        const grenze = `mehr als ${Math.round(MAX_ENTFERNT_ANTEIL * 100)} % der Zeilen entfernt`;
        const erledigtEintraege = geschuetzt ? [] : ein.filter((e) => e.art === "erledigt" && belegGefunden(e.beleg, alleTexte));
        if (!erledigtEintraege.length) return ["entfernt-zu-viel", grenze];
        const weg = entferntZeilen(alt, neu);
        const genannt = weg.filter((z) => erledigtEintraege.some((e) => wortDeckung(z, e.beleg) >= MIN_WORTDECKUNG));
        if (weg.length && genannt.length * 2 <= weg.length) return ["entfernt-zu-viel", `${grenze}; das Beleg-Zitat nennt die entfernten Punkte nicht (${genannt.length} von ${weg.length} Zeilen)`];
        if (leertDatei(alt, neu)) return ["entfernt-zu-viel", `${grenze}; die Datei würde ganz geleert — nur Status erledigt setzen und offene Punkte abhaken`];
      }
      // Entfernte Zeilen, die einschränken (enden mit „:“ oder enthalten ein Einschränkungswort), brauchen einen Beleg, der sie trägt (Wortregel; feedback/user: Nutzer-Zitat) — sonst
      // würde aus einer Ausnahme still eine allgemeine Regel.
      if (!istNeu) {
        const kopfAlt = kopfZeilenVon(alt);
        const unbelegt = entferntZeilen(alt, neu).filter((z) => (/:$/.test(z) || RESTRIKTION.test(z)) && !deckt(z, ein, typ, kopfAlt.has(z)));
        if (unbelegt.length) return ["entfernt-einschraenkung", `${unbelegt.length} einschränkende Zeile(n) entfernt, ohne dass ein Beleg-Zitat sie trägt`];
      }
      return null;
    })();
    if (fehler) weg(n, fehler[0], fehler[1]); else { angenommen.set(n, neu); if (quellenDieserDatei.size) abhaengig.set(n, quellenDieserDatei); }
  }
  // Beruht die Herkunft einer Datei auf der Änderung einer Quelle, die verworfen wurde, fällt auch sie (bis nichts mehr nachrückt).
  for (let nochmal = true; nochmal;) {
    nochmal = false;
    for (const [n, quellen] of abhaengig) {
      if (angenommen.has(n) && [...quellen].some((s) => !angenommen.has(s))) { angenommen.delete(n); weg(n, "herkunft", "die Quelle übernommener Zeilen (Hinweis „Zusammengeführt in …“ bzw. Original) wurde verworfen"); nochmal = true; }
    }
  }

  // 7. MEMORY.md und Index — mit Rückwirkung auf neue Dateien (jede muss im Index stehen).
  const memAlt = basis.get("MEMORY.md"), memNeu = neuText.get("MEMORY.md");
  let memGut = memNeu !== undefined && memAlt !== undefined && memNeu !== memAlt;
  const kleinNorm = (t) => norm(String(t ?? "").replace(/[_-]+/g, " ")).toLowerCase();
  const memPruefen = () => {
    const ein = eintraege("MEMORY.md");
    const indexTextOk = (titel, haken, ziel) => {
      const fmZiel = parseFm(angenommen.get(ziel) ?? basis.get(ziel) ?? ""), stamm = ziel.replace(/\.md$/, "");
      const eigene = [fmZiel?.name, fmZiel?.description, stamm].filter(Boolean).map(kleinNorm);
      const nutzerZitate = [...ein, ...eintraege(ziel)].filter((e) => belegGefunden(e.beleg, nutzerTexte)).map((e) => e.beleg);
      const hakenOk = !norm(haken) || eigene.some((q) => q.includes(kleinNorm(haken))) || nutzerZitate.some((b) => wortDeckung(haken, b) >= MIN_WORTDECKUNG);
      const titelOk = eigene.some((q) => q.includes(kleinNorm(titel))) || nutzerZitate.some((b) => wortDeckung(titel, b) >= MIN_WORTDECKUNG) || wortDeckung(titel, eigene.join(" ")) >= MIN_WORTDECKUNG;      // Titel: ein Etikett — auch aus den Wörtern von Name/description abgeleitet
      return hakenOk && titelOk;
    };
    if (nenntThema(woerter, hinzugefuegt(memAlt, memNeu)) || ein.some((e) => nenntThema(woerter, e.grund, e.beleg))) return ["thema", "neue Zeilen oder die Begründung nennen ein ausgeschlossenes Thema"];
    if (zeilenZahl(memNeu) > MAX_MEMORY_ZEILEN) return ["zu-lang", `MEMORY.md hätte mehr als ${MAX_MEMORY_ZEILEN} Zeilen`];
    if (!ein.length && !angenommen.size) return ["ohne-begruendung", "keine Begründung im Bericht"];
    if (ein.some((e) => e.art === "konflikt") && !konfliktBezug("MEMORY.md")) return ["konflikt", "Eintrag „konflikt“, aber zu dieser Datei gibt es keine offene Konflikt-Kopie"];
    for (const e of ein.filter((x) => BELEG_PFLICHT.includes(x.art))) if (!belegGefunden(e.beleg, alleTexte)) return ["beleg", `Beleg-Zitat zu „${e.art}“ steht nicht wörtlich im Verlauf`];
    const vorher = verweise(memAlt), nachher = verweise(memNeu);
    const existiert = new Set([...basis.keys(), ...fremdeNamen, ...angenommen.keys()]);
    for (const z of nachher) if (!vorher.has(z) && !existiert.has(z)) return ["index", "ein neuer Verweis zeigt auf eine nicht vorhandene Datei"];
    for (const z of vorher) {
      if (nachher.has(z)) continue;
      if (!(angenommen.has(z) && eintraege(z).some((e) => ENTFERNT_OK.includes(e.art)))) return ["index", "ein Verweis wurde entfernt, ohne dass die Datei einen Hinweis („zusammengeführt in …“, erledigt) bekommt"];
    }
    // Neue Zeilen: nur Index-Zeilen auf eine im Ergebnis vorhandene Datei; Freitext und Überschriften nie. Titel UND Haken einer neuen oder geänderten Index-Zeile brauchen Herkunft:
    // wörtlich aus Name/description der Ziel-Datei oder von einem NUTZER-Zitat getragen (Wortregel) — nie von der schwächsten Quelle (Claude-Text, Kopfzeile).
    for (const z of neueZeilen(memAlt, memNeu)) {
      if (/^#/.test(z)) return ["index", "eine Überschrift in MEMORY.md wurde hinzugefügt oder geändert"];
      const m = INDEX_ZEILE.exec(z);
      if (!m) return ["index", "neue Zeile in MEMORY.md ist kein Index-Eintrag „- [Titel](datei.md) — …“"];
      const [, titel, ziel, haken = ""] = m;
      if (!existiert.has(ziel) || SPEZIAL.has(ziel) || istKonfliktKopieMd(ziel)) return ["index", "ein neuer Index-Eintrag zeigt auf keine vorhandene Themen-Datei"];
      if (!indexTextOk(titel, haken, ziel)) return ["herkunft", "neue Index-Zeile ohne Herkunft (Titel/Haken weder aus Name oder description der Datei noch von einem Nutzer-Zitat getragen)"];
    }
    return null;
  };
  for (let runde = 0; runde < 6; runde++) {
    let nochmal = false;
    if (memGut) {
      const f = memPruefen();
      if (f) { weg("MEMORY.md", f[0], f[1]); memGut = false; nochmal = true; }
    }
    const imIndex = memGut ? verweise(memNeu) : new Set(verweise(memAlt ?? ""));
    for (const n of [...angenommen.keys()].filter((x) => !basis.has(x))) {
      if (!imIndex.has(n) || !memGut) { angenommen.delete(n); weg(n, "index", "neue Datei steht nicht im (angenommenen) Index von MEMORY.md"); nochmal = true; }
    }
    if (!nochmal) break;
  }
  if (memGut) angenommen.set("MEMORY.md", memNeu);

  // 8. _konflikte.md: nur Zeilen entfernen — und nur die von Kopien, die im Ergebnis als aufgelöst angenommen sind.
  const kAlt = basis.get("_konflikte.md"), kNeu = neuText.get("_konflikte.md");
  if (kAlt !== undefined && kNeu !== undefined && kNeu !== kAlt) {
    const bleiben = new Set(leseKonfliktEintraege(kNeu).map((e) => e.kopie));
    const gestrichen = leseKonfliktEintraege(kAlt).filter((e) => !bleiben.has(e.kopie));
    if (nenntThema(woerter, hinzugefuegt(kAlt, kNeu))) weg("_konflikte.md", "thema", "neue Zeilen nennen ein ausgeschlossenes Thema");
    else if (neueZeilen(kAlt, kNeu).some((z) => !eingabeZeilen.has(z))) weg("_konflikte.md", "herkunft", "neue Zeilen in _konflikte.md — erlaubt ist nur das Entfernen aufgelöster Einträge");
    else if (![...angenommen.keys()].some((n) => eintraege(n).some((e) => e.art === "konflikt"))) weg("_konflikte.md", "ohne-begruendung", "keine angenommene Konflikt-Auflösung dazu");
    else if (gestrichen.some((e) => !(angenommen.has(e.kopie) && istAufgeloesteKopie(e.kopie, angenommen.get(e.kopie))))) weg("_konflikte.md", "konflikt-nicht-aufgeloest", "ein Eintrag wurde gestrichen, dessen Konflikt-Kopie nicht als aufgelöst angenommen ist");
    else angenommen.set("_konflikte.md", kNeu);
  }

  // 9. Ergebnis: nur angenommene Dateien, nur deren Berichtseinträge.
  for (const [n, t] of angenommen) {
    out.dateien.set(n, t);
    if (!basis.has(n)) out.neu.add(n);
    const alt = basis.get(n) ?? "";
    out.plus += nichtLeer(hinzugefuegt(alt, t)).length;
    const behalten = new Set(nichtLeer(t));
    out.minus += nichtLeer(alt).filter((z) => !behalten.has(z)).length;
  }
  out.bericht = ber.filter((e) => e.art !== "brain-kandidat" && angenommen.has(e.datei));
  for (const e of ber.filter((x) => x.art !== "brain-kandidat" && !angenommen.has(x.datei) && !out.verworfen.some((v) => v.datei === x.datei))) {
    weg(e.datei, "ohne-aenderung", "im Bericht genannt, aber ohne gültige Änderung an der Datei");
  }
  return out;
}
