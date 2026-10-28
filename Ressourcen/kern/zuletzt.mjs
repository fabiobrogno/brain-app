// .tools/zuletzt.mjs — K11 „Was war zuletzt" (Spec §12.2): beim Sitzungsstart (startup/resume/clear) höchstens ~600
// Zeichen — die letzten drei Sitzungen in diesem Ordner (Datum + Titel aus dem Verlauf, sonst erste Nachricht gekürzt),
// Commits seit Beginn der jüngsten dieser Sitzungen (git log, höchstens 5) und der Abschnitt „Offen" der jüngsten
// session_*.md. Nur wörtliche Auszüge mit Quelle, nichts zusammengefasst. „Anbieten, nicht beanspruchen": nichts wird
// verändert oder als übernommen markiert. „Dieser Ordner" = Claude Codes Projektordner neben transcript_path (gleiches
// cwd). Titel laufen durch den Secret- und den Kundendaten-Riegel. Wirft nie.
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { leseKopf, leseAb, nutzerNachricht, titelAus, zeitVon, kuerze, ganzeZeilen, datumZeit } from "./verlauf.mjs";
import { hatSecretsImKontext, ohneSecrets } from "./secrets-muster.mjs";
import { hatPii } from "./pii-muster.mjs";
import { gitWurzel } from "./projekt.mjs";

export const ZULETZT_MAX = 600;
const KOPF = 64 * 1024, ENDE = 64 * 1024;
const OFFEN_KOPF = /^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(?:🔴\s*)?Offen\b/u;
const ABSCHNITT_KOPF = /^\s*(?:#{1,6}\s+\S|\*\*[^*]+\*\*\s*$)/u;
const unsauber = (t) => hatSecretsImKontext(t) || hatPii(t);

// Eine frühere Sitzung: Titel (eigener > KI-Titel > erste Nachricht), Beginn, letzte Änderung. Ohne Nutzertext/Titel → null.
export function sitzungsInfo(pfad) {
  let st;
  try { st = statSync(pfad); } catch { return null; }
  const kopf = leseKopf(pfad, KOPF).eintraege;
  const ende = st.size > KOPF ? leseAb(pfad, Math.max(0, st.size - ENDE), ENDE).eintraege : [];
  let eigen = null, ki = null, startMs = null, erste = null;
  for (const o of [...kopf, ...ende]) {
    const t = titelAus(o);
    if (t?.art === "eigen") eigen = t.titel; else if (t?.art === "ki") ki = t.titel;
    if (startMs == null) startMs = zeitVon(o);
  }
  for (const o of kopf) { const m = nutzerNachricht(o); if (m?.text) { erste = m.text; break; } }
  if (!erste && !eigen && !ki) return null;
  let titel = eigen || ki || erste.replace(/\s+/g, " ");
  if (unsauber(titel)) titel = "(Titel ausgeblendet)";
  return { datei: pfad, sid: basename(pfad, ".jsonl"), startMs: startMs ?? st.mtimeMs, endeMs: st.mtimeMs, titel: kuerze(titel, 70) };
}

export function letzteSitzungen(transkriptPfad, { eigeneSid = "", anzahl = 3, maxPruefen = 15 } = {}) {
  const dir = dirname(transkriptPfad);
  let kandidaten = [];
  try {
    kandidaten = readdirSync(dir).filter((n) => n.endsWith(".jsonl") && n !== `${eigeneSid}.jsonl` && join(dir, n) !== transkriptPfad)
      .map((n) => { const p = join(dir, n); try { return { p, m: statSync(p).mtimeMs }; } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
  kandidaten.sort((a, b) => b.m - a.m);
  const out = [];
  for (const { p } of kandidaten.slice(0, maxPruefen)) {
    const i = sitzungsInfo(p);
    if (i) out.push(i);
    if (out.length >= anzahl) break;
  }
  return out;
}

// Abschnitt „Offen" (Überschrift oder fette Zeile, auch „🔴 Offen") der jüngsten session_*.md — bis zum nächsten Abschnitt.
export function offenAusSessionDatei(memoryOrdner) {
  let namen = [];
  try { namen = readdirSync(memoryOrdner).filter((n) => /^session_.*\.md$/i.test(n)); } catch { return null; }
  const mit = namen.map((n) => { try { return { n, m: statSync(join(memoryOrdner, n)).mtimeMs }; } catch { return null; } })
    .filter(Boolean).sort((a, b) => b.m - a.m);
  if (!mit.length) return null;
  let text = "";
  try { text = readFileSync(join(memoryOrdner, mit[0].n), "utf8").replace(/\r\n/g, "\n"); } catch { return null; }
  const zeilen = text.split("\n");
  const start = zeilen.findIndex((z) => OFFEN_KOPF.test(z));
  const out = [];
  if (start >= 0) {
    for (const z of zeilen.slice(start + 1)) {
      if (ABSCHNITT_KOPF.test(z)) break;
      if (z.trim()) out.push(z.trimEnd());
    }
  }
  return { datei: mit[0].n, zeilen: out.filter((z) => !hatSecretsImKontext(z)), mtimeMs: mit[0].m };
}

export function commitsSeit(wurzel, seitMs, { git = "git", anzahl = 5 } = {}) {
  if (!wurzel || !Number.isFinite(seitMs)) return [];
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  const r = spawnSync(git, ["-C", wurzel, "log", `--since=@${Math.floor(seitMs / 1000)}`, "-n", String(anzahl), "--format=%h %s"],
    { encoding: "utf8", timeout: 1500, windowsHide: true, env });
  if (r.status !== 0) return [];
  return String(r.stdout || "").split("\n").map((z) => ohneSecrets(z).trim()).filter(Boolean);
}

export function wasWarZuletzt({ transkriptPfad = "", sid = "", cwd = "", git = "git", max = ZULETZT_MAX } = {}) {
  if (!transkriptPfad) return "";
  const sitzungen = letzteSitzungen(transkriptPfad, { eigeneSid: sid });
  const offen = offenAusSessionDatei(join(dirname(transkriptPfad), "memory"));
  if (!sitzungen.length && !offen?.zeilen.length) return "";
  const kopf = "Zuletzt in diesem Ordner (wörtlich aus Verläufen, Git und Handoff — nur Angebot, nichts davon ist übernommen):";
  const teile = [kopf];
  let rest = max - kopf.length;
  const block = (titel, zeilen) => {
    if (!zeilen.length || rest < titel.length + 20) return;
    const { text } = ganzeZeilen(zeilen, rest - titel.length - 2);
    if (!text) return;
    const b = titel ? `${titel}\n${text}` : text;
    teile.push(b);
    rest -= b.length + 1;
  };
  block("", sitzungen.map((s) => `- ${datumZeit(s.endeMs)} „${s.titel}“`));
  const wurzel = cwd ? gitWurzel(cwd) : null;
  if (wurzel && sitzungen.length) {
    const seit = sitzungen[0].startMs;
    block(`Commits seit ${datumZeit(seit)} (git log):`, commitsSeit(wurzel, seit, { git }).map((c) => `- ${kuerze(c, 90)}`));
  }
  if (offen?.zeilen.length) block(`Offen laut ${offen.datei} (Stand ${datumZeit(offen.mtimeMs).slice(0, 6)}):`, offen.zeilen.map((z) => kuerze(z, 160)));
  return teile.length > 1 ? teile.join("\n") : "";
}
