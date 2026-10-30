// Lint: In sichtbaren Texten heißt die App „Kortex“ und der Datenordner „Vault“ — nie „Brain“.
// Geprüft werden die Textliterale (Anführungszeichen) in Swift, Studio, Werkstatt, gemeinsam, Kern und MCP-Server sowie die
// Vorlagen/Skills/Hilfetexte (Markdown, HTML) — keine Code-Kommentare. Interne Bezeichner dürfen „brain“ heißen (siehe ERLAUBT);
// weitere Ausnahmen stehen mit Grund in AUSNAHMEN. Aufruf: node --test Tests/Node/sichtbare-begriffe.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

// Bezeichner, die „brain“ enthalten dürfen (Dateinamen, Umgebungsvariablen, Schnittstellen, Befehle). Werden vor der Prüfung entfernt.
const KOMMANDOS = "status|search|suche|doctor|lint|index|stand|rueckfragen|zurueck|pflege|tageslauf|zeig|backup|import|ernte|dienst|refresh|analyse|wirkung|jetzt|lock|unlock|sha|mcp|hint|hook|ansicht|vorschlaege|fragen|karten|gedaechtnis|lektionen|beleg|w7|git-sicher|kit|verlauf|fakten|feedback|erinnern|migriere|aktualisiere|version|hilfe|help|install|installiere|deinstalliere|konflikte";
const ERLAUBT = [
  /BRAIN_[A-Z0-9_]*/g, /X-Brain-Token/g,                                // Umgebungsvariablen
  /\bbrain[-.][\w.\-]*\.(?:mjs|json|js|sh|md|log|yml|txt|plist)\b/g, // brain.mjs, brain-mcp.mjs, brain-vorschau.txt …
  /\bbrain\.config(?:\.json)?\b/g,
  /\bbrain-(?:index|lint|stand|mcp|hint|studio|ordner-hinweis-gezeigt|tmp|sicherung|ich|first|treffer|hinweis)\b/g, // Dateien, Skill, Speicherschlüssel
  /\bbrain_[a-z_]+\b/g,                                  // MCP-Werkzeugnamen
  /~\/brain\b/g, /\/Users\/[\w.]+\/[Bb]rain\b/g,         // Beispielpfade
  /\bbrain:\/\/\S*/g, /\bbrain:(?=["'`\s,)])/g,          // URL-Schema
  /\.brain\b/g, /\bde\.brain\.[\w.]+/g, /io\.github\.fbrogno\.brain[\w.]*/g,
  /__brain\b/g, /messageHandlers\.brain/g,
  /\bBrain(?:Core|App|Status|Befehl|Fenster)\b/g,        // Swift-Typen, Fenster-Autosave-Name
  new RegExp(`\\bbrain (?:${KOMMANDOS})\\b`, "g"),       // Kommandozeilen-Aufrufe `brain status` …
  /(?:mcp (?:add|get|remove)[^"'`\n]*?)\bbrain\b/g,      // claude mcp add … brain
  /["'`„“]brain["'`„“]/g,                                // Name des MCP-Servers („brain“)
  /\bbrain-(?:app|microservices|ai)\b/g,                 // Repo-Namen
];

// Bewusste Ausnahmen: { datei: Teilpfad, muster: RegExp auf den Text, grund }
const AUSNAHMEN = [
  { datei: "Sources/BrainCore/VaultAuswahl.swift", muster: /Documents\/Brain/, grund: "Ordnername, in dem frühere Installationen suchen" },
  { datei: "Ressourcen/kern/pfade.mjs", muster: /"Brain"/, grund: "alter Support-Ordner namens Brain (Pfad)" },
  { datei: "Ressourcen/kern/tageslauf/arbeitskopie.mjs", muster: /Brain-Tageslauf/, grund: "Git-Autor des Tageslaufs: Name und Mail erkennen eigene Commits in bestehenden Vaults (regeln.mjs, heilung.mjs) — Umbenennen würde alte Commits fremd machen" },
  { datei: "Ressourcen/kern/tageslauf/pflege-ki.mjs", muster: /Application Support\/Brain/, grund: "Pfad des alten Support-Ordners" },
  { datei: "Ressourcen/kern/umstellung/befund.mjs", muster: /"Brain"/, grund: "Befund sucht den alten Support-Ordner namens Brain (Pfad)" },
  { datei: "Ressourcen/kern/kit/AGENTS.md", muster: /(?:mein(?:e|en)?|altes|das|im) Brain|my brain/, grund: "Alte Auslösephrasen bleiben als zusätzliche Auslöser neben den neuen" },
  { datei: "Ressourcen/kern/skills/", muster: /(?:mein(?:e|en)?|altes|das|im) Brain|Brain fragt/, grund: "Alte Auslösephrasen bleiben als zusätzliche Auslöser" },
  { datei: "Sources/BrainCore/SupportMigration.swift", muster: /./, grund: "nennt den früheren Support-Ordner „Brain“ (Ordnername, kein Produktname)" },
  { datei: "Sources/BrainCore/AppPfade.swift", muster: /./, grund: "Ordnername des früheren Support-Ordners" },
  { datei: "Sources/BrainApp/AppZustand.swift", muster: /Ordner „Brain“/, grund: "Hinweis zum früheren Support-Ordner namens Brain" },
  { datei: "Sources/BrainCore/VorschauPlatzhalter.swift", muster: /./, grund: "Shell-Platzhalter, der die Ausgabe von `claude mcp` nachbildet (Servername „brain“)" },
];

function dateien(ordner, endungen, aus = []) {
  const r = [];
  const geh = (d) => {
    for (const n of readdirSync(d)) {
      if (["node_modules", "vendor", "build", ".build", "fixture", ".git"].includes(n)) continue;
      const p = join(d, n);
      const s = statSync(p);
      if (s.isDirectory()) geh(p);
      else if (endungen.includes(extname(n)) && !aus.some((a) => relative(WURZEL, p).startsWith(a))) r.push(p);
    }
  };
  geh(join(WURZEL, ordner));
  return r;
}

const LITERAL_JS = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const LITERAL_SWIFT = /"(?:[^"\\\n]|\\.)*"/g;

// Gemeint ist das Wort „Brain“ im Text. Kleingeschriebenes „brain“ ist im Deutschen fast immer ein Bezeichner (brain-sprache,
// brainkarten, brain:neu-oeffnen, brain ingest-check …) und wird nur geprüft, wenn es als englisches Wort auftaucht („my brain“).
function istSichtbar(text) {
  const s = bereinige(text);
  return /Brain|BRAIN/.test(s) || /\b(?:my|your|the|second|a|an|mein|dein|das|ein|im) brains?\b/i.test(s);
}

function bereinige(text) {
  let s = text;
  for (const r of ERLAUBT) s = s.replace(r, " ");
  return s;
}

function ausgenommen(rel, text) {
  return AUSNAHMEN.some((a) => rel.includes(a.datei) && a.muster.test(text));
}

// Findet sichtbare „Brain“ in Textliteralen (Code) bzw. in ganzen Zeilen (Markdown, HTML).
function funde(datei) {
  const rel = relative(WURZEL, datei);
  const ext = extname(datei);
  const out = [];
  const zeilen = readFileSync(datei, "utf8").split("\n");
  zeilen.forEach((zeile, i) => {
    const t = zeile.trim();
    let kandidaten;
    if (ext === ".md" || ext === ".html") kandidaten = [zeile];
    else {
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("#")) return; // Kommentarzeile
      kandidaten = zeile.match(ext === ".swift" ? LITERAL_SWIFT : LITERAL_JS) || [];
    }
    for (const k of kandidaten) {
      if (istSichtbar(k) && !ausgenommen(rel, k)) out.push(`${rel}:${i + 1}: ${t.slice(0, 160)}`);
    }
  });
  return out;
}

test("Swift: kein sichtbares „Brain“ in Textliteralen", () => {
  const alle = dateien("Sources", [".swift"]).flatMap(funde);
  assert.deepEqual(alle, [], `Sichtbares „Brain“ gefunden — die App heißt Kortex, der Datenordner Vault:\n${alle.join("\n")}`);
});

test("Studio: kein sichtbares „Brain“ in Texten", () => {
  const alle = dateien("Ressourcen/studio", [".js", ".html"]).flatMap(funde);
  assert.deepEqual(alle, [], `Sichtbares „Brain“ gefunden:\n${alle.join("\n")}`);
});

test("Werkstatt, gemeinsam und MCP-Server: kein sichtbares „Brain“ in Texten", () => {
  const alle = [...dateien("Ressourcen/werkstatt", [".mjs"]), ...dateien("Ressourcen/gemeinsam", [".mjs"]), ...dateien("Ressourcen/mcp", [".mjs"])].flatMap(funde);
  assert.deepEqual(alle, [], `Sichtbares „Brain“ gefunden:\n${alle.join("\n")}`);
});

test("Kern: kein sichtbares „Brain“ in Meldungen, Vorlagen und Skills", () => {
  const code = dateien("Ressourcen/kern", [".mjs", ".js"], ["Ressourcen/kern/ansicht/vendor", "Ressourcen/kern/ansicht/build"]);
  const doku = dateien("Ressourcen/kern", [".md", ".html"], ["Ressourcen/kern/HERKUNFT.md", "Ressourcen/kern/ansicht/DRITTANBIETER.md"]);
  const alle = [...code, ...doku].flatMap(funde);
  assert.deepEqual(alle, [], `Sichtbares „Brain“ gefunden:\n${alle.join("\n")}`);
});

test("Nutzerdoku: README nennt die App Kortex", () => {
  const rel = "README.md";
  const treffer = readFileSync(join(WURZEL, rel), "utf8").split("\n").map((z, i) => [i + 1, z]).filter(([, z]) => istSichtbar(z));
  assert.deepEqual(treffer, []);
});
