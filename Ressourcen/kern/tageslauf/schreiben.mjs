// .tools/tageslauf/schreiben.mjs — Schritt 6, Textteil (Node, kein LLM; Spec §4.2/§5.2): Fakt-Zeile unter „## Fakten",
// Stand/Verlauf, Ersetzen (durchgestrichen + neue Zeile darunter), Frontmatter-Feld, rev+1, quellen/quellen_sha,
// _log.md-Eintrag oben, Beleg-Datei <cluster>/belege/<JJJJ-MM>/<id>.md. Frontmatter wird ZEILENWEISE geändert (fremde
// Formatierung bleibt). Fehler tragen `grund`: seite-unlesbar | seite-fehlt | kritisch | kein-cluster | auftrag-unbekannt | unveraendert.
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { createHash } from "node:crypto";
import { ladeConfig, ordner } from "../pfade.mjs";
import { schreibeFm } from "./bestand.mjs";
import { heute } from "./protokoll.mjs";
import { ID_MUSTER } from "../vorschlaege.mjs";
import { kernsatz } from "../beleg-ernte.mjs";
import { leseSeitenFelder } from "../seitenfelder.mjs";

const fehler = (grund) => Object.assign(new Error(grund), { grund });
const einzeilig = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const p2 = (n) => String(n).padStart(2, "0");
const UEBERSCHRIFT = /^#{1,2} /m;
// Härtung (Zusatz zum Plan): Feldname nur in dieser Form, Strukturfelder fasst kein Auftrag an; Pfade nie über Symlinks aus der Arbeitskopie hinaus.
const FELD_MUSTER = /^[a-z][a-z0-9_]{0,29}$/;
const FELD_GESPERRT = new Set(["rev", "quellen", "quellen_sha", "kritisch", "typ"]);
function imVault(wurzel, pfad) {
  let p = pfad;
  while (!existsSync(p) && dirname(p) !== p) p = dirname(p);   // nächster vorhandener Vorfahr (existsSync folgt Symlinks → toter Link zählt als „fehlt")
  try { const w = realpathSync(wurzel), r = realpathSync(p); return r === w || r.startsWith(w + sep); } catch { return false; }
}
export const datumDE = (iso) => { const [j, m, t] = String(iso).slice(0, 10).split("-"); return `${t}.${m}.${j}`; };
export const logZeit = (d) => `${heute(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
export const sha16 = (text) => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex").slice(0, 16);

export function faktZeile({ aussage, datum, beleg }) {
  return `- ${einzeilig(aussage).slice(0, 400)} · Stand ${datum} · [[${beleg}]]`;
}

function fmGrenzen(text) {
  const t = String(text).replace(/\r\n/g, "\n");
  const ende = t.startsWith("---\n") ? t.indexOf("\n---", 3) : -1;
  if (ende < 0) throw fehler("seite-unlesbar");
  return { fm: t.slice(4, ende), rest: t.slice(ende) };
}
export function leseFeld(text, feld) {
  const m = fmGrenzen(text).fm.match(new RegExp(`^${feld}:[ \\t]*(.*)$`, "m"));
  return m ? m[1].trim() : null;
}
export function setzeFeld(text, feld, wert) {
  const { fm, rest } = fmGrenzen(text);
  const zeilen = fm ? fm.split("\n") : [];
  const i = zeilen.findIndex((z) => z.startsWith(`${feld}:`));
  if (wert === null || wert === undefined) { if (i >= 0) zeilen.splice(i, 1); }
  else { const z = `${feld}: ${JSON.stringify(wert)}`; if (i >= 0) zeilen[i] = z; else zeilen.push(z); }
  return `---\n${zeilen.join("\n")}${rest}`;
}
export function erhoeheRev(text) {
  const r = Number(leseFeld(text, "rev"));
  if (!Number.isInteger(r) || r < 1) throw fehler("seite-unlesbar");
  return { text: setzeFeld(text, "rev", r + 1), rev: r + 1 };
}
export function ergaenzeQuelle(text, pfad, sha) {
  const zeilen = fmGrenzen(text).fm.split("\n");
  const liste = (k) => {
    const i = zeilen.findIndex((z) => z.startsWith(`${k}:`));
    if (i < 0) return [];
    const w = zeilen[i].slice(k.length + 1).trim();
    if (!w && /^\s+-/.test(zeilen[i + 1] || "")) throw fehler("seite-unlesbar");   // YAML-Blockliste: nicht anfassen
    if (!w) return [];
    try { const a = JSON.parse(w); if (Array.isArray(a)) return a; } catch {}
    throw fehler("seite-unlesbar");
  };
  const q = liste("quellen"), s = liste("quellen_sha");
  if (q.length !== s.length) throw fehler("seite-unlesbar");
  return setzeFeld(setzeFeld(text, "quellen", [...q, pfad]), "quellen_sha", [...s, sha]);
}

export function abschnitt(t, kopf) {
  const m = t.match(new RegExp(`^## ${kopf}[ \\t]*$`, "m"));
  if (!m) return null;
  const start = m.index + m[0].length;
  const n = t.slice(start).search(UEBERSCHRIFT);
  return { kopfStart: m.index, start, ende: n < 0 ? t.length : start + n, letzter: n < 0 };
}
export function fuegeFaktEin(text, zeile) {
  const t = String(text).replace(/\r\n/g, "\n").replace(/\n*$/, "\n");
  const a = abschnitt(t, "Fakten");
  if (!a) return `${t}\n## Fakten\n\n${zeile}\n`;
  const inhalt = t.slice(a.start, a.ende).replace(/\n+$/, "");
  return `${t.slice(0, a.start)}${inhalt}\n${zeile}\n${a.letzter ? "" : "\n"}${t.slice(a.ende)}`;
}
export function ersetzeZeile(text, alteZeile, neueZeile, datum) {
  const zeilen = String(text).replace(/\r\n/g, "\n").split("\n");
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const i = zeilen.findIndex((z) => norm(z) === norm(alteZeile));
  if (i < 0 || !/^\s*[-*] /.test(zeilen[i])) return null;
  const einzug = zeilen[i].match(/^\s*/)[0];
  const aussage = zeilen[i].replace(/^\s*[-*] /, "").split(" · Stand ")[0].trim();
  zeilen.splice(i, 1, `${einzug}- ~~${aussage}~~ · ersetzt am ${datum} durch die Zeile darunter`, `${einzug}${neueZeile}`);
  return zeilen.join("\n");
}
export function verlaufZeile(alt) {
  const d = (alt.match(/^Stand (\d{2}\.\d{2}\.\d{4})/m) || [, ""])[1];
  const erste = alt.split("\n").map((z) => z.trim()).find((z) => z && !/^Stand \d/.test(z)) || "";
  return erste ? `- ${d ? `${d}: ` : ""}${erste.replace(/^[-*] /, "").slice(0, 200)}` : null;
}
function fuegeVerlaufEin(text, zeile) {
  const a = abschnitt(text, "Verlauf");
  if (!a) return `${text.replace(/\n*$/, "\n")}\n## Verlauf\n\n${zeile}\n`;
  const alte = text.slice(a.start, a.ende).split("\n").filter((z) => /^\s*[-*] /.test(z));
  return `${text.slice(0, a.start)}\n\n${[zeile, ...alte].slice(0, 10).join("\n")}\n${a.letzter ? "" : "\n"}${text.slice(a.ende)}`;
}
export function ersetzeStand(text, { standText, datum, beleg }) {
  const t = String(text).replace(/\r\n/g, "\n").replace(/\n*$/, "\n");
  const block = `## Stand\n\nStand ${datum} · [[${beleg}]]\n\n${String(standText).trim()}\n`;
  const a = abschnitt(t, "Stand");
  if (!a) return `${t}\n${block}`;
  const alt = verlaufZeile(t.slice(a.start, a.ende).trim());
  const neu = `${t.slice(0, a.kopfStart)}${block}${a.letzter ? "" : "\n"}${t.slice(a.ende)}`;
  return alt ? fuegeVerlaufEin(neu, alt) : neu;
}

