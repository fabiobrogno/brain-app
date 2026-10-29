// test-git-sicher-liste.mjs — Paket P7a: git-sicher-pruefung.pl --alle liefert ALLE verbotenen Schlüsselnamen auf einmal (Befund der Umstellung), der Normalmodus
// (den git-sicher benutzt) bleibt unverändert. Immer nur Namen, nie Werte. Nur Wegwerf-Repos in Temp.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const KERN = fileURLToPath(new URL("..", import.meta.url));
const PL = join(KERN, "git-sicher-pruefung.pl");
const GIT = ["/opt/homebrew/bin/git", "/usr/local/bin/git", "/usr/bin/git"].find((p) => { try { execFileSync(p, ["--version"], { stdio: "ignore" }); return true; } catch { return false; } });
const GEHEIM = "GEHEIM-xyz";
const ENV = { PATH: "/usr/bin:/bin", HOME: tmpdir(), LC_ALL: "C", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };   // Produktion: keine Testschalter
const ENV_TEST = { ...ENV, KORTEX_KERN_UNSTABIL_ERLAUBT: "1" };

function repo() {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "git-liste-")));
  execFileSync(GIT, ["-C", d, "init", "-q", "-b", "main"], { env: ENV });
  const g = (...a) => execFileSync(GIT, ["-C", d, ...a], { env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { d, g, weg: () => rmSync(d, { recursive: true, force: true }) };
}
const lauf = (d, extra = [], env = ENV) => spawnSync("/usr/bin/perl", [PL, GIT, d, ...extra], { encoding: "utf8", env });
const namen = (r) => r.stdout.split("\n").filter((z) => z.startsWith("REFUSE\t")).map((z) => z.slice(7));

test("--alle: sauberer Vault → OK, Exit 0 (wie der Normalmodus)", () => {
  const r = repo();
  try {
    r.g("config", "user.name", "Max"); r.g("config", "core.hooksPath", "/x/hooks");
    for (const extra of [[], ["--alle"], ["--alle"]]) {
      const l = lauf(r.d, extra);
      assert.equal(l.status, 0);
      assert.match(l.stdout, /^OK\nHOOKSPATH\t\/x\/hooks\n$/);
    }
  } finally { r.weg(); }
});

test("--alle nennt alle verbotenen Schlüssel, der Normalmodus nur den ersten", () => {
  const r = repo();
  try {
    r.g("config", "credential.helper", "osxkeychain"); r.g("config", "core.sshCommand", "ssh -i x"); r.g("config", "user.name", "a&b");
    r.g("config", "filter.lfs.clean", "git-lfs clean %f"); r.g("config", "http.https://example.org/.extraheader", "X: y");
    const alle = lauf(r.d, ["--alle"]);
    assert.equal(alle.status, 1);
    assert.deepEqual(namen(alle).sort(), ["core.sshcommand", "credential.helper", "filter.lfs.clean", "http.https://example.org/.extraheader", "user.name"]);
    const normal = lauf(r.d);
    assert.equal(normal.status, 1);
    assert.equal(namen(normal).length, 1, "ohne --alle bleibt es beim ersten");
    assert.ok(namen(alle).includes(namen(normal)[0]));
    assert.equal(lauf(r.d, ["--alle", "--alle"]).stdout, alle.stdout);
    assert.equal(spawnSync("/usr/bin/perl", [PL, "--alle", GIT, r.d], { encoding: "utf8", env: ENV }).stdout, alle.stdout, "--alle gilt an jeder Stelle");
  } finally { r.weg(); }
});

test("--alle liefert dieselben Namen wie wiederholte Einzelläufe (Schlüssel entfernen, erneut prüfen)", () => {
  const r = repo();
  try {
    r.g("config", "--add", "credential.helper", ""); r.g("config", "--add", "credential.helper", "store");
    r.g("config", "include.path", "x.cfg"); r.g("config", "url.https://example.org/.insteadOf", "e:"); r.g("config", "core.worktree", r.d);
    r.g("config", "extensions.partialclone", "origin"); r.g("config", "remote.origin.promisor", "true"); r.g("config", "core.fsmonitor", "false");
    const alle = namen(lauf(r.d, ["--alle"]));
    const einzeln = [];
    for (let i = 0; i < 30; i++) {
      const l = lauf(r.d);
      if (l.status === 0) break;
      const n = namen(l)[0];
      einzeln.push(n);
      r.g("config", "--unset-all", n);
    }
    assert.equal(lauf(r.d).status, 0, "nach dem Entfernen aller genannten Schlüssel ist der Vault frei");
    assert.deepEqual([...alle].sort(), [...einzeln].sort());
    assert.equal(new Set(alle).size, alle.length, "jeder Name nur einmal, auch bei mehreren Werten");
    assert.equal(alle.length, 7, "sieben verschiedene Schlüssel (credential.helper hat zwei Werte, zählt aber einmal)");
  } finally { r.weg(); }
});

test("--alle gibt nie einen Wert aus – auch nicht aus Schlüsseln mit Wert-ähnlichem Namen", () => {
  const r = repo();
  try {
    r.g("config", "credential.helper", `store --token ${GEHEIM}`);
    r.g("config", "http.extraheader", `Authorization: bearer ${GEHEIM}`);
    r.g("config", "user.email", `a;b@${GEHEIM}.example`);
    r.g("config", "branch.main.merge", `-${GEHEIM}`);
    const l = lauf(r.d, ["--alle"]);
    assert.equal(l.status, 1);
    assert.ok(!l.stdout.includes(GEHEIM) && !l.stderr.includes(GEHEIM), `Wert in der Ausgabe: ${l.stdout}`);
    assert.deepEqual(namen(l).sort(), ["branch.main.merge", "credential.helper", "http.extraheader", "user.email"]);
  } finally { r.weg(); }
});

test("--alle: lokale Remote-Adressen sind in der Produktion verboten, in der Testumgebung erlaubt (wie im Normalmodus)", () => {
  const r = repo();
  try {
    r.g("config", "remote.origin.url", "/irgendwo/ziel.git");
    r.g("config", "remote.zweit.url", "file:///irgendwo/ziel2.git");
    r.g("config", "remote.dritt.url", "https://example.org/v.git");
    assert.deepEqual(namen(lauf(r.d, ["--alle"])).sort(), ["remote.origin.url", "remote.zweit.url"]);
    assert.equal(lauf(r.d, ["--alle"], ENV_TEST).status, 0);
    assert.equal(lauf(r.d, [], ENV_TEST).status, 0);
  } finally { r.weg(); }
});

test("--alle: kein Repository / unlesbare Konfiguration → Meldung in Klammern, Exit 1 – wie im Normalmodus", () => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "git-liste-leer-")));
  try {
    mkdirSync(join(d, "x"));
    const a = lauf(join(d, "x"), ["--alle"]);
    const n = lauf(join(d, "x"));
    assert.equal(a.status, n.status);
    assert.equal(a.stdout, n.stdout);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("Falscher Aufruf: ohne git und Ordner Exit 2", () => {
  assert.equal(spawnSync("/usr/bin/perl", [PL, "--alle"], { env: ENV }).status, 2);
  assert.equal(spawnSync("/usr/bin/perl", [PL], { env: ENV }).status, 2);
});
