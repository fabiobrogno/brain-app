// Hilfen für die Tests „Anmelden im Fenster“ (Paket E3): Platzhalter für `claude` und `codex`, die eine Anmeldung nur vortäuschen.
// Nie ein echtes Programm, nie ein echtes Konto. Jede Attrappe bricht ab (Exit 99), wenn ihr Zielordner (CLAUDE_CONFIG_DIR bzw. CODEX_HOME) außerhalb des Temp-Ordners liegt.
// Das Verhalten steht im Szenario (`<bin>/szenario.json`), das die Attrappe bei jedem Start liest:
//   modus: "ok" (Adresse/Code ausgeben, kurz warten, angemeldet, Exit 0) · "hang" (Adresse ausgeben, ewig warten) · "fehler" (Adresse, Exit 1)
//          "keine-adresse" (gibt nichts Brauchbares aus, wartet ewig) · "ohne-konto" (Exit 0, aber nicht angemeldet) · "nur-ausgabe" (Claude: Adresse nur auf stdout, ohne BROWSER) · "umbrochen" (Claude: Adresse auf stdout bei 80 Spalten umbrochen, danach BROWSER mit der ganzen Adresse)
//   warteAufCode: true → Claude wartet auf eine Zeile an stdin (merkt sie sich NUR in `<bin>/code-erhalten.txt`, der Test prüft damit, dass sie ankam)
// Aufgezeichnet wird in `<bin>/aufrufe.jsonl` (Argumente), `<bin>/umgebung-<pid>.json` (alle Umgebungsnamen und die Konto-Variablen) und `<bin>/pids.json` (Haupt- und Kindprozess).
import { writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tmp } from "./hilfe.mjs";
import { legeProgramm } from "./attrappe.mjs";

export const GEHEIM = "sk-ant-oat01-GEHEIMER-TESTSCHLUESSEL-0123456789";
export const GEHEIM_DATEI = "GEHEIMER-INHALT-DER-ANMELDEDATEI-9876";

