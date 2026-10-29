// arbeitsstand.mjs — K12 „Arbeitsstand über die Kompaktierung retten" (Spec §12.2). PreCompact sammelt aus dem
// Verlauf DIESER Sitzung wörtliche Auszüge — erste Nutzer-Nachricht (Ziel), Nutzer-Nachrichten seit der letzten
// Kompaktierung, Commits aus der Git-Ausgabe, geänderte Dateien aus Edit/Write, offene Aufgaben (TodoWrite bzw.
// TaskCreate/TaskUpdate) — und legt sie unter .logs/sitzungen/<session_id>.{json,md} ab. SessionStart (source
// "compact") spielt die .md DERSELBEN session_id ein. Nie eine KI-Zusammenfassung, nie Daten einer anderen Sitzung.
// Secret-Riegel: Nachrichten mit Zugangsdaten werden VOR dem Speichern ersetzt; der fertige Text läuft zusätzlich durch
// ohneSecrets. Inkrementell: die .json merkt sich, bis zu welchem Byte gelesen wurde (= Grenze der letzten Kompaktierung).
import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  leseKopf, leseAb, nutzerNachricht, werkzeugAufrufe, werkzeugErgebnisse, kompaktierung, zeitVon, kuerze, ganzeZeilen, datumZeit, STUECK_MAX,
} from "./verlauf.mjs";
import { hatSecretsImKontext, ohneSecrets } from "./secrets-muster.mjs";

export const MAX_EINSPIELEN = 8000;
// Die übrigen Abschnitte sind knapp gehalten, damit die neuesten drei Nachrichten (je ≤ MAX_GANZ) immer ganz passen;
// Nachrichten bekommen in render() das Restbudget (MAX_EINSPIELEN minus tatsächlich belegte andere Abschnitte).
export const BUDGET = Object.freeze({ ziel: 500, aufgaben: 800, commits: 500, dateien: 600 });
export const NEUESTE_GANZ = 3, MAX_GANZ = 1500, MAX_AELTER = 200;
const MAX_NACHRICHTEN = 60, MAX_COMMITS = 15, MAX_DATEIEN = 40;
const AENDERNDE = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
// Git-Ausgabe eines Commits: „[zweig abc1234] Nachricht" bzw. „[main (root-commit) abc1234] …"
export const COMMIT_ZEILE = /^\[([^\]\s]+)(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.+)$/gm;
export const GEHEIM = "(Nachricht enthält vermutlich Zugangsdaten — ausgelassen)";
export const saubereSid = (roh) => String(roh || "").replace(/[^\w-]/g, "").slice(0, 64);
const ordnerVon = (vault) => join(vault, ".logs", "sitzungen");
const sicher = (t) => (hatSecretsImKontext(t) ? GEHEIM : t);
const zitat = (t) => String(t).split("\n").map((z) => `> ${z}`).join("\n");
const heim = homedir().split("\\").join("/");
const heimKurz = (p) => { const f = String(p).split("\\").join("/"); return heim && f.startsWith(heim + "/") ? `~${f.slice(heim.length)}` : f; };

