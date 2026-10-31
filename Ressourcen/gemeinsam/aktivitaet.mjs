// gemeinsam/aktivitaet.mjs — das Aktivitätsprotokoll (Paket P8a): EIN Protokoll je Vault, außerhalb des Vaults im Support-Ordner der App:
//   <support>/aktivitaet/<Kennung>.jsonl      eine Zeile je Ereignis (JSON), angehängt; Kennung = Hash des echten Vault-Pfads (wie backup/<Kennung>.json)
//   <support>/aktivitaet/<Kennung>.jsonl.alt  die vorige Fassung nach dem Rotieren (Datei über `maxBytes` → umbenannt; Lesen nimmt beide)
//   <support>/aktivitaet/<Kennung>.zustand.json  „gelesen“ und „zurückgenommen“ (nur die Werkstatt schreibt; die Schreiber unten nie)
// Es schreiben: der MCP-Server (Ablagen, Änderungen, Abweisungen), die Hooks und der Kern (Abweisungen, Pflege, Sicherung — kern/aktivitaet.mjs,
// derselbe Abschnitt LOG-BEGINN … LOG-ENDE, Parität: Tests/Node/aktivitaet-paritaet.test.mjs) und die Werkstatt (Anmeldung, Rückgängig).
// NIE im Protokoll: Inhalt von Notizen, Titel von Aufgaben, Zugangsdaten. Ehrlich dazu: Die Pfade der Ablagen sind Dateinamen und enthalten darum den Titel als Kurzform (Slug), und der Name des
// MCP-Clients stammt vom Programm selbst. Die Schreiber setzen `text` aus festen Bausteinen zusammen; hier wird alles noch einmal begrenzt (Länge, Zeichen, Pfadform) und bekannte
// Schlüsselformen werden entfernt. Das Protokoll liegt außerhalb des Vaults und kann von jedem Programm mit Zugriff auf den Support-Ordner beschrieben werden: ein Eintrag ist ein HINWEIS, nie
// eine Berechtigung (Rückgängig prüft alles am Vault selbst, werkstatt/aktivitaet.mjs). Schreiben wirft nie (ein Hook oder der
// MCP-Server darf wegen des Protokolls nie ausfallen); eine Zeile bleibt unter 4 KB, damit parallele Anhänge (O_APPEND) sich nicht mischen.
import { appendFileSync, readFileSync, writeFileSync, mkdirSync, statSync, renameSync, openSync, readSync, closeSync, realpathSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { supportOrdner } from "./basis.mjs";
import { ladeKatalog } from "./ki-katalog.mjs";

// LOG-BEGINN
export const AKTIVITAET_ORDNER = "aktivitaet";
// Ereignisarten. „abweisung“ hat einen Grund (grund): gesperrt (Konto im Vault gesperrt) · stufe (Stufe zu niedrig für das Werkzeug) · leseverbot (Leseverbot/Strenger Schutz).
export const ARTEN = ["ablage-aufgabe", "ablage-notiz", "aenderung", "abweisung", "pflege", "pflege-fehler", "sicherung-konflikt", "sicherung-fehler", "anmeldung-abgelaufen", "rueckgaengig"];
export const MAX_BYTES = 256 * 1024;      // je Datei; mit der Vorfassung höchstens etwa das Doppelte
export const MAX_TEXT = 240;
const MAX_PFADE = 10;
const MAX_PFAD = 300;
const STUFEN_NAMEN = ["gesperrt", "lesen", "posteingang", "erweitert"];

// Kennung eines Vaults: SHA-256 des echten Pfads (realpath.native), 16 Hex — derselbe Weg wie backup/<Kennung>.json (gemeinsam/sicherungsmerker.mjs).
export function kennungVault(wurzel) {
  let p = String(wurzel);
  try { p = realpathSync.native(p); } catch { /* wie angegeben */ }
  return createHash("sha256").update(p).digest("hex").slice(0, 16);
}
export const KENNUNG = /^[0-9a-f]{16}$/;
export const aktivitaetOrdner = (support) => join(support, AKTIVITAET_ORDNER);
export const ereignisDatei = (support, kennung) => join(aktivitaetOrdner(support), `${kennung}.jsonl`);

const STEUER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const STEUER_EINZEL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
// Bekannte Schlüsselformen (GitHub, Slack, Anthropic/OpenAI, Bearer, AWS, JWT) — Vorsichtsnetz; es gehört ohnehin nie etwas Derartiges hinein.
const SCHLUESSEL = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})\b|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g;
const einzeilig = (s, max) => String(s ?? "").normalize("NFC").replace(STEUER, " ").replace(SCHLUESSEL, "[entfernt]").replace(/\s+/g, " ").trim().slice(0, max);
function relPfad(p) {
  if (typeof p !== "string" || !p || p.length > MAX_PFAD) return null;
  const s = p.normalize("NFC");
  if (STEUER_EINZEL.test(s)) return null;
  if (s.startsWith("/") || s.includes("\\") || s.split("/").some((t) => t === ".." || t === "." || t === "")) return null;
  return s;
}

