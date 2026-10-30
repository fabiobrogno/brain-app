// test-keine-altpfade.mjs — Lint für den Kern (Paket P2): in Ressourcen/kern/** darf weder der alte Kit-Ordner im Vault („.tools“)
// noch ein fester Rückfall auf ~/brain stehen. Der Kern liegt außerhalb des Vaults (KERN), der Vault kommt nur aus --vault,
// BRAIN_VAULT oder der Vaultliste der App (pfade.mjs). Ausnahmen nur für Migrations-/Erkennungscode, einzeln und mit Begründung.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, lstatSync, existsSync } from "node:fs";
import { join, relative, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
// Kern-Wurzel: in der Bühne (stage.sh) ist es der Elternordner der Tests (KORTEX_KERN), sonst Ressourcen/kern im Repo.
const WURZEL = process.env.KORTEX_KERN || join(HIER, "..", "..", "Ressourcen", "kern");

// Muster, die verboten sind. `name` taucht in der Allowlist wieder auf.
const HOME_BRAIN = [
  /homedir\(\)\s*,\s*["'`]brain["'`]/,                                  // join(homedir(), "brain")
  /homedir\(\)\s*\+\s*["'`]\/brain/,                                    // homedir() + "/brain"
  /\bjoin\(\s*[\w.]*(?:home|HOME)\w*\s*,\s*["'`]brain["'`]/,            // join(home, "brain"), join(HOME, "brain")
  /\b(?:home|HOME|heim)\w*\s*\+\s*["'`]\/brain(?![\w-])/,               // home + "/brain"
  /process\.env\.(?:HOME|USERPROFILE)\s*\+\s*["'`]\/?brain/,            // Umgebungsvariable HOME plus "/brain"
  /\$\{\s*(?:home|HOME|homedir\(\))\s*\}\/brain(?![\w-])/,              // `${home}/brain`
  /(?:\$HOME|\$\{HOME\}|~)\/brain(?![\w-])/,                            // $HOME/brain, ~/brain
];
export const REGELN = [
  { name: "alter-kit-ordner", muster: /\.tools\b/, hinweis: "alter Kit-Ordner im Vault (.tools) — Kern-Dateien über KERN aus pfade.mjs ansprechen" },
  { name: "home-brain", muster: { test: (z) => HOME_BRAIN.some((m) => m.test(z)) }, hinweis: "fester Rückfall auf ~/brain — der Vault kommt aus --vault, BRAIN_VAULT oder der App-Vaultliste" },
];

// Ausnahmen: nur Migrations-/Erkennungscode. Je Eintrag eine genaue Zahl erlaubter Zeilen und ein Muster, dem jede dieser Zeilen entsprechen muss — eine neue
// Fundstelle in derselben Datei schlägt also fehl. Jeder Eintrag muss tatsächlich etwas treffen, sonst schlägt der Test fehl (keine toten Ausnahmen).
export const ALLOWLIST = [
  { datei: "pfade.mjs", regel: "alter-kit-ordner", anzahl: 1, zeile: /^export const ALT_KIT_ORDNER = "\.tools";/, grund: "Einzige Definition (ALT_KIT_ORDNER) des alten Kit-Ordners; alle anderen Module erkennen/schützen ihn nur über diese Konstante (noch nicht umgestellte Vaults, P7)." },
  { datei: "HERKUNFT.md", regel: "alter-kit-ordner", anzahl: 4, zeile: /\.tools/, grund: "Dokumentation der Herkunft: beschreibt das alte Layout <vault>/.tools, aus dem der Kern stammt." },
];

const TEXT_ENDUNGEN = /\.(mjs|js|cjs|sh|md|json|css|html|txt|yml|yaml)$/i;
const OHNE_ENDUNG = new Set(["pre-commit", "VERSION"]);

function dateien(wurzel) {
  const out = [];
  const lauf = (dir) => {
    for (const n of readdirSync(dir).sort()) {
      const p = join(dir, n);
      const rel = relative(wurzel, p).split(sep).join("/");
      if (rel === "tests" || rel === "node_modules" || rel.startsWith("ansicht/vendor")) continue;   // tests = Bühnenkopie von Tests/Kern, vendor = Fremdcode
      const st = lstatSync(p);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) lauf(p);
      else if (st.isFile() && (TEXT_ENDUNGEN.test(n) || OHNE_ENDUNG.has(n))) out.push({ rel, p });
    }
  };
  lauf(wurzel);
  return out;
}

// → [{ datei, zeile, regel, text }] für alle Treffer (vor Anwendung der Allowlist)
export function sucheTreffer(texte) {
  const t = [];
  for (const { rel, inhalt } of texte) {
    inhalt.split(/\r?\n/).forEach((text, i) => {
      for (const r of REGELN) if (r.muster.test(text)) t.push({ datei: rel, zeile: i + 1, regel: r.name, text: text.trim().slice(0, 120) });
    });
  }
  return t;
}

test("Sicherung des Tests selbst: die Muster erkennen Altlasten", () => {
  const f = (s) => REGELN.filter((r) => r.muster.test(s)).map((r) => r.name);
  assert.deepEqual(f('join(vault, ".tools", "brain.mjs")'), ["alter-kit-ordner"]);
  assert.deepEqual(f("node .tools/brain.mjs search"), ["alter-kit-ordner"]);
  assert.deepEqual(f('const v = join(homedir(), "brain");'), ["home-brain"]);
  assert.deepEqual(f("const v = os.homedir() + \"/brain\";"), ["home-brain"]);
  assert.deepEqual(f('vault = "$HOME/brain"'), ["home-brain"]);
  assert.deepEqual(f("cd ~/brain && ls"), ["home-brain"]);
  assert.deepEqual(f('const v = join(home, "brain");'), ["home-brain"]);
  assert.deepEqual(f("const v = join(os.homedir(), 'brain');"), ["home-brain"]);
  assert.deepEqual(f('const heim = join(HOME, "brain");'), ["home-brain"]);
  assert.deepEqual(f('const v = process.env.' + 'HOME + "/brain";'), ["home-brain"]);
  assert.deepEqual(f("const v = `${home}/brain`;"), ["home-brain"]);
  assert.deepEqual(f('const v = home + "/brain/wiki";'), ["home-brain"]);
  assert.deepEqual(f('join(home, "brain-kit")'), []);
  assert.deepEqual(f("~/brain-kit nennt ~/brain nicht"), ["home-brain"]);
  // erlaubt: andere Wörter
  assert.deepEqual(f('join(homedir(), ".brain-kit", "bin")'), []);
  assert.deepEqual(f("~/brain-kit"), []);
  assert.deepEqual(f(".logs/ansicht und werkzeuge"), []);
  assert.deepEqual(f('querySelector(".top .werkzeuge")'), []);
});

test("Ressourcen/kern/** ist frei von .tools-Literalen und ~/brain außerhalb der Allowlist", () => {
  assert.ok(existsSync(join(WURZEL, "brain.mjs")), `Kern nicht gefunden: ${WURZEL}`);
  const liste = dateien(WURZEL);
  assert.ok(liste.length > 100, `zu wenige Dateien gescannt (${liste.length}) — Wurzel ${WURZEL}`);
  const texte = liste.map(({ rel, p }) => ({ rel, inhalt: readFileSync(p, "utf8") }));
  const treffer = sucheTreffer(texte);
  const erlaubt = (t) => ALLOWLIST.some((a) => a.datei === t.datei && a.regel === t.regel && a.zeile.test(t.text));
  const verboten = treffer.filter((t) => !erlaubt(t));
  assert.deepEqual(verboten, [], "Altpfade im Kern:\n" + verboten.map((t) => `  ${t.datei}:${t.zeile} [${t.regel}] ${t.text}`).join("\n")
    + "\n→ " + REGELN.map((r) => `${r.name}: ${r.hinweis}`).join("\n→ "));
});

test("Allowlist: jede Ausnahme hat eine Begründung und trifft GENAU die erlaubte Zahl Zeilen (weder tot noch aufgeweicht)", () => {
  const liste = dateien(WURZEL);
  const treffer = sucheTreffer(liste.map(({ rel, p }) => ({ rel, inhalt: readFileSync(p, "utf8") })));
  for (const a of ALLOWLIST) {
    assert.ok(a.grund && a.grund.length > 20, `${a.datei}: Begründung fehlt`);
    assert.ok(REGELN.some((r) => r.name === a.regel), `${a.datei}: unbekannte Regel ${a.regel}`);
    const meine = treffer.filter((t) => t.datei === a.datei && t.regel === a.regel);
    assert.equal(meine.length, a.anzahl, `${a.datei} (${a.regel}): erlaubt sind genau ${a.anzahl} Zeilen, gefunden ${meine.length}:\n${meine.map((t) => `  ${t.zeile}: ${t.text}`).join("\n")}`);
    for (const t of meine) assert.match(t.text, a.zeile, `${a.datei}:${t.zeile} passt nicht zum erlaubten Zeilenmuster`);
  }
});

test("Der gescannte Kern enthält keine Dateien außerhalb von UTF-8-Text mit NUL-Bytes (Scan ist vollständig)", () => {
  for (const { rel, p } of dateien(WURZEL)) assert.ok(!readFileSync(p).includes(0), `${rel}: Binärdaten in einer Textdatei`);
});
