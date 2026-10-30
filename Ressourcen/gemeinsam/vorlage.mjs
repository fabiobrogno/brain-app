// gemeinsam/vorlage.mjs — die „Kortex-Vorlage“: das Gerüst, das Studio für einen neuen Vault anlegt (Spec v2 §2).
// Nur Dateien — Git (init, Identität, erster Commit) macht vaults.mjs. Alles deutsch, keine privaten Inhalte.
// Die Prüfregeln von Studio stehen in pruefung.mjs; Schema und Beispielseiten sind darauf abgestimmt
// (beide Beispielseiten ergeben dort die Stufe „gruen“). Keine Abhängigkeiten außer basis/pruefung.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { HttpFehler } from "./basis.mjs";
import { berlinHeute } from "./pruefung.mjs";

// Inhalt der .gitignore — gilt für die Vorlage, den leeren Vault und „Versionsverlauf einschalten“.
export const GITIGNORE = [
  "# macOS legt in jedem Ordner Ansichtsinfos ab",
  ".DS_Store",
  "",
  "# Protokolle und Zwischenstände von Werkzeugen",
  ".logs/",
  "",
  "# Programmpakete, falls ein Werkzeug welche anlegt",
  "node_modules/",
  "",
  "# Temporäre Dateien des Vaults",
  ".brain-tmp-*",
  "",
].join("\n");

// brain.config.json: die Marke eines Vaults für den Kern (`pruefeVault` im Kern verlangt sie) und seine Grundeinstellungen. Der Vault
// enthält sonst nur Daten — kein `.tools`, keinen Kern-Code (der liegt im App-Paket, Kern-Umzug P4). Die Ordnernamen entsprechen den
// Standardwerten des Kerns und dem Gerüst unten (00_inbox, 09_wiki, 90_archiv).
export const BRAIN_CONFIG = JSON.stringify({
  ordner: { inbox: "00_inbox", wiki: "09_wiki", archiv: "90_archiv" },
  sprache: "de",
}, null, 2) + "\n";

const md = (...zeilen) => zeilen.join("\n") + "\n";
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function datum(heute) {
  const wert = heute === undefined || heute === null ? berlinHeute() : heute;
  const m = ISO.exec(String(wert));
  if (!m) throw new HttpFehler(500, "Das Datum für die Vorlage ist ungültig.");
  return { iso: wert, tag: `${m[3]}.${m[2]}.${m[1]}`, monat: `${m[1]}-${m[2]}` };
}

// Der Name landet als Überschrift in Markdown: eckige Klammern würden einen Link daraus machen.
const titelVon = (name) => String(name === undefined || name === null ? "" : name).replace(/[[\]\r\n]/g, "").trim() || "Vault";

// ---- Texte -----------------------------------------------------------------------------------------------
// Wörtliche Zitate der Belege stehen hier und im Schema — ein Test prüft, dass sie dort wirklich vorkommen.

const ZITAT_INBOX = "Neues Wissen kommt als Notiz nach `00_inbox/` — nie direkt ins Wiki.";
const ZITAT_KI = "Diese Regeln gelten für jede KI: Claude Code, Codex, Gemini, Cursor.";
const ZITAT_FAKT = "Jede Fakt-Zeile nennt die Aussage, den Stand und einen Beleg-Link.";
const ZITAT_KONFLIKT = "Widersprüche werden markiert, nie still aufgelöst.";