// Ein Ereignis in die gespeicherte Form bringen (oder null, wenn die Art unbekannt ist). Nur bekannte Felder, alle begrenzt.
export function bereinige(e, { kennung = null } = {}) {
  if (!e || typeof e !== "object" || !ARTEN.includes(e.art)) return null;
  const r = { v: 1, id: typeof e.id === "string" && /^a_[0-9a-z]{6,12}_[0-9a-f]{6}$/.test(e.id) ? e.id : `a_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`,
    zeit: typeof e.zeit === "string" && Number.isFinite(Date.parse(e.zeit)) ? new Date(Math.min(Date.parse(e.zeit), Date.now() + 60_000)).toISOString() : new Date().toISOString(), art: e.art }; // höchstens 60 s in der Zukunft (eine falsche Uhr oder ein gefälschter Eintrag soll nichts verschieben)
  if (kennung && KENNUNG.test(kennung)) r.vault = kennung;
  const vn = einzeilig(e.vaultName, 60); if (vn) r.vaultName = vn;
  r.konto = typeof e.konto === "string" && /^k_[0-9a-f]{8}$/.test(e.konto) ? e.konto : null;
  const pg = typeof e.programm === "string" ? e.programm.toLowerCase() : "";
  r.programm = /^[a-z0-9][a-z0-9._-]{0,39}$/.test(pg) ? pg : null;
  if (typeof e.quelle === "string" && /^ki:[a-z0-9][a-z0-9._@-]{0,39}$/.test(e.quelle)) r.quelle = e.quelle;
  const wer = einzeilig(e.wer, 60); if (wer) r.wer = wer;
  if (typeof e.grund === "string" && /^[a-z0-9-]{1,30}$/.test(e.grund)) r.grund = e.grund;
  if (typeof e.werkzeug === "string" && /^[a-z0-9_]{1,60}$/.test(e.werkzeug)) r.werkzeug = e.werkzeug;
  if (STUFEN_NAMEN.includes(e.mindest)) r.mindest = e.mindest;
  if (Number.isInteger(e.anzahl) && e.anzahl >= 1 && e.anzahl <= 9999) r.anzahl = e.anzahl;
  r.text = einzeilig(e.text, MAX_TEXT);
  const pfade = (Array.isArray(e.pfade) ? e.pfade : []).map(relPfad).filter(Boolean).slice(0, MAX_PFADE);
  if (pfade.length) r.pfade = pfade;
  const rg = e.rueckgaengig;
  // Rückgängig nur für genau die Datei, die der Eintrag als ersten Pfad nennt (die Oberfläche zeigt sie an): so weiß der Nutzer, was entfernt würde
  if (rg && typeof rg === "object" && rg.art === "ablage-entfernen" && relPfad(rg.pfad) && pfade[0] === relPfad(rg.pfad) && typeof rg.hash === "string" && /^[0-9a-f]{64}$/.test(rg.hash)) r.rueckgaengig = { art: "ablage-entfernen", pfad: relPfad(rg.pfad), hash: rg.hash };
  if (typeof e.dk === "string" && e.dk) r.dk = einzeilig(e.dk, 120);
  return r;
}

// Letzte Bytes einer Datei (für die Drossel: nur der Schwanz wird gelesen). Nie ein Fehler.
function schwanz(datei, bytes = 16384) {
  let fd;
  try {
    fd = openSync(datei, "r");
    const st = statSync(datei);
    const n = Math.min(bytes, st.size), b = Buffer.alloc(n);
    readSync(fd, b, 0, n, st.size - n);
    return b.toString("utf8");
  } catch { return ""; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* egal */ } }
}

function rotiere(datei, max) {
  const sperre = `${datei}.lock`;
  try { closeSync(openSync(sperre, "wx", 0o600)); }
  catch { try { if (Date.now() - statSync(sperre).mtimeMs > 10_000) unlinkSync(sperre); } catch { /* weg */ } return; } // ein anderer Prozess rotiert gerade
  try { if (statSync(datei).size > max) renameSync(datei, `${datei}.alt`); } catch { /* schon rotiert */ }
  finally { try { unlinkSync(sperre); } catch { /* weg */ } }
}

