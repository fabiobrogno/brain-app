// tageslauf/heilung.mjs — Selbstheilung des Aktionsprotokolls (B2, Folgepunkt „Doppelausfall nach dem Merge“).
// Problem: Die Übernahme-Aktionen werden direkt nach dem Merge ins Protokoll geschrieben (append + fsync), das finally am Laufende holt es nach. Scheitern BEIDE (Ordner
// statt aktionen.jsonl, Rechte, voller Datenträger), stehen die Übernahmen auf main, aber nicht im Protokoll: Das Einschwing-Tor (zählt nur das Protokoll) öffnet nach der
// Heilung des Protokolls wieder (A = 0), und `brain zurueck` findet die Commits nicht (findeCommits verlangt die Aktion).
// Heilung: Jeder Commit auf main mit dem Betreff-Muster des Tageslaufs (auto(<lauf>): … [<id>], siehe BETREFF_MUSTER/commitsDesLaufs) UND der Autor-Identität des Tageslaufs
// (AUTOR in arbeitskopie.mjs — ein von Hand so betitelter Commit zählt nicht) OHNE passende Aktion wird als Aktion
// rekonstruiert — aus dem Commit selbst (geänderte Dateien, Beleg-Datei mit Titel/Zitat/Herkunft/Fundstelle, Betreff). Lauf-Nummer, ID, Commit, Seite, Art und Zeit (= Zeit des
// Laufs, aus der Lauf-Nummer) sind exakt; „auto“ lässt sich nicht erkennen (eine von dir freigegebene Übernahme sieht aus wie eine automatische) — im Zweifel zählt eine
// Fakt-/Stand-Übernahme als automatische Einschwing-Übernahme (auto + einschwingen): fail-closed fürs Tor, sie bekommt ihre Stichprobe. Felder (zweifel …) zählen nicht.
// „Passende Aktion“ = Aktion mit diesem Commit-Hash ODER mit gleicher Lauf-Nummer und ID (dann fehlt höchstens der Hash: kommt als Nachtrag dazu). Schon zurückgenommene
// Commits (Aktion „zurueck“ mit von = Hash) werden nie wiederbelebt. Idempotent: nach dem Schreiben gibt es nichts mehr zu tun.
// Wann: zu Beginn jedes scharfen Laufs (Fenster: Commits der letzten 30 Tage nach der Lauf-Nummer — ältere hätten weder für Tor noch Stichprobe Gewicht, und ein
// verlorenes .logs würde sonst die ganze Historie zurückholen) und in `brain zurueck <lauf|id>` (gezielt, ohne Altersgrenze).
// Ist das Protokoll nicht lesbar oder nicht schreibbar, wird nichts geschrieben und der Fehler gemeldet (nie Doppeltes aus einem „leer“ gelesenen Protokoll).
import { ordner } from "../pfade.mjs";
import { git, BETREFF_MUSTER, AUTOR } from "./arbeitskopie.mjs";
import { leseFm } from "./bestand.mjs";
import { leseAktionenStreng, haengeAktionenAn, notiere } from "./protokoll.mjs";
import { BELEG_MUSTER } from "./schreiben.mjs";

export const HEILUNG_TAGE = 30;
const TAG = 86400e3;
const UEBERNAHME_STUFEN = new Set(["uebernehmen", "stand", "feld"]);
const kurz = (s, n = 200) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const text = (x) => (typeof x === "string" ? x : "");

// Lauf-Nummer YYYYMMDD-HHMMSS (UTC, siehe laufId) → ms; keine Lauf-Nummer in dieser Form → NaN.
const laufMs = (lauf) => {
  const m = String(lauf).match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN;
};
const fmSchluessel = (t) => {
  const z = String(t).replace(/\r\n/g, "\n").split("\n");
  const ende = z[0] === "---" ? z.indexOf("---", 1) : -1;
  const m = new Map();
  if (ende < 0) return m;
  for (const l of z.slice(1, ende)) { const k = l.match(/^([A-Za-z_][\w-]*):\s?(.*)$/); if (k) m.set(k[1], k[2].trim()); }
  return m;
};

// Eine Aktion aus einem Commit — oder null, wenn sich Seite/Art nicht erkennen lassen.
function rekonstruiere(vault, { hash, lauf, id, betreff }, jetzt) {
  const wiki = ordner(vault).wiki;
  let namen;
  try { namen = git(vault, vault, ["diff-tree", "--no-commit-id", "--name-only", "-r", "--no-renames", "-z", hash]).split("\0").filter(Boolean); } catch { return null; }
  const ziel = namen.find((n) => n.startsWith(`${wiki}/`) && n.endsWith(".md") && !/\/_[^/]*$/.test(n));
  const beleg = namen.find((n) => BELEG_MUSTER.test(n));
  if (!ziel) return null;
  const zeige = (rev, pfad) => git(vault, vault, ["show", `${rev}:${pfad}`]);
  const ms = laufMs(lauf);
  const a = { lauf, zeit: new Date(Number.isFinite(ms) ? ms : jetzt).toISOString(), id, ziel, commit: hash };
  const betreffTitel = (betreff.match(/^auto\([^)]+\): (.*) → .* \[[^\]]+\]$/) || [])[1] || id;
  if (beleg) {
    let fm = {};
    try { fm = leseFm(zeige(hash, beleg)).fm; } catch { /* Beleg nicht lesbar: Art und Titel aus dem Betreff */ }
    Object.assign(a, { stufe: fm.art === "stand" ? "stand" : "uebernehmen", auto: true, einschwingen: true, beleg,
      titel: kurz(fm.titel) || betreffTitel, zitat: text(fm.zitat), herkunft: text(fm.herkunft), fundstelle: text(fm.fundstelle) });
  } else {
    let feld = null;
    try {
      const vorher = fmSchluessel(zeige(`${hash}^`, ziel)), nachher = fmSchluessel(zeige(hash, ziel));
      feld = [...nachher.keys()].find((k) => k !== "rev" && vorher.get(k) !== nachher.get(k)) ?? [...vorher.keys()].find((k) => k !== "rev" && !nachher.has(k)) ?? null;
    } catch { /* unten: null */ }
    if (!feld) return null;
    Object.assign(a, { stufe: "feld", auto: false, feld, titel: betreffTitel });
  }
  a.rekonstruiert = true;
  return a;
}