function agents(name) {
  return md(
    `# ${name} — Arbeitsregeln für KI`,
    "",
    "Dieser Ordner ist ein Kortex-Vault: Notizen und Wissen als einfache Textdateien (Markdown).",
    ZITAT_KI,
    "",
    "## Wissensfragen",
    "",
    "1. Suche zuerst im Wiki `09_wiki/`: erst nach Dateinamen, dann im Volltext. Lies die passende Seite.",
    "2. Achte auf die Prüf-Signale einer Seite:",
    "   - Fakt-Zeilen mit Beleg-Link gelten als belegt.",
    "   - `> [!KONFLIKT]`, PRÜFBEDÜRFTIG oder ein abgelaufenes `pruefen_bis` heißen: Vorsicht. Sag der Person, dass die Aussage unsicher ist.",
    "3. Lies nie den ganzen Vault ein. Öffne nur, was zur Frage passt.",
    "",
    "## Schreiben",
    "",
    `- ${ZITAT_INBOX}`,
    "- Das Wiki (`09_wiki/`) änderst du nur, wenn die Person es ausdrücklich verlangt — und dann nach `09_wiki/_schema.md`.",
    "- Generierte Dateien (`INDEX.md`, `_index.md`, `graph.json`) und Rohquellen bearbeitest du nie.",
    "- Keine Geheimnisse: keine Passwörter, Schlüssel oder Zugangsdaten in Notizen.",
    "",
    "## Werkzeuge (MCP-Server „brain“)",
    "",
    "Ist der MCP-Server „brain“ verbunden, nutze diese Werkzeuge:",
    "",
    "- Zu Beginn einer Sitzung `brain_kontext` mit dem Projektnamen aufrufen.",
    "- `brain_kontext` — Seiten zum aktuellen Projekt",
    "- `brain_suchen` — Wissen finden",
    "- `brain_lesen` — eine Seite mit ihren Prüf-Signalen lesen",
    "- `brain_merken` — eine Notiz in die Inbox legen",
    "- `brain_verlauf` — Git-Verlauf einer Datei",
    "- `brain_gesundheit` — Zustand des Vaults prüfen",
    "- `brain_vaults` — alle Vaults der App und den aktiven zeigen",
    "",
    "## Git",
    "",
    "Dieser Vault ist ein Git-Repository. Committe Änderungen mit einer kurzen, verständlichen Nachricht. Benutze nie `--force`.",
  );
}