// Hängt ein Ereignis an das Protokoll des Vaults an. → das gespeicherte Ereignis | null (ungültig, gedrosselt, nicht schreibbar).
//   opt.drossel = { schluessel, sekunden }: dieselbe Meldung (gleicher Schlüssel) wird innerhalb dieser Zeit nicht noch einmal geschrieben (Abweisungen von Hooks und MCP).
//   opt.maxBytes: Rotationsgrenze (Standard MAX_BYTES; Tests).
export function schreibeEreignis(support, wurzel, e, opt = {}) {
  try {
    if (typeof support !== "string" || !support) return null;
    const kennung = kennungVault(wurzel);
    const datei = ereignisDatei(support, kennung);
    const dk = opt.drossel && typeof opt.drossel.schluessel === "string" ? opt.drossel.schluessel : null;
    const r = bereinige({ ...e, ...(dk ? { dk } : {}) }, { kennung });
    if (!r) return null;
    if (dk) {
      const grenze = Date.now() - Math.max(0, Number(opt.drossel.sekunden) || 0) * 1000;
      for (const z of schwanz(datei).split("\n").reverse()) {
        if (!z) continue;
        try { const o = JSON.parse(z); if (o && o.dk === r.dk && Date.parse(o.zeit) >= grenze) return null; } catch { /* halbe Zeile am Anfang des Schwanzes */ }
      }
    }
    mkdirSync(aktivitaetOrdner(support), { recursive: true, mode: 0o700 });
    appendFileSync(datei, JSON.stringify(r) + "\n", { mode: 0o600 });
    // Rotieren: zu groß → die Datei wird zur Vorfassung (rename ist atomar; wer gleichzeitig noch anhängt, landet in der Vorfassung, die weiter gelesen wird).
    // Nur ein Prozess rotiert (Sperrdatei „wx“, nach 10 s gilt sie als verwaist) und prüft die Größe unter der Sperre noch einmal: zwei Prozesse überschreiben so nie die Vorfassung
    // mit einer fast leeren Datei.
    const max = Number.isFinite(opt.maxBytes) && opt.maxBytes > 0 ? opt.maxBytes : MAX_BYTES;
    try { if (statSync(datei).size > max) rotiere(datei, max); } catch { /* schon rotiert */ }
    return r;
  } catch { return null; }
}

const lies = (datei) => { try { return readFileSync(datei, "utf8"); } catch { return ""; } };
// Alle Ereignisse eines Vaults, älteste zuerst (Vorfassung + aktuelle Datei). Zeilen, die nicht passen, werden übersprungen.
//   opt.seit (ISO, ausschließlich) · opt.arten (Liste) · opt.limit (die letzten N)
export function leseEreignisse(support, kennung, opt = {}) {
  if (typeof support !== "string" || !KENNUNG.test(String(kennung))) return [];
  const datei = ereignisDatei(support, kennung);
  const seit = opt.seit ? Date.parse(opt.seit) : NaN;
  const arten = Array.isArray(opt.arten) && opt.arten.length ? new Set(opt.arten) : null;
  const aus = [];
  for (const t of [lies(`${datei}.alt`), lies(datei)]) {
    for (const z of t.split("\n")) {
      if (!z) continue;
      let o; try { o = JSON.parse(z); } catch { continue; }
      if (!o || typeof o !== "object" || o.v !== 1 || typeof o.id !== "string" || !ARTEN.includes(o.art) || !Number.isFinite(Date.parse(o.zeit))) continue;
      if (Number.isFinite(seit) && !(Date.parse(o.zeit) > seit)) continue;
      if (arten && !arten.has(o.art)) continue;
      aus.push(o);
    }
  }
  aus.sort((a, b) => (a.zeit < b.zeit ? -1 : a.zeit > b.zeit ? 1 : 0));
  return opt.limit > 0 ? aus.slice(-opt.limit) : aus;
}
// LOG-ENDE

// ───────────────────────────── Nur Werkstatt / MCP (nicht im Kern) ─────────────────────────────

