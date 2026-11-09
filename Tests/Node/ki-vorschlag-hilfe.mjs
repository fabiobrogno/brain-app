// Hilfen für die Tests der KI-Vorschläge (K0): ein Vault mit Posteingang, Notizen und einer Notiz mit „ki: nein“, zwei Claude-Konten, `claude` als Attrappe
// (Tests/Kern/fake-claude-vorschlag.mjs), alles unter dem Temp-Ordner. Der Test ändert process.env nicht; jede Kindprozess-Umgebung kommt aus baueTestUmgebung.
import { writeFileSync, mkdirSync, realpathSync, readFileSync, existsSync, readdirSync, statSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { tmp, schreibe, pfad } from "./hilfe.mjs";
import { baueTestUmgebung } from "./ki-konten-hilfe.mjs";
import { legeProgramm, pfadMit } from "./attrappe.mjs";

export const K = await import(pfad("gemeinsam", "ki-konten.mjs"));
export const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
export const FAKE = fileURLToPath(new URL("../Kern/fake-claude-vorschlag.mjs", import.meta.url));

export const frei = (p) => { try { process.kill(Number(p), 0); return false; } catch { return true; } }; // true = Prozess gibt es nicht mehr
export const warte = (ms) => new Promise((r) => setTimeout(r, ms));
export async function bis(f, ms = 8000, text = "Bedingung") {
  const ende = Date.now() + ms;
  for (;;) { const w = await f(); if (w) return w; if (Date.now() > ende) assert.fail(`${text}: nicht rechtzeitig erfüllt`); await warte(25); }
}

export const EINTRAG = "00_inbox/Atlas-Idee.md";
export const EINTRAG_TEXT = "# Atlas Idee\n\nWir sollten das Atlas Projekt mit der Kaffeemaschine besprechen und die Rechnung März ablegen.\n";

// Ein Vault, zwei Claude-Konten (A „Arbeit“ mit Stufe stufeA · B gesperrt), Standard-Konto; Einwilligung für A, wenn einwilligung: true.
export function szenarioV({ grenzen = {}, mitClaude = true, stufeA = "lesen", einwilligung = true, tempImVault = false, extraEnv = {}, jetzt = null, kontingent = null } = {}) {
  const home = realpathSync(tmp("brain-home-")), support = realpathSync(tmp("brain-support-")), bin = realpathSync(tmp("brain-bin-")), temp = realpathSync(tmp("brain-vorschlag-temp-"));
  const vault = realpathSync(tmp("vault-")), anderer = realpathSync(tmp("vault-zwei-"));
  for (const v of [vault, anderer]) schreibe(v, "brain.config.json", "{}\n");
  schreibe(vault, EINTRAG, EINTRAG_TEXT);
  schreibe(vault, "00_inbox/Nein.md", "---\nki: nein\n---\n# Nein\n\nDieser Eintrag geht nie an eine KI.\n");
  schreibe(vault, "10_projekte/Atlas.md", "# Atlas\n\nProjekt Atlas, Planung und Termine.\n");
  schreibe(vault, "10_projekte/Kaffeemaschine.md", "# Kaffeemaschine\n\nDie Kaffeemaschine muss entkalkt werden.\n");
  schreibe(vault, "10_projekte/Geheim.md", "---\nki: nein\n---\n# Atlas Kaffeemaschine Rechnung März\n\nGEHEIMER-INHALT-NIE-SENDEN Atlas Kaffeemaschine Rechnung.\n");
  schreibe(vault, "20_finanzen/Rechnung März.md", "# Rechnung März\n\nDie Rechnung vom März liegt hier.\n");
  schreibe(anderer, "00_inbox/Fremd.md", "# Fremd\n\nGEHEIM-ZWEI.\n");
  const profil = (n) => { const p = join(home, n); mkdirSync(p, { recursive: true }); writeFileSync(join(p, "settings.json"), "{}"); return realpathSync(p); };
  const a = profil(".claude-a"), b = profil(".claude-b"), std = profil(".claude");
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "Eins", pfad: vault, farbe: "#5B8DEF" }, { name: "Zwei", pfad: anderer, farbe: "#E5734F" }], aktiv: vault }));
  const ein = (id, programm, ordner, name, extra = {}) => [id, { programm, ordner, standard: false, name, ordnerKennung: K.kennungVon(ordner), ...extra }];
  const setze = (stufen, opts = {}) => K.aendere(support, () => ({ version: 1,
    konten: Object.fromEntries([ein("k_aaaaaaaa", "claude", a, "Arbeit", { abo: "max" }), ein("k_bbbbbbbb", "claude", b, "Geheimkonto"), ein("k_dddddddd", "claude", std, "Standard", { standard: true, abo: "api" })]),
    vaults: { [vault]: { ordnerKennung: K.kennungVon(vault), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: stufen.a, k_bbbbbbbb: "gesperrt", k_dddddddd: stufen.d || "lesen" },
        ...(opts.einwilligung === false ? {} : { vorschlaege: { an: true, seit: "2026-11-09T10:00:00.000Z", konto: "k_aaaaaaaa" } }) },
      [anderer]: { ordnerKennung: K.kennungVon(anderer), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: "lesen", k_bbbbbbbb: "gesperrt", k_dddddddd: "lesen" } } } }));
  setze({ a: stufeA }, { einwilligung });
  if (mitClaude) {
    legeProgramm(join(bin, "claude"), `#!${process.execPath}\nglobalThis.FAKE_ORDNER = ${JSON.stringify(bin)};\nimport(${JSON.stringify(pathToFileURL(FAKE).href)}).catch((e) => { console.error(String(e && e.stack || e)); process.exit(70); });\n`);
  }
  const env = baueTestUmgebung({ HOME: home, BRAIN_APP_SUPPORT: support, PATH: pfadMit(bin), BRAIN_CLAUDE_EXTRA: "", ...extraEnv });
  const h = erzeugeHandler({ vault, vaultOptionen: { support }, kontenHome: home, kontenErkennung: () => [], frageEnv: env, vorschlagGrenzen: grenzen,
    vorschlagTemp: tempImVault ? (mkdirSync(join(vault, "tmp-in")), join(vault, "tmp-in")) : temp, ...(jetzt ? { vorschlagJetzt: jetzt } : {}),
    ...(kontingent ? { vorschlagKontingent: kontingent } : {}) });
  const api = async (methode, p, daten) => {
    const q = p.indexOf("?");
    const r = await h({ methode, pfad: q < 0 ? p : p.slice(0, q), query: q < 0 ? null : p.slice(q + 1), body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
    let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
    return { status: r.status, j };
  };
  const szen = (o) => writeFileSync(join(bin, "szenario.json"), JSON.stringify(o));
  const aufrufe = () => (existsSync(join(bin, "aufrufe.jsonl")) ? readFileSync(join(bin, "aufrufe.jsonl"), "utf8").trim().split("\n").map((z) => JSON.parse(z)) : []);
  // Vault-Inhalt als Liste „Pfad Größe Zeit“, um zu zeigen, dass nichts entsteht
  const abbild = (wurzel) => { const r = []; const geh = (d) => { for (const n of readdirSync(d, { withFileTypes: true })) { const p = join(d, n.name); if (n.isDirectory()) { r.push(`${relative(wurzel, p)}/`); geh(p); } else { const s = statSync(p); r.push(`${relative(wurzel, p)} ${s.size} ${s.mtimeMs}`); } } }; geh(wurzel); return r.sort(); };
  async function folge(id) {
    for (let i = 0; i < 400; i++) {
      const r = await api("GET", `/api/ki/vorschlag/stand?id=${id}`);
      assert.equal(r.status, 200, JSON.stringify(r.j));
      if (r.j.fertig) return r.j;
    }
    assert.fail("Anfrage wird nicht fertig");
  }
  // Eine Anfrage bis zum Ende laufen lassen: → { start, stand }
  async function anfrage(eingabe = { funktion: "posteingang", pfad: EINTRAG }, { konto = "k_aaaaaaaa" } = {}) {
    const s = await api("POST", "/api/ki/vorschlag/start", { konto, ...eingabe });
    assert.equal(s.status, 200, JSON.stringify(s.j));
    return { start: s.j, stand: await folge(s.j.id) };
  }
  return { home, support, bin, temp, vault, anderer, a, b, std, h, api, szen, aufrufe, abbild, folge, anfrage, setze, env };
}
export { rmSync };