const SCHEMA = md(
  "# Wiki-Schema — Arbeitsanweisung (vor jeder Wiki-Arbeit lesen)",
  "",
  "Das Wiki (`09_wiki/`) sammelt belegtes Wissen. Wiki-Seiten entstehen und ändern sich nur nach diesem Schema.",
  "",
  "## Seitentypen (Präfix im Dateinamen)",
  "",
  "- `thema_<slug>.md` — fasst ein Thema über mehrere Quellen zusammen",
  "- `entitaet_<slug>.md` — Steckbrief zu einem Werkzeug, einer Person oder einem Projekt",
  "- `synthese_<slug>.md` — Verdichtung quer über mehrere Themen",
  "- `quelle_<slug>.md` — Zusammenfassung genau einer Quelle (Video, Artikel, Dokument)",
  "",
  "## Ordner",
  "",
  "- Jede Seite liegt in `09_wiki/<bereich>/…`, zum Beispiel in `wissen`, `projekte` oder `persoenlich`. Eigene Bereiche sind erlaubt. Wähle den Ort, an dem du die Seite zuerst suchen würdest.",
  "- Dateinamen behalten ihr Präfix und sind im ganzen Vault eindeutig. Auf Seiten verweist du mit `[[dateiname-ohne-md]]`.",
  "- Dateien, die mit `_` beginnen (`_schema.md`, `_log.md`, `_index.md`), verwalten das Wiki und sind keine Wissensseiten.",
  "",
  "## Kopfzeilen jeder Seite (Frontmatter)",
  "",
  "```",
  "---",
  "name: <slug>",
  "description: <ein Satz: wovon handelt die Seite>",
  "typ: thema|entitaet|synthese|quelle",
  "stand: JJJJ-MM-TT",
  "quellen: [\"<Pfad zur Quelle>\"]",
  "---",
  "```",
  "",
  "Seiten vom Typ `quelle` tragen zusätzlich `quellen_sha: [\"<erste 16 Zeichen des SHA-256 der Quelle>\"]` — damit fällt auf, wenn sich die Quelle später ändert.",
  "",
  "## Fakt-Zeilen und Belege",
  "",
  "Tatsachen stehen unter der Überschrift `## Fakten`, je eine Listenzeile. Format: `- <Aussage> · Stand TT.MM.JJJJ · [[<bereich>/belege/<JJJJ-MM>/<id>]]`",
  "",
  ZITAT_FAKT,
  "Der Link zeigt auf eine Beleg-Datei unter `09_wiki/<bereich>/belege/<JJJJ-MM>/<id>.md`. Ein Beleg ist eine Datei mit wörtlichem Zitat, Herkunft und Fundstelle (Kopfzeilen `zitat`, `herkunft`, `fundstelle`). So lässt sich jede Aussage bis zur Quelle zurückverfolgen.",
  "",
  "Als Fakt-Zeile zählt eine Listenzeile mit `· Stand TT.MM.JJJJ` oder mit Beleg-Link; unter `## Fakten` zählt dann jede Listenzeile. Handgeschriebene Stichpunkte außerhalb davon sind keine Fakt-Zeilen. Eine überholte Aussage bleibt sichtbar, durchgestrichen: `- ~~<Aussage>~~ · ersetzt am TT.MM.JJJJ durch die Zeile darunter`.",
  "",
  "## Gültigkeit (optional, in den Kopfzeilen)",
  "",
  "- `stand: JJJJ-MM-TT` — Wissensstand der Seite.",
  "- `pruefen_bis: JJJJ-MM-TT` — feste Frist; danach gilt die Seite als abgelaufen.",
  "- `verfall: <Tage>` — für Momentaufnahmen; gezählt ab `stand`.",
  "- `ersetzt_durch: \"[[<nachfolger>]]\"` — die Seite ist überholt.",
  "- `kritisch: true` — nur von Hand ändern; eine KI darf höchstens etwas vorschlagen.",
  "- `zweifel: \"JJJJ-MM-TT: <Grund>\"` — hier ist etwas fraglich; nach dem Prüfen entfernen.",
  "",
  "## Die drei Riegel (gelten immer)",
  "",
  "1. Arbeite immer gegen die Originalquelle, nie gegen eine ältere Zusammenfassung.",
  `2. ${ZITAT_KONFLIKT} Ein offener Konflikt beginnt mit \`> [!KONFLIKT] offen — Du entscheidest\`, danach je eine Zeile mit Aussage A und B samt Quellenlink. Aufgelöst wird er erst, wenn du entschieden hast.`,
  "3. Jeder Lauf, der das Wiki ändert, wird in `_log.md` protokolliert (neuester Eintrag oben).",
  "",
  "## Regeln",
  "",
  "- Rohquellen sind unantastbar: nur lesen, nie ändern. Seiten verlinken sie mit `[[relativer/pfad]]`.",
  "- Halte Seiten kurz (Ziel: unter 150 Zeilen). Details gehören in die Rohquelle.",
  "- Setze Querverweise zwischen verwandten Seiten.",
  "- Keine Geheimnisse — niemals: keine Passwörter, Schlüssel oder Zugangsdaten.",
  "- Generierte Dateien (`INDEX.md`, `_index.md`, `graph.json`) fasst du nie an.",
  "",
  "## So zeigt Studio den Zustand einer Seite",
  "",
  "Studio prüft Seiten unter `09_wiki/` nur nach festen Regeln, ohne KI. Es sagt nie „stimmt“, sondern „belegt“ oder „ungeprüft“ — die Wahrheit entscheidest du.",
  "",
  "- Rot: ein offener Konflikt-Kasten, eine Zeile, die mit PRÜFBEDÜRFTIG beginnt, oder `zweifel` in den Kopfzeilen.",
  "- Gelb: `pruefen_bis` ist überschritten, `stand` plus `verfall` sind abgelaufen, eine Fakt-Zeile hat keinen Beleg-Link, oder einer `quelle_`-Seite fehlt `quellen_sha`.",
  "- Grün (belegt): mindestens eine belegte Fakt-Zeile und nichts Offenes.",
  "- Ohne Befund: keine Fakt-Zeilen im Beleg-Format und nichts Offenes.",
  "- Grau: alles außerhalb von `09_wiki/` und Dateien, die mit `_` beginnen.",
);