export function sammle(transkript, { vorher = null, maxBytes = STUECK_MAX, fristMs = 3000, jetzt = Date.now() } = {}) {
  const t0 = Date.now();
  const z = {
    version: 1,
    bis: 0,
    ziel: typeof vorher?.ziel === "string" ? vorher.ziel : null,
    nachrichten: [],
    commits: Array.isArray(vorher?.commits) ? [...vorher.commits] : [],
    dateien: Array.isArray(vorher?.dateien) ? [...vorher.dateien] : [],
    aufgaben: vorher?.aufgaben && Array.isArray(vorher.aufgaben.liste) ? vorher.aufgaben : null,
    tasks: vorher?.tasks && typeof vorher.tasks === "object" ? { ...vorher.tasks } : {},
    luecke: false,
    stand: new Date(jetzt).toISOString(),
  };
  if (z.ziel == null) {
    for (const o of leseKopf(transkript).eintraege) {
      const m = nutzerNachricht(o);
      if (m?.text) { z.ziel = kuerze(sicher(m.text), BUDGET.ziel); break; }
    }
  }
  const { eintraege, bis, abgeschnitten } = leseAb(transkript, Number(vorher?.bis) || 0, maxBytes);
  z.bis = bis;
  z.luecke = abgeschnitten;
  const aufrufe = new Map();
  for (const o of eintraege) {
    if (Date.now() - t0 > fristMs) { z.luecke = true; break; }   // Rest dieses Stücks bleibt unausgewertet (gemeldet)
    for (const a of werkzeugAufrufe(o)) {
      aufrufe.set(a.id, a);
      if (AENDERNDE.has(a.name)) {
        const p = a.input.file_path ?? a.input.notebook_path;
        if (typeof p === "string" && p && !hatSecretsImKontext(p)) { z.dateien = z.dateien.filter((d) => d !== p); z.dateien.push(p); }
      }
      if (a.name === "TodoWrite" && Array.isArray(a.input.todos)) {
        z.aufgaben = {
          quelle: "TodoWrite",
          liste: a.input.todos.filter((t) => t && t.status !== "completed")
            .map((t) => ({ text: sicher(String(t.content ?? "").trim()), status: String(t.status ?? "") })).filter((t) => t.text),
        };
      }
      if (a.name === "TaskUpdate" && a.input.taskId != null) {
        const id = String(a.input.taskId);
        if (z.tasks[id]) {
          const s = String(a.input.status ?? z.tasks[id].status);
          if (s === "completed" || s === "deleted") delete z.tasks[id];
          else z.tasks[id] = { ...z.tasks[id], status: s };
        }
      }
    }
    for (const e of werkzeugErgebnisse(o)) {
      const a = aufrufe.get(e.id);
      if (!a || e.fehler) continue;
      if (a.name === "Bash") {
        for (const m of e.text.matchAll(COMMIT_ZEILE)) {
          const text = ohneSecrets(m[3]).trim();
          if (text && !z.commits.some((c) => c.sha === m[2])) z.commits.push({ sha: m[2], zweig: m[1], text });
        }
      }
      if (a.name === "TaskCreate") {
        const id = /#(\d+)/.exec(e.text)?.[1];
        const titel = sicher(String(a.input.subject ?? "").trim());
        if (id && titel) z.tasks[id] = { text: titel, status: "pending" };
      }
    }
    if (kompaktierung(o)) z.nachrichten = [];   // nur Nachrichten seit der letzten Kompaktierung
    const m = nutzerNachricht(o);
    if (m?.text) z.nachrichten.push({ zeit: zeitVon(o), text: sicher(m.text) });
  }
  z.nachrichten = z.nachrichten.slice(-MAX_NACHRICHTEN);
  z.commits = z.commits.slice(-MAX_COMMITS);
  z.dateien = z.dateien.slice(-MAX_DATEIEN);
  return z;
}

// Neueste NEUESTE_GANZ Nachrichten ganz (≤ MAX_GANZ), ältere auf MAX_AELTER gekürzt; passt eine nicht mehr ins Budget,
// fällt nur sie weg (mit Zählhinweis) — Ausgabe älteste zuerst.
function nachrichtenBlock(liste, max) {
  const bloecke = [];
  let laenge = 0, ausgelassen = 0;
  for (let i = liste.length - 1; i >= 0; i--) {
    const n = liste[i], neu = liste.length - 1 - i < NEUESTE_GANZ;
    const b = `- ${datumZeit(n.zeit)}\n${zitat(kuerze(n.text, neu ? MAX_GANZ : MAX_AELTER))}`;
    if (laenge + b.length + 1 > max) { ausgelassen++; continue; }
    bloecke.unshift(b);
    laenge += b.length + 1;
  }
  if (ausgelassen) bloecke.unshift(`(${ausgelassen} ältere Nachricht(en) ausgelassen — Platzgrenze)`);
  return bloecke.join("\n");
}
function aufgabenZeilen(z) {
  const zeilen = [];
  for (const a of z.aufgaben?.liste || []) zeilen.push(`- [${a.status || "offen"}] ${a.text}`);
  for (const [id, t] of Object.entries(z.tasks || {})) zeilen.push(`- [${t.status || "offen"}] #${id} ${t.text}`);
  return zeilen.map((l) => kuerze(sicher(l), 300));
}
function mitRest(zeilen, max) {
  const { text, weggelassen } = ganzeZeilen(zeilen, max - 30);
  return weggelassen ? `${text}\n- … (${weggelassen} weitere)` : text;
}