export function logEintrag({ zeit, lauf, titel, seiteWiki, rev, was, beleg }) {
  return [`## ${zeit} — auto(${lauf}): ${einzeilig(titel).slice(0, 80)}`, `- Seite geändert: ${seiteWiki} (rev ${rev}: ${was})`,
    ...(beleg ? [`- Beleg: ${beleg}`] : []), `- Tageslauf, automatisch — rückgängig: brain zurueck ${lauf}`].join("\n");
}
export function fuegeLogEin(logText, eintrag) {
  const t = String(logText).replace(/\r\n/g, "\n");
  const i = t.search(/^## \d{4}-\d{2}-\d{2}/m);
  if (i < 0) return `${t.replace(/\n*$/, "\n")}\n${eintrag}\n`;
  return `${t.slice(0, i)}${eintrag}\n\n${t.slice(i)}`;
}

export function clusterFuer(vault, seite) {
  const wiki = ordner(vault).wiki;
  const bereich = String(seite).slice(wiki.length + 1).split("/")[0];
  const ids = (ladeConfig(vault).clusters || []).map((c) => c?.id).filter((x) => typeof x === "string");
  return ids.find((id) => id.replace(/^\d+_/, "") === bereich) || null;
}
export const belegPfad = (cluster, monat, id) => `${cluster}/belege/${monat}/${id}.md`;
export const BELEG_MUSTER = /^[^/\\.][^/\\]*\/belege\/\d{4}-\d{2}\/[a-z0-9-]{1,80}\.md$/;   // <cluster>/belege/<JJJJ-MM>/<id>.md — die Form von belegPfad
// Was ein Vorschlag aussagt, wenn er geschrieben wird: beim Stand nur der Kernsatz, sonst der ganze Text.
export const aussageText = (v) => (v?.art === "stand" ? kernsatz(v.text) : String(v?.text ?? ""));
export function belegText(v, { lauf, seite }) {
  const fm = { typ: "beleg", art: v.art, vorschlag: v.id, titel: v.titel, zitat: v.zitat, herkunft: v.herkunft, fundstelle: v.fundstelle,
    quelle_sitzung: v.quelleSitzung, quelle_ordner: v.quelleOrdner, erstellt: v.erstellt, lauf, seite };
  return schreibeFm(fm, `\n# ${einzeilig(v.titel)}\n\n${aussageText(v).trim()}\n\n> ${String(v.zitat || "").replace(/\n/g, "\n> ")}\n`);
}

// Ein Schreibauftrag in der Arbeitskopie `wurzel` (Pfade vault-relativ). → { dateien (zum expliziten git add), titel, was, beleg }
export function wendeAuftragAn(wurzel, auftrag, { lauf, jetzt = Date.now() }) {
  const wiki = ordner(wurzel).wiki;
  const seite = String(auftrag.seite || "");
  const datei = join(wurzel, seite);
  if (!seite.startsWith(`${wiki}/`) || seite.split("/").includes("..") || !existsSync(datei) || !imVault(wurzel, datei)) throw fehler("seite-fehlt");
  let text = readFileSync(datei, "utf8");
  // kritisch fail-safe wie in B1 (seitenfelder.mjs): jeder Wert außer false sperrt die Seite. Geprüft wird die Seite wie B1 sie liest UND genau
  // der Frontmatter-Teil, den dieser Schreiber ändert (fmGrenzen) — liest einer von beiden kritisch, wird nichts geschrieben.
  if (leseSeitenFelder(text).kritisch || leseSeitenFelder(`---\n${fmGrenzen(text).fm}\n---\n`).kritisch) throw fehler("kritisch");
  const tag = heute(new Date(jetzt));
  const dateien = [seite];
  let was, beleg = null;
  if (auftrag.art === "feld") {
    if (typeof auftrag.feld !== "string" || !FELD_MUSTER.test(auftrag.feld) || FELD_GESPERRT.has(auftrag.feld)) throw fehler("auftrag-unbekannt");
    const neu = setzeFeld(text, auftrag.feld, auftrag.wert ?? null);
    if (neu === text) throw fehler("unveraendert");   // nichts zu tun → kein Leer-Commit
    text = neu;
    was = auftrag.wert == null ? `${auftrag.feld} entfernt` : `${auftrag.feld} gesetzt`;
  } else {
    const v = auftrag.v;
    const cluster = clusterFuer(wurzel, seite);
    if (!cluster) throw fehler("kein-cluster");
    if (!["fakt", "stand", "ersetzen"].includes(auftrag.art) || typeof v?.id !== "string" || !ID_MUSTER.test(v.id)) throw fehler("auftrag-unbekannt");
    beleg = belegPfad(cluster, tag.slice(0, 7), v.id);
    const inhalt = belegText(v, { lauf, seite });
    if (!imVault(wurzel, dirname(join(wurzel, beleg)))) throw fehler("seite-fehlt");
    mkdirSync(dirname(join(wurzel, beleg)), { recursive: true });
    writeFileSync(join(wurzel, beleg), inhalt, { flag: "wx" });
    dateien.push(beleg);
    const link = beleg.replace(/\.md$/, "");
    const stand = datumDE(/^\d{4}-\d{2}-\d{2}/.test(String(v.erstellt)) ? v.erstellt : tag);   // kaputtes „erstellt" → heutiges Datum statt „undefined.undefined"
    const zeile = faktZeile({ aussage: v.text || v.titel, datum: stand, beleg: link });
    if (auftrag.art === "fakt") { text = fuegeFaktEin(text, zeile); was = "Fakt-Zeile ergänzt"; }
    else if (auftrag.art === "stand") { text = ersetzeStand(text, { standText: kernsatz(v.text), datum: stand, beleg: link }); was = "Stand ersetzt"; }
    else {
      const neu = ersetzeZeile(text, auftrag.zeile || "", zeile, datumDE(tag));
      if (neu !== null) { text = neu; was = "Zeile ersetzt"; }
      else {
        text = setzeFeld(fuegeFaktEin(text, zeile), "zweifel", `${tag}: Fließtext widerspricht dem neuen Fakt (Rückfrage ${auftrag.ref || "-"})`);
        was = "Fakt ergänzt, Fließtext prüfen";
      }
    }
    text = ergaenzeQuelle(text, beleg, sha16(inhalt));
  }
  const r = erhoeheRev(text);
  writeFileSync(datei, r.text);
  const logRel = `${wiki}/_log.md`;
  const logDatei = join(wurzel, logRel);
  if (!imVault(wurzel, logDatei)) throw fehler("seite-fehlt");
  const altLog = existsSync(logDatei) ? readFileSync(logDatei, "utf8") : "# Ingest-Protokoll (append-only, neuester Eintrag oben)\n";
  const titel = einzeilig(auftrag.titel || auftrag.v?.titel || auftrag.feld || "Änderung");
  writeFileSync(logDatei, fuegeLogEin(altLog, logEintrag({ zeit: logZeit(new Date(jetzt)), lauf, titel, seiteWiki: seite.slice(wiki.length + 1), rev: r.rev, was, beleg })));
  dateien.push(logRel);
  return { dateien, titel, was, beleg };
}