function protokoll(name, d) {
  return md(
    `# Protokoll des Wikis — ${name}`,
    "",
    "Jeder Lauf, der das Wiki ändert, bekommt hier einen Eintrag. Der neueste steht oben; alte Einträge werden nie umgeschrieben.",
    "",
    "Format je Eintrag:",
    "",
    "    ## JJJJ-MM-TT: <Anlass oder Quelle>",
    "    - Seiten neu oder geändert: <Liste>",
    "    - Konflikte: <keine / neu markiert / entschieden>",
    "",
    `## ${d.iso}: Kortex-Vault angelegt`,
    "- Seiten neu: `wissen/thema_so-funktioniert-dein-vault.md`, `wissen/thema_wissen-belegen.md` (Beispiele — behalte sie als Vorlage oder lösche sie).",
    "- Konflikte: keine.",
  );
}

// Beispielseiten und ihre Belege. Der Beleg-Link einer Fakt-Zeile und die Beleg-Datei entstehen aus derselben Zeile hier —
// so können Link und Datei nie auseinanderlaufen.
const SEITEN = [
  {
    datei: "thema_so-funktioniert-dein-vault",
    beschreibung: "Wie dein Vault aufgebaut ist — Inbox für Neues, Wiki für Belegtes, eine Regeldatei für jede KI.",
    titel: "So funktioniert dein Vault",
    einleitung: [
      "Dein Vault ist ein Ordner mit Textdateien. Neue Gedanken landen zuerst in der Inbox, belegtes Wissen steht im Wiki, und jede KI arbeitet nach denselben Regeln. Wie du Aussagen absicherst, zeigt [[thema_wissen-belegen]].",
    ],
    quellen: ["AGENTS.md"],
    fakten: [
      { text: "Neues Wissen kommt zuerst als Notiz nach `00_inbox/`, nie direkt ins Wiki", id: "inbox-zuerst", zitat: ZITAT_INBOX, herkunft: "AGENTS.md", fundstelle: "Abschnitt „Schreiben“", beleg: "Neues Wissen kommt zuerst in die Inbox" },
      { text: "Die Regeln in `AGENTS.md` gelten für jede KI, nicht nur für eine", id: "regeln-fuer-ki", zitat: ZITAT_KI, herkunft: "AGENTS.md", fundstelle: "Einleitung", beleg: "Eine Regeldatei für jede KI" },
    ],
    weiter: [
      "## Probier es aus",
      "",
      "- Lege in `00_inbox/` eine Notiz an, zum Beispiel mit „Schnell merken“.",
      "- Frag deine KI nach etwas aus dem Wiki und achte darauf, ob sie die Prüf-Signale nennt.",
      "- Lösche diese Beispielseiten, sobald du eigenes Wissen eingearbeitet hast.",
    ],
  },
  {
    datei: "thema_wissen-belegen",
    beschreibung: "Warum hinter jeder Tatsache im Wiki ein Beleg steht und wie Widersprüche behandelt werden.",
    titel: "Wissen belegen",
    einleitung: [
      "Ein Vault ist nur so gut wie seine Belege. Darum steht hinter jeder Tatsache im Wiki ein Link auf eine Beleg-Datei. Wie der Vault im Ganzen aufgebaut ist, steht in [[thema_so-funktioniert-dein-vault]].",
    ],
    quellen: ["09_wiki/_schema.md"],
    fakten: [
      { text: "Jede Fakt-Zeile nennt Aussage, Stand und einen Beleg-Link", id: "fakt-zeile", zitat: ZITAT_FAKT, herkunft: "09_wiki/_schema.md", fundstelle: "Abschnitt „Fakt-Zeilen und Belege“", beleg: "Jede Fakt-Zeile hat einen Beleg" },
      { text: "Widersprüche werden markiert und nie still aufgelöst", id: "konflikt-markieren", zitat: ZITAT_KONFLIKT, herkunft: "09_wiki/_schema.md", fundstelle: "Abschnitt „Die drei Riegel“", beleg: "Widersprüche bleiben sichtbar" },
    ],
    weiter: [
      "## So liest du die Ampel",
      "",
      "- Grün heißt „belegt“: Es gibt Fakt-Zeilen mit Beleg und nichts Offenes. Es heißt nicht „stimmt garantiert“.",
      "- Gelb heißt: abgelaufen oder ohne Beleg. Rot heißt: offener Konflikt, deine Entscheidung fehlt.",
      "- Die genauen Regeln stehen in `09_wiki/_schema.md`.",
    ],
  },
];

