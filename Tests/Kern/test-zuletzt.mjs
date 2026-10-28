// K11 „Was war zuletzt": wörtlich aus Verläufen, Git und Handoff; ≤ 600 Zeichen; Titel nie mit Zugangsdaten;
// ohne Git/ohne Verlauf still. „Anbieten, nicht beanspruchen": nichts wird verändert.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdirSync, writeFileSync, utimesSync, realpathSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { gitWurzel, projektSchluessel } from "../projekt.mjs";
import { letzteSitzungen, offenAusSessionDatei, wasWarZuletzt, ZULETZT_MAX } from "../zuletzt.mjs";
import { tempOrdner, tempVault, schreibeVerlauf, nutzer, kiTitel, eigenerTitel, hook } from "./verlauf-fixture.mjs";

const OHNE_GIT = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
const git = (cwd, args, env = {}) => execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args],
  { encoding: "utf8", env: { ...OHNE_GIT, ...env } });
const vor = (min) => new Date(Date.now() - min * 60000);
// Secret-Köder dynamisch zusammengesetzt (sonst schlägt der Publish-Check an).
const KOEDER = ["tok", "en"].join("") + "=abcdefgh12345678";

function projekt() {
  const basis = tempOrdner("Arbeit Ü");
  const repo = join(basis, "Garten App");
  mkdirSync(join(repo, "src"), { recursive: true });
  git(repo, ["init", "-q"]);
  writeFileSync(join(repo, "a.txt"), "a");
  git(repo, ["add", "a.txt"]);
  git(repo, ["commit", "-qm", "uralt"], { GIT_AUTHOR_DATE: "2020-01-01T00:00:00", GIT_COMMITTER_DATE: "2020-01-01T00:00:00" });
  writeFileSync(join(repo, "b.txt"), "b");
  git(repo, ["add", "b.txt"]);
  git(repo, ["commit", "-qm", "Export gebaut"]);
  const verlaeufe = join(basis, "projects", "-Arbeit-Garten-App");
  const sitzung = (name, eintraege, minVor) => {
    const f = join(verlaeufe, `${name}.jsonl`);
    schreibeVerlauf(f, eintraege);
    utimesSync(f, vor(minVor), vor(minVor));
    return f;
  };
  sitzung("alt1", [nutzer("Erste alte Sitzung", { zeit: vor(300).toISOString() })], 290);
  sitzung("mitTitel", [nutzer("Export planen", { zeit: vor(150).toISOString() }), kiTitel("Export für Garten-App planen")], 120);
  sitzung("eigen", [nutzer("x", { zeit: vor(90).toISOString() }), kiTitel("KI-Titel"), eigenerTitel("Mein Name für die Sitzung")], 60);
  sitzung("geheim", [nutzer(`${KOEDER} bitte einbauen`, { zeit: vor(40).toISOString() })], 30);
  sitzung("leer", [{ type: "permission-mode", mode: "auto" }], 10);
  const eigene = sitzung("eigene", [nutzer("aktuelle Sitzung")], 0);
  mkdirSync(join(verlaeufe, "memory"), { recursive: true });
  writeFileSync(join(verlaeufe, "memory", "session_garten_2026-10-15.md"),
    "---\nname: s\n---\n\n**Was lief**\n- viel\n\n**🔴 Offen**\n- Export testen\n- Doku schreiben\n\n**⚠️ Fallen**\n- nie auf main\n");
  return { repo, verlaeufe, eigene };
}

test("gitWurzel/projektSchluessel: aus Unterordner und nicht existierendem Pfad; ohne Repo null; Vault ohne Git zählt", () => {
  const { repo } = projekt();
  assert.equal(gitWurzel(join(repo, "src")), realpathSync(repo));
  assert.equal(gitWurzel(join(repo, "gibt", "es", "nicht")), realpathSync(repo));
  const ohne = tempOrdner("ohne Repo");
  assert.equal(gitWurzel(ohne), null);
  const v = tempVault("Brain ohne Git");
  assert.equal(projektSchluessel(v, join(v, "09_wiki")), realpathSync(v));
  assert.equal(projektSchluessel(v, ohne), null);
  assert.equal(projektSchluessel(v, ""), null);
});