// Anzeigename eines KI-Programms (Katalog: claude → „Claude Code“) oder null.
const PROGRAMM_ALIAS = { "claude-code": "claude", "cursor-agent": "cursor" };
export function programmAnzeige(id) {
  const k = PROGRAMM_ALIAS[id] || id;
  if (typeof k !== "string" || !k) return null;
  try { const e = ladeKatalog().find((x) => x.id === k); return e ? e.name : null; } catch { return k === "claude" ? "Claude Code" : k === "codex" ? "Codex" : null; }
}
// „Claude Code · Privat“: Programm und Name des Kontos; ohne Konto der Name des MCP-Clients nur, wenn er im Katalog steht, sonst „Eine KI“. Nie ein Name aus dem Login.
export function werText({ programm = null, kontoName = null, klient = "" } = {}) {
  const roh = String(klient || "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const p = programmAnzeige(programm) || programmAnzeige(roh); // nur bekannte Programme beim Namen nennen: der Client-Name ist eine Selbstauskunft und gehört nicht als Freitext in die Anzeige
  const k = typeof kontoName === "string" && kontoName.trim() ? kontoName.trim() : null;
  return p ? (k ? `${p} · ${k}` : p) : (k || "Eine KI");
}

// Ereignis für den Vault `wurzel` im Support-Ordner der App (BRAIN_APP_SUPPORT lenkt ihn um: Tests, Vorschau).
export function melde(wurzel, e, opt = {}) { return schreibeEreignis(opt.support || supportOrdner(), wurzel, e, opt); }

const ZUSTAND_MAX_IDS = 400;
const zustandDatei = (support, kennung) => join(aktivitaetOrdner(support), `${kennung}.zustand.json`);
// → { gelesenBis: ISO | null, gelesen: [id], zurueck: { id: ISO }, wieder: { id: ISO } }  (wieder: von Kortex aus dem Papierkorb wiederhergestellt)
export function leseZustand(support, kennung) {
  try {
    const j = JSON.parse(readFileSync(zustandDatei(support, kennung), "utf8"));
    return { gelesenBis: typeof j.gelesenBis === "string" && Number.isFinite(Date.parse(j.gelesenBis)) ? j.gelesenBis : null,
      gelesen: Array.isArray(j.gelesen) ? j.gelesen.filter((x) => typeof x === "string").slice(-ZUSTAND_MAX_IDS) : [],
      zurueck: j.zurueck && typeof j.zurueck === "object" && !Array.isArray(j.zurueck) ? Object.fromEntries(Object.entries(j.zurueck).filter(([, v]) => typeof v === "string").slice(-ZUSTAND_MAX_IDS)) : {},
      wieder: j.wieder && typeof j.wieder === "object" && !Array.isArray(j.wieder) ? Object.fromEntries(Object.entries(j.wieder).filter(([, v]) => typeof v === "string" && Number.isFinite(Date.parse(v))).slice(-ZUSTAND_MAX_IDS)) : {} };
  } catch { return { gelesenBis: null, gelesen: [], zurueck: {}, wieder: {} }; }
}
function schreibeZustand(support, kennung, z) {
  mkdirSync(aktivitaetOrdner(support), { recursive: true, mode: 0o700 });
  const datei = zustandDatei(support, kennung), tmp = `${datei}.${process.pid}.tmp`;
  try { writeFileSync(tmp, JSON.stringify(z) + "\n", { mode: 0o600 }); renameSync(tmp, datei); } catch (e) { try { unlinkSync(tmp); } catch { /* weg */ } throw e; }
}
// Ändert den Zustand (fn bekommt eine Kopie). Ids, die nicht mehr im Protokoll stehen, fallen heraus (kein Wachstum).
export function aendereZustand(support, kennung, fn) {
  const z = leseZustand(support, kennung);
  fn(z);
  const da = new Set(leseEreignisse(support, kennung).map((e) => e.id));
  z.gelesen = z.gelesen.filter((id) => da.has(id)).slice(-ZUSTAND_MAX_IDS);
  z.zurueck = Object.fromEntries(Object.entries(z.zurueck).filter(([id]) => da.has(id)));
  z.wieder = Object.fromEntries(Object.entries(z.wieder).filter(([id]) => da.has(id)));
  schreibeZustand(support, kennung, z);
  return z;
}
export const istGelesen = (z, e) => z.gelesen.includes(e.id) || (z.gelesenBis !== null && Date.parse(e.zeit) <= Date.parse(z.gelesenBis));

// Wie viele Kennungen haben ein Protokoll? (für „alle Vaults“) — die Namen der Dateien ohne Endung.
export function protokollKennungen(support) {
  try { return readdirSync(aktivitaetOrdner(support)).map((n) => /^([0-9a-f]{16})\.jsonl$/.exec(n)).filter(Boolean).map((m) => m[1]); } catch { return []; }
}

// Schalter der Mitteilungen (Einstellungen → Mitteilungen) je Ereignisart: wer eine Art ausgeschaltet hat, bekommt dazu keine macOS-Mitteilung und keinen Toast.
// Gespiegelt in Sources/BrainCore/Mitteilungen.swift und studio/mitteilungen.js (Tests prüfen alle drei).
export const ART_SCHALTER = {
  "ablage-aufgabe": "mitteilungenAbgelegt", "ablage-notiz": "mitteilungenAbgelegt", aenderung: "mitteilungenAbgelegt",
  abweisung: "mitteilungenAbgewiesen",
  "sicherung-konflikt": "mitteilungenSicherung", "sicherung-fehler": "mitteilungenSicherung",
  "pflege-fehler": "mitteilungenRueckfragen", "anmeldung-abgelaufen": "mitteilungenRueckfragen",
  pflege: "mitteilungenPflege",
  rueckgaengig: null, // die Bestätigung eines Klicks: nie eine Mitteilung
};