const SKRIPT = (bin, temp) => `#!${process.execPath}
const fs = require("node:fs"); const path = require("node:path"); const cp = require("node:child_process");
const BIN = ${JSON.stringify(bin)}, TEMP = ${JSON.stringify(temp)}, GEHEIM = ${JSON.stringify(GEHEIM)}, GEHEIM_DATEI = ${JSON.stringify(GEHEIM_DATEI)};
const PROGRAMM = path.basename(process.argv[1]).replace(/\.(?:cjs|exe)$/, ""); // Windows: Skript heißt claude.cjs
const VAR = PROGRAMM === "claude" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME";
const sz = JSON.parse(fs.readFileSync(path.join(BIN, "szenario.json"), "utf8"));
const args = process.argv.slice(2).join(" ");
let ziel = process.env[VAR];
if (ziel !== undefined) {
  let echt = ""; try { echt = fs.realpathSync(ziel); } catch { echt = ziel; }
  if (!(echt === TEMP || echt.startsWith(TEMP + path.sep))) { console.error("Attrappe: Zielordner außerhalb des Temp-Ordners"); process.exit(99); }
} else ziel = path.join(BIN, "standard-konto"); // Standardkonto: bleibt innerhalb der Attrappe
fs.mkdirSync(ziel, { recursive: true });
const marke = path.join(ziel, "angemeldet");
fs.appendFileSync(path.join(BIN, "aufrufe.jsonl"), JSON.stringify({ programm: PROGRAMM, args }) + "\\n");

const STATUS = PROGRAMM === "claude" ? "auth status" : "login status";
const LOGIN = PROGRAMM === "claude" ? "auth login" : "login --device-auth";
if (args === STATUS) { if (sz.statusVerzoegerung) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sz.statusVerzoegerung); console.log("Logged in — token " + GEHEIM); process.exit(fs.existsSync(marke) ? 0 : 1); }
if (args !== LOGIN) { console.error("unbekannte Argumente: " + args); process.exit(2); }

const wartet = new Promise(() => {});
fs.writeFileSync(path.join(BIN, "umgebung-" + process.pid + ".json"), JSON.stringify({ programm: PROGRAMM, namen: Object.keys(process.env), konto: process.env[VAR] ?? null, home: process.env.HOME ?? null, browser: process.env.BROWSER ?? null }));
const kind = cp.spawn(process.execPath, ["-e", "setTimeout(() => {}, 300000)"], { stdio: "ignore" }); // gleiche Prozessgruppe: soll beim Abbruch mit sterben
fs.writeFileSync(path.join(BIN, "pids.json"), JSON.stringify({ haupt: process.pid, kind: kind.pid }));
fs.writeFileSync(path.join(ziel, ".credentials.json"), GEHEIM_DATEI);
const URL_CLAUDE = "https://claude.ai/oauth/authorize?code=true&client_id=testkennung&response_type=code&code_challenge=pruefwert0123456789abcdefghijklmnopqrstuvwxyz&code_challenge_method=S256&state=zustand123";
(async () => {
  if (sz.modus === "keine-adresse") { console.log("Etwas ganz anderes " + GEHEIM); await wartet; }
  if (PROGRAMM === "claude") {
    console.log("Opening browser to sign in… " + GEHEIM); console.error("token=" + GEHEIM);
    if (sz.modus === "nur-ausgabe") console.log("If the browser didn't open, visit: " + URL_CLAUDE);
    else if (sz.modus === "umbrochen") { // wie Ink bei 80 Spalten: die Adresse bricht um, danach ruft das Programm BROWSER mit der ganzen Adresse
      console.log("If the browser didn't open, visit:\\n" + URL_CLAUDE.match(/.{1,80}/g).join("\\n"));
      await new Promise((r) => setTimeout(r, 400));
      if (process.env.BROWSER) { try { if (/\\.cmd$/i.test(process.env.BROWSER)) cp.execSync('"' + process.env.BROWSER + '" "' + URL_CLAUDE + '"', { stdio: "ignore" }); else cp.execFileSync(process.env.BROWSER, [URL_CLAUDE], { stdio: "ignore" }); } catch {} }
    }
    else if (process.env.BROWSER) { try { if (/\\.cmd$/i.test(process.env.BROWSER)) cp.execSync('"' + process.env.BROWSER + '" "' + URL_CLAUDE + '"', { stdio: "ignore" }); else cp.execFileSync(process.env.BROWSER, [URL_CLAUDE], { stdio: "ignore" }); } catch {} }
    else console.log("If the browser didn't open, visit: " + URL_CLAUDE); // ohne BROWSER gibt Claude die Adresse aus
  } else {
    console.log("Welcome to Codex\\n\\nFollow these steps to sign in with ChatGPT using device code authorization:\\n\\n1. Open this link in your browser and sign in to your account\\n   https://auth.openai.com/codex/device\\n\\n2. Enter this one-time code (expires in 15 minutes)\\n   ABCD-12345\\n\\nDevice codes are a common phishing target. Never share this code.\\n");
    console.error("access_token=" + GEHEIM); console.log("refresh_token: " + GEHEIM);
  }
  if (sz.modus === "hang") await wartet;
  if (sz.modus === "fehler") { console.error("login failed " + GEHEIM); process.exit(1); }
  if (sz.warteAufCode) {
    const zeile = await new Promise((r) => { let t = ""; process.stdin.on("data", (d) => { t += d; if (t.includes("\\n")) r(t.split("\\n")[0]); }); });
    fs.writeFileSync(path.join(BIN, "code-erhalten.txt"), zeile);
  } else await new Promise((r) => setTimeout(r, sz.verzoegerung ?? 250));
  if (sz.modus === "ohne-konto") process.exit(0);
  fs.writeFileSync(marke, "ja");
  process.exit(0);
})();
`;

export function platzhalter(szenario = {}) {
  const bin = tmp("brain-anmelde-bin-");
  const temp = realpathSync(tmpdir());
  const setze = (neu) => writeFileSync(join(bin, "szenario.json"), JSON.stringify({ modus: "ok", ...neu }));
  setze(szenario);
  for (const name of ["claude", "codex"]) legeProgramm(join(bin, name), SKRIPT(bin, temp));
  return { bin, setze };
}