const WIKI_BEREICH = "wissen";

function seitenText(s, d) {
  const faktZeilen = s.fakten.map((f) => `- ${f.text} · Stand ${d.tag} · [[${WIKI_BEREICH}/belege/${d.monat}/${f.id}]]`);
  return md(
    "---",
    `name: ${s.datei.replace(/^thema_/, "")}`,
    `description: ${s.beschreibung}`,
    "typ: thema",
    `stand: ${d.iso}`,
    `quellen: [${s.quellen.map((q) => JSON.stringify(q)).join(", ")}]`,
    "---",
    `# ${s.titel}`,
    "",
    ...s.einleitung,
    "",
    "## Fakten",
    "",
    ...faktZeilen,
    "",
    ...s.weiter,
  );
}

function belegText(f, seite) {
  return md(
    "---",
    `zitat: ${JSON.stringify(f.zitat)}`,
    `herkunft: ${JSON.stringify(f.herkunft)}`,
    `fundstelle: ${JSON.stringify(f.fundstelle)}`,
    "---",
    `# Beleg: ${f.beleg}`,
    "",
    `Dieser Beleg gehört zur Seite [[${seite.datei}]]. So sieht ein Beleg aus: ein wörtliches Zitat, die Herkunft und die Fundstelle. Damit kann jeder später nachprüfen, woher die Aussage stammt.`,
  );
}

// → [{ pfad, inhalt }] — Pfade relativ zum Vault, mit „/“. Reihenfolge: Verwaltung, Wiki, Regeln.
export function vorlageDateien({ name, heute } = {}) {
  const d = datum(heute);
  const titel = titelVon(name);
  const dateien = [
    { pfad: "00_inbox/.gitkeep", inhalt: "" },
    { pfad: "09_wiki/_schema.md", inhalt: SCHEMA },
    { pfad: "09_wiki/_log.md", inhalt: protokoll(titel, d) },
  ];
  for (const s of SEITEN) {
    dateien.push({ pfad: `09_wiki/${WIKI_BEREICH}/${s.datei}.md`, inhalt: seitenText(s, d) });
    for (const f of s.fakten) dateien.push({ pfad: `09_wiki/${WIKI_BEREICH}/belege/${d.monat}/${f.id}.md`, inhalt: belegText(f, s) });
  }
  dateien.push(
    { pfad: "AGENTS.md", inhalt: agents(titel) },
    { pfad: "CLAUDE.md", inhalt: "@AGENTS.md\n" },
    { pfad: ".gitignore", inhalt: GITIGNORE },
    { pfad: "brain.config.json", inhalt: BRAIN_CONFIG },
  );
  return dateien;
}

// Schreibt das Gerüst in `ordner` (legt ihn bei Bedarf an) und gibt die geschriebenen Pfade zurück (für `git add --`).
// Überschreibt nie etwas: gibt es eine der Dateien schon, bricht das Schreiben mit dem Systemfehler EEXIST ab.
export async function legeVorlageAn(ordner, { name, heute } = {}) {
  const dateien = vorlageDateien({ name, heute });
  mkdirSync(ordner, { recursive: true });
  for (const { pfad, inhalt } of dateien) {
    const ziel = join(ordner, ...pfad.split("/"));
    mkdirSync(dirname(ziel), { recursive: true });
    writeFileSync(ziel, inhalt, { flag: "wx" });
  }
  return dateien.map((x) => x.pfad);
}
