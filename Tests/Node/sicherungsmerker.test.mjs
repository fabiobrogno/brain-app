// „Dieses Remote hat der Nutzer bestätigt“ (Review 3, Punkt 7): die Werkstatt (gemeinsam/sicherungsmerker.mjs) und der Kern (kern/backup.mjs)
// müssen denselben Merker meinen — <Support>/backup/<Kennung>.json → remoteBestaetigt. Ohne Merker pusht der Kern nicht.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync, chmodSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmp, repo, g, pfad } from "./hilfe.mjs";

process.env.HOME = tmp("brain-home-");
process.env.GIT_CONFIG_NOSYSTEM = "1";
const SUPPORT = tmp("brain-support-");
process.env.BRAIN_APP_SUPPORT = SUPPORT; // der Kern liest den Support-Ordner aus der Umgebung

const { merkeRemoteBestaetigt, merkerDatei, leseMerker, kennung } = await import(pfad("gemeinsam", "sicherungsmerker.mjs"));
const Kern = await import(pfad("kern", "backup.mjs"));
const { erzeugeGitHub } = await import(pfad("gemeinsam", "github.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));

test("Werkstatt und Kern meinen dieselbe Datei: was die Werkstatt vermerkt, erkennt pushErlaubnis; ein anderes Ziel nicht", () => {
  const v = repo();
  g(v, "remote", "add", "origin", "https://example.org/u/r.git");
  assert.deepEqual(Kern.pushErlaubnis(v), { ok: false, url: "https://example.org/u/r.git", grund: "nicht-bestaetigt" });
  assert.equal(merkeRemoteBestaetigt(v, "https://example.org/u/r.git", { support: SUPPORT }), true);
  assert.ok(existsSync(join(SUPPORT, "backup", `${kennung(v)}.json`)));
  assert.equal(merkerDatei(v, SUPPORT), join(SUPPORT, "backup", `${kennung(v)}.json`));
  assert.equal(Kern.pushErlaubnis(v).ok, true);
  g(v, "remote", "set-url", "origin", "https://example.org/fremd/anderes.git");
  assert.equal(Kern.pushErlaubnis(v).grund, "anderes-remote");
  // umgekehrt: was der Kern vermerkt, liest die Werkstatt
  Kern.bestaetigeRemote(v, "https://example.org/fremd/anderes.git");
  assert.equal(leseMerker(v, SUPPORT).remoteBestaetigt, "https://example.org/fremd/anderes.git");
  assert.equal(Kern.pushErlaubnis(v).ok, true);
});

test("der Merker behält den Sicherungsordner, lehnt Müll ab und wirft nie", () => {
  const v = repo();
  mkdirSync(join(SUPPORT, "backup"), { recursive: true });
  writeFileSync(merkerDatei(v, SUPPORT), JSON.stringify({ pfad: "/Volumes/USB/Sicherung" }));
  assert.equal(merkeRemoteBestaetigt(v, "git@example.org:u/r.git", { support: SUPPORT }), true);
  assert.deepEqual(JSON.parse(readFileSync(merkerDatei(v, SUPPORT), "utf8")), { pfad: "/Volumes/USB/Sicherung", remoteBestaetigt: "git@example.org:u/r.git" });
  for (const schlecht of ["", null, undefined, 5, "https://x\ny", "a\u0000b"]) assert.equal(merkeRemoteBestaetigt(v, schlecht, { support: SUPPORT }), false);
  assert.equal(merkeRemoteBestaetigt(v, "https://x/y", { support: join(SUPPORT, "backup", `${kennung(v)}.json`, "kein-ordner") }), false);
  assert.deepEqual(readdirSync(join(SUPPORT, "backup")).filter((n) => n.endsWith(".tmp")), [], "keine halben Dateien");
});

test("die Route /api/git/remote und /api/sicherung/verbinden setzen den Merker; eine abgelehnte Eingabe nicht", async () => {
  const support = tmp("brain-support2-");
  // Schein-Schlüsselbund (wie in sicherung.test.mjs): antwortet nur auf protocol=https + host=github.com
  const bund = tmp("brain-bund-"), helper = join(bund, "git-credential-fake");
  writeFileSync(join(bund, "konto.txt"), "username=anna-test\npassword=gho_NUR_FUER_DEN_TEST\n");
  writeFileSync(helper, `#!/bin/sh\n[ "$1" = get ] || exit 0\neingabe=$(cat)\necho "$eingabe" | grep -qx 'protocol=https' && echo "$eingabe" | grep -qx 'host=github.com' || exit 1\ncat "${join(bund, "konto.txt")}"\n`);
  chmodSync(helper, 0o755);
  const bare = () => { const b = tmp("brain-bare-"); g(b, "init", "-q", "--bare", "-b", "main"); return b; };
  const privat = { name: "mein-brain", private: true, archived: false, owner: { login: "anna-test" }, permissions: { push: true } };
  const baue = (v, ziel) => {
    const github = erzeugeGitHub({ clientId: "Iv1.t", apiBasis: "http://127.0.0.1:1", helper, fetch: async () => new Response(JSON.stringify(privat), { status: 200 }), log: () => {}, repoAdresse: () => ziel });
    const h = erzeugeHandler({ vault: v, vaultOptionen: { support }, github });
    return async (methode, p, body) => { const r = await h({ methode, pfad: p, query: null, body: Buffer.from(JSON.stringify(body)) }); return { status: r.status, text: r.body.toString("utf8") }; };
  };
  // Studio „Remote hinzufügen“ (die Adresse darf in der Testumgebung lokal sein)
  const v1 = repo(), ziel1 = bare();
  const rufe1 = baue(v1, ziel1);
  const r = await rufe1("POST", "/api/git/remote", { url: ziel1 });
  assert.equal(r.status, 200, r.text);
  assert.equal(leseMerker(v1, support).remoteBestaetigt, ziel1);
  const vorher = readFileSync(merkerDatei(v1, support), "utf8");
  const nein = await rufe1("POST", "/api/git/remote", { url: "ftp://example.org/x" });
  assert.notEqual(nein.status, 200);
  assert.equal(readFileSync(merkerDatei(v1, support), "utf8"), vorher, "eine abgelehnte Adresse ändert den Merker nicht");
  // Assistent „Sicherung“
  const v2 = repo(), ziel2 = bare();
  const rufe2 = baue(v2, ziel2);
  assert.equal(existsSync(merkerDatei(v2, support)), false);
  const r2 = await rufe2("POST", "/api/sicherung/verbinden", { besitzer: "anna-test", name: "mein-brain" });
  assert.equal(r2.status, 200, r2.text);
  assert.equal(leseMerker(v2, support).remoteBestaetigt, ziel2);
});

test("backup einrichten github bestätigt das vorhandene origin (https/ssh), ein lokales nicht; keins löscht die Bestätigung", () => {
  const v = repo();
  g(v, "remote", "add", "origin", "git@example.org:u/r.git");
  const R = process.env.BRAIN_VAULT; delete process.env.BRAIN_VAULT;
  Kern.einrichten(v, "github");
  assert.equal(Kern.pushErlaubnis(v).ok, true);
  Kern.einrichten(v, "keins");
  assert.equal(Kern.pushErlaubnis(v).grund, "nicht-bestaetigt");
  g(v, "remote", "set-url", "origin", "/tmp/lokal/repo.git");
  Kern.einrichten(v, "github");
  assert.equal(Kern.pushErlaubnis(v).ok, false, "ein lokaler Pfad wird nie bestätigt");
  if (R) process.env.BRAIN_VAULT = R;
});