test("letzteSitzungen: neueste drei mit Inhalt, ohne die eigene; Titel eigen > KI > erste Nachricht; Zugangsdaten nie im Titel", () => {
  const { eigene } = projekt();
  const s = letzteSitzungen(eigene, { eigeneSid: "eigene" });
  assert.deepEqual(s.map((x) => x.sid), ["geheim", "eigen", "mitTitel"]);
  assert.deepEqual(s.map((x) => x.titel), ["(Titel ausgeblendet)", "Mein Name für die Sitzung", "Export für Garten-App planen"]);
});

test("offenAusSessionDatei: nur der Abschnitt „Offen“ der jüngsten session_*.md, wörtlich, Datei bleibt unverändert", () => {
  const { verlaeufe } = projekt();
  const datei = join(verlaeufe, "memory", "session_garten_2026-10-15.md");
  const vorher = readFileSync(datei, "utf8");
  const o = offenAusSessionDatei(join(verlaeufe, "memory"));
  assert.equal(o.datei, "session_garten_2026-10-15.md");
  assert.deepEqual(o.zeilen, ["- Export testen", "- Doku schreiben"]);
  assert.equal(readFileSync(datei, "utf8"), vorher, "anbieten, nicht beanspruchen");
  assert.equal(offenAusSessionDatei(join(verlaeufe, "gibt-es-nicht")), null);
});

test("wasWarZuletzt: Sitzungen, Commits seit der letzten Sitzung, Offen — ≤ 600 Zeichen", () => {
  const { repo, eigene } = projekt();
  const t = wasWarZuletzt({ transkriptPfad: eigene, sid: "eigene", cwd: join(repo, "src") });
  assert.ok(t.length <= ZULETZT_MAX, String(t.length));
  assert.match(t, /^Zuletzt in diesem Ordner/);
  assert.match(t, /„Mein Name für die Sitzung“/);
  assert.match(t, /Commits seit .*\n- [0-9a-f]{7,} Export gebaut/);
  assert.doesNotMatch(t, /uralt/);
  assert.match(t, /Offen laut session_garten_2026-10-15\.md/);
  assert.match(t, /- Export testen/);
  assert.doesNotMatch(t, /abcdefgh12345678/);
});

test("wasWarZuletzt: ohne Git keine Commit-Zeile; ohne Verlauf leer", () => {
  const { eigene } = projekt();
  const t = wasWarZuletzt({ transkriptPfad: eigene, sid: "eigene", cwd: tempOrdner("kein Repo") });
  assert.doesNotMatch(t, /Commits seit/);
  assert.match(t, /„Mein Name/);
  assert.equal(wasWarZuletzt({ transkriptPfad: "", sid: "x" }), "");
  assert.equal(wasWarZuletzt({ transkriptPfad: join(tempOrdner(), "nix", "a.jsonl"), sid: "a" }), "");
});

test("SessionStart: startup zeigt „Zuletzt“, compact nicht", () => {
  const { repo, eigene } = projekt();
  const v = tempVault();
  const env = { BRAIN_SESSION_NUR_STATUS: "1" };
  const s = hook("session-start.mjs", { session_id: "eigene", source: "startup", cwd: repo, transcript_path: eigene }, { vault: v, env });
  assert.equal(s.status, 0);
  assert.match(s.stdout, /Zuletzt in diesem Ordner/);
  const c = hook("session-start.mjs", { session_id: "eigene", source: "compact", cwd: repo, transcript_path: eigene }, { vault: v, env });
  assert.doesNotMatch(c.stdout, /Zuletzt in diesem Ordner/);
});