// → { rekonstruiert: [Aktion], nachgetragen: [{ lauf, id, commit }], unklar: [{ id, hash }], fehler: null | "Code" }. Wirft nie.
// lauf / ids: nur diese Lauf-Nummer bzw. IDs (gezielt, ohne Altersgrenze); sonst alle Commits im Fenster `seitTage`.
export function heileProtokoll(vault, { lauf = null, ids = null, jetzt = Date.now(), seitTage = HEILUNG_TAGE } = {}) {
  const erg = { rekonstruiert: [], nachgetragen: [], unklar: [], fehler: null };
  try {
    let aktionen;
    try { aktionen = leseAktionenStreng(vault); } catch (e) { return { ...erg, fehler: String(e?.code || e?.message || e).slice(0, 40) }; }
    let log;
    try { log = git(vault, vault, ["log", "--format=%H%x09%s", "--grep=^auto(", `--author=${AUTOR.email}`, "main"]); } catch { return erg; }    // kein Git / kein main: nichts zu heilen
    const mitHash = new Set(aktionen.map((a) => a.commit).filter(Boolean));
    const zurueckgenommen = new Set(aktionen.filter((a) => a.stufe === "zurueck" && a.von).map((a) => a.von));
    const nachSchluessel = new Map();
    for (const a of aktionen) if (UEBERNAHME_STUFEN.has(a.stufe) && !nachSchluessel.has(`${a.lauf}\0${a.id}`)) nachSchluessel.set(`${a.lauf}\0${a.id}`, { ...a });
    const neue = [], nachtraege = [];
    for (const z of log.split("\n").filter(Boolean).reverse()) {                                                         // älteste zuerst
      const [hash, betreff = ""] = z.split("\t");
      const m = betreff.match(BETREFF_MUSTER);
      if (!m) continue;
      const [, l, id] = m;
      if ((lauf && l !== lauf) || (ids && !ids.includes(id)) || mitHash.has(hash) || zurueckgenommen.has(hash)) continue;
      const da = nachSchluessel.get(`${l}\0${id}`);
      if (da) {                                                                                                         // Aktion da, nur der Hash fehlt
        if (!da.commit) { da.commit = hash; nachtraege.push({ lauf: l, zeit: da.zeit, id, stufe: da.stufe, nachtrag: true, commit: hash }); }
        continue;
      }
      if (!lauf && !ids) { const ms = laufMs(l); if (Number.isFinite(ms) && jetzt - ms > seitTage * TAG) continue; }   // außerhalb des Fensters
      const a = rekonstruiere(vault, { hash, lauf: l, id, betreff }, jetzt);
      if (a) { neue.push(a); nachSchluessel.set(`${l}\0${id}`, a); } else erg.unklar.push({ id, hash });
    }
    if (neue.length || nachtraege.length) {
      try { haengeAktionenAn(vault, [...neue, ...nachtraege]); }
      catch (e) { return { ...erg, fehler: String(e?.code || e?.message || e).slice(0, 40) }; }
    }
    return { ...erg, rekonstruiert: neue, nachgetragen: nachtraege.map((n) => ({ lauf: n.lauf, id: n.id, commit: n.commit })) };
  } catch (e) { return { ...erg, fehler: String(e?.code || e?.message || e).slice(0, 40) }; }
}

// Hat die Heilung etwas nachgetragen, steht das als Aktion „heilung“ im Protokoll des laufenden Kontexts und (ctx.heilung) im Bericht des Tageslaufs.
export function notiereHeilung(ctx, h) {
  const n = h.rekonstruiert.length, m = h.nachgetragen.length;
  if (!n && !m) return;
  const ids = [...h.rekonstruiert, ...h.nachgetragen].map((a) => a.id);
  notiere(ctx, { id: "lauf", stufe: "heilung", grund: "protokoll-rekonstruiert", rekonstruiert: n, nachgetragen: m, ids: ids.slice(0, 30) });
  ctx.heilung = { rekonstruiert: (ctx.heilung?.rekonstruiert || 0) + n, nachgetragen: (ctx.heilung?.nachgetragen || 0) + m, ids: [...(ctx.heilung?.ids || []), ...ids].slice(0, 30) };
}
