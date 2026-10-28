// .tools/tests/traum-hilfe.mjs — Test-Hilfen für den Traum (tageslauf/traum.mjs): Gedächtnis-Wurzel als Git-Repo, zwei Claude-Konten mit Verläufen,
// Test-Vault mit den Traum-Einstellungen, Regeln für den Fake-Sonnet. Nie echtes ~/.claude*, nie echtes claude. KEIN Test (Name beginnt nicht mit test-).
import { mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { join, dirname } from "node:path";
import { tempOrdner, nutzer, assistent, schreibeVerlauf } from "./verlauf-fixture.mjs";
import { git, JETZT } from "./tageslauf-hilfe.mjs";
import { neuerPflegeVault, pflegeCtx } from "./pflege-hilfe.mjs";

export const KEY = "-Users-test-projekt";
export const THEMEN = ["jarvis", "openclaw", "minecraft"];       // Wörter der Fixtures, die der Traum nie sehen darf (traumOhneThema der Test-Konfiguration)
export const fm = (name, typ, beschreibung = "Beschreibung", extra = "") => `---\nname: ${name}\ndescription: "${beschreibung}"\nmetadata:\n  node_type: memory\n  type: ${typ}\n${extra}---\n`;

export const MEMORY = `# Gedächtnis

## Aktive Sessions
- [Session Alpha](session_alpha.md) — offen: Deploy prüfen

## Erinnerungen
- [Antworten Deutsch](feedback_deutsch.md) — immer Deutsch antworten
- [Deutsch antworten](feedback_deutsch2.md) — bitte Deutsch
- [Jarvis privat](project_jarvis.md) — Bot auf dem Server
`;
export const DATEIEN = {
  "MEMORY.md": MEMORY,
  "feedback_deutsch.md": `${fm("feedback_deutsch", "feedback", "Antworten immer auf Deutsch")}\nAlle Texte auf Deutsch schreiben.\nAuch Zwischenmeldungen.\nAuch Statuszeilen.\n`,
  "feedback_deutsch2.md": `${fm("feedback_deutsch2", "feedback", "Deutsch antworten")}\nBitte Deutsch antworten.\nGilt immer.\n`,
  "session_alpha.md": `${fm("session-alpha", "session", "Alpha: Deploy offen")}\n**Offen**\n- [ ] Deploy prüfen\n`,
  "project_jarvis.md": `${fm("project_jarvis", "project", "Jarvis läuft auf dem Server")}\nJarvis ist ein privater Bot.\n`,
};
export const VERLAUF = [nutzer("Deploy prüfen ist durch, alles grün."), assistent("Verstanden, ich hake den Deploy ab."),
  nutzer("Bitte nie mehr Emojis in Commit-Nachrichten verwenden."), assistent("Mache ich: keine Emojis in Commit-Nachrichten.")];

// → { v (Vault), wurzel, konten: [a, b], dir (Projektordner in der Wurzel), ctx(), verlauf(…), schreibe(rel, text), committe(rel, text) }
// basis: Bezugszeit der Verlaufs-mtimes — JETZT für ctx()-Tests; CLI-Tests rechnen mit der echten Uhr → basis: Date.now()
// (sonst fallen die Verläufe einen Tag nach JETZT aus dem 24-h-Fenster und die Tests werden rot).
export function traumAufbau({ dateien = DATEIEN, verlaeufe = [{ id: "11111111-aaaa", konto: 0, vorMs: 2 * 3600e3, eintraege: VERLAUF }], automatik = {}, key = KEY, ohneWurzelGit = false, basis = JETZT } = {}) {
  const wurzel = tempOrdner("Gedächtnis Wurzel"), konten = [tempOrdner("Konto A"), tempOrdner("Konto B")];
  const dir = join(wurzel, key);
  mkdirSync(dir, { recursive: true });
  for (const [n, t] of Object.entries(dateien)) writeFileSync(join(dir, n), t);
  if (!ohneWurzelGit) {
    git(wurzel, "init", "-q", "-b", "main");
    git(wurzel, "config", "user.name", "Test"); git(wurzel, "config", "user.email", "test@example.com"); git(wurzel, "config", "commit.gpgsign", "false");
    git(wurzel, "add", "--", ...Object.keys(dateien).map((n) => `${key}/${n}`));
    git(wurzel, "commit", "-qm", "start");
  }
  // Konten und ausgeschlossene Themen setzt die Fixture AUSDRÜCKLICH (das Kit liefert keine privaten Namen/Ordner als Standard: gedaechtnisKonten nur ~/.claude, traumOhneThema leer).
  const v = neuerPflegeVault({ automatik: { tageslauf: "an", einschwingen: 0, traum: "an", gedaechtnisWurzel: wurzel, gedaechtnisKonten: konten, traumOhneThema: THEMEN, ...automatik } });
  const verlauf = ({ id, konto = 0, vorMs = 2 * 3600e3, eintraege, projekt = key }) => {
    const p = join(konten[konto], "projects", projekt, `${id}.jsonl`);
    schreibeVerlauf(p, eintraege);
    const t = new Date(basis - vorMs);
    utimesSync(p, t, t);
    return p;
  };
  for (const x of verlaeufe) verlauf(x);
  return {
    v, wurzel, konten, dir, key, verlauf,
    ctx: (opt = {}) => pflegeCtx(v, opt),
    schreibe: (rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); },
    committe: (rel, text) => { writeFileSync(join(dir, rel), text); git(wurzel, "add", "--", `${key}/${rel}`); git(wurzel, "commit", "-qm", `edit ${rel}`); },
  };
}