export function kuerzeAnZeile(text, max) {
  const t = String(text ?? "");
  if (t.length <= max) return t;
  if (max < 40) return "";
  let schnitt = t.lastIndexOf("\n", max - 30);
  if (schnitt <= 0) schnitt = max - 30;
  return `${t.slice(0, schnitt)}\n(… gekürzt)`;
}

export function render(z, { budget = MAX_EINSPIELEN, quelle = "" } = {}) {
  const teile = [`Kortex-Arbeitsstand vor der Kompaktierung (Stand ${datumZeit(Date.parse(z.stand))}) — wörtliche Auszüge aus dem `
    + `Verlauf DIESER Sitzung, keine Zusammenfassung${quelle ? `; Datei ${quelle}` : ""}. Ältere Nachrichten können überholt `
    + "sein — im Zweifel nachfragen."];
  if (z.ziel) teile.push(`## Ziel der Sitzung (erste Nutzer-Nachricht)\n${zitat(z.ziel)}`);
  // Übrige Abschnitte zuerst; Nachrichten bekommen den Rest des Gesamtbudgets.
  const rest = [];
  const a = aufgabenZeilen(z);
  if (a.length) rest.push(`## Offene Aufgaben (Stand laut Aufgabenliste im Verlauf)\n${mitRest(a, BUDGET.aufgaben)}`);
  if (z.commits?.length) {
    rest.push(`## Commits dieser Sitzung (aus der Git-Ausgabe, neueste zuerst)\n${mitRest(z.commits.slice().reverse().map((c) => `- ${c.sha} ${c.text}`), BUDGET.commits)}`);
  }
  if (z.dateien?.length) {
    rest.push(`## Geänderte Dateien (Edit/Write, zuletzt geänderte zuerst)\n${mitRest(z.dateien.slice().reverse().map((p) => `- ${heimKurz(p)}`), BUDGET.dateien)}`);
  }
  if (z.luecke) rest.push("(Hinweis: Ein Teil des Verlaufs wurde aus Zeit- oder Größengründen nicht ausgewertet.)");
  const kopf = "## Nutzer-Nachrichten seit der letzten Kompaktierung (wörtlich, älteste zuerst)\n";
  // + Platz für die Zeile „N ältere Nachricht(en) ausgelassen" (≤ 64 Zeichen)
  const belegt = [...teile, ...rest].join("\n\n").length + 2 + kopf.length + 2 + 64;
  const n = nachrichtenBlock(z.nachrichten || [], Math.max(0, budget - belegt));
  if (n) teile.push(`${kopf}${n}`);
  teile.push(...rest);
  return kuerzeAnZeile(ohneSecrets(teile.join("\n\n")), budget);
}

function schreibeAtomar(datei, inhalt) {
  const tmp = `${datei}.${process.pid}.tmp`;
  writeFileSync(tmp, inhalt);
  renameSync(tmp, datei);
}
export function schreibe(vault, sid, z) {
  const s = saubereSid(sid);
  if (!s) return null;
  mkdirSync(ordnerVon(vault), { recursive: true });
  const md = join(ordnerVon(vault), `${s}.md`);
  schreibeAtomar(join(ordnerVon(vault), `${s}.json`), JSON.stringify(z) + "\n");
  schreibeAtomar(md, render(z, { quelle: `.logs/sitzungen/${s}.md` }) + "\n");
  return md;
}
export function leseZustand(vault, sid) {
  const s = saubereSid(sid);
  if (!s) return null;
  try {
    const o = JSON.parse(readFileSync(join(ordnerVon(vault), `${s}.json`), "utf8"));
    return o && o.version === 1 ? o : null;
  } catch { return null; }
}
export function lies(vault, sid) {
  const s = saubereSid(sid);
  if (!s) return null;
  try { return { text: readFileSync(join(ordnerVon(vault), `${s}.md`), "utf8").trimEnd(), zustand: leseZustand(vault, s) }; }
  catch { return null; }
}
export function raeumeAuf(vault, jetzt = Date.now(), maxTage = 14) {
  let namen = [];
  try { namen = readdirSync(ordnerVon(vault)); } catch { return; }
  for (const n of namen) {
    const p = join(ordnerVon(vault), n);
    try { if (jetzt - statSync(p).mtimeMs > maxTage * 86400000) unlinkSync(p); } catch {}
  }
}