// Die „Antwort“ des Fake-Sonnet: schreibt Dateien in gedaechtnis/ und den Bericht. dateien: { "<name>": text | null (null = löschen) }.
export function traumRegel({ key = KEY, dateien = {}, bericht = [], antwort = "FERTIG — Änderungen", wenn } = {}) {
  const d = {};
  for (const [n, t] of Object.entries(dateien)) d[`gedaechtnis/${n}`] = t;
  d["traum-bericht.json"] = typeof bericht === "string" ? bericht : JSON.stringify(bericht);
  return { wenn: wenn || `PROJEKT: ${key}`, antwort, dateien: d };
}

// Ein vollständiger, gültiger Traum für DATEIEN/VERLAUF: Zusammenführen + Erledigt + Neu (alle mit Beleg).
export const GUTER_TRAUM = {
  dateien: {
    "MEMORY.md": `# Gedächtnis

## Aktive Sessions

## Erinnerungen
- [Antworten Deutsch](feedback_deutsch.md) — immer Deutsch antworten
- [Keine Emojis in Commits](feedback_emoji.md) — Commit-Nachrichten ohne Emojis
<!-- traum-geschuetzt-1 -->
`,   // die Jarvis-Zeile sah die KI nur als Platzhalter
    "feedback_deutsch.md": `${fm("feedback_deutsch", "feedback", "Antworten immer auf Deutsch")}\nAlle Texte auf Deutsch schreiben.\nAuch Zwischenmeldungen.\nAuch Statuszeilen.\nGilt immer.\n`,
    "feedback_deutsch2.md": `${fm("feedback_deutsch2", "feedback", "Deutsch antworten")}\nZusammengeführt in feedback_deutsch.md\n\nBitte Deutsch antworten.\nGilt immer.\n`,
    "session_alpha.md": `${fm("session-alpha", "session", "Alpha: Deploy offen", "status: erledigt\n")}\n**Offen**\n- [x] Deploy prüfen\n`,
    "feedback_emoji.md": `${fm("feedback_emoji", "feedback", "Keine Emojis in Commit-Nachrichten")}\nKeine Emojis in Commit-Nachrichten verwenden.\n`,
  },
  bericht: [
    { datei: "feedback_deutsch.md", art: "zusammengefuehrt", grund: "Gleiche Regel wie feedback_deutsch2.md", beleg: "" },
    { datei: "feedback_deutsch2.md", art: "zusammengefuehrt", grund: "Doppelt, zusammengeführt in feedback_deutsch.md", beleg: "" },
    { datei: "session_alpha.md", art: "erledigt", grund: "Deploy ist erledigt", beleg: "Deploy prüfen ist durch, alles grün." },
    { datei: "feedback_emoji.md", art: "neu", grund: "Neue Vorliebe des Nutzers", beleg: "Bitte nie mehr Emojis in Commit-Nachrichten verwenden." },
  ],
};
