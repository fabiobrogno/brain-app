// Die Härtung der git-Aufrufe des Kerns (Ressourcen/kern/git-sicher, ein Shell-Skript im Kern-Bündel) darf nicht hinter der der Werkstatt
// (gemeinsam/git.mjs: GRUND/OHNE_HOOKS/OHNE_SIGNIEREN; gemeinsam/vertrauen.mjs: GEFAEHRLICH) zurückbleiben. Der Kern kann die Module der
// Werkstatt nicht importieren (er liegt im Bündel/Support-Ordner neben, nicht unter `gemeinsam`), darum ist die Härtung dort nachgebaut —
// dieser Test hält beide gleich.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmp, g, repo, pfad } from "./hilfe.mjs";

const { HAERTUNG } = await import(pfad("gemeinsam", "git.mjs"));
const { GEFAEHRLICH_MUSTER, gefaehrlicheSchluessel, liesGitKonfiguration } = await import(pfad("gemeinsam", "vertrauen.mjs"));
const SICHER = pfad("kern", "git-sicher");
const text = readFileSync(SICHER, "utf8");

test("git-sicher ist ausführbar und nennt jede -c-Einstellung der Werkstatt (außer der reinen Ausgabeform core.quotepath)", () => {
  assert.ok(statSync(SICHER).mode & 0o111, "git-sicher muss ausführbar sein (sonst kann der Kern kein git starten)");
  const paare = (liste) => { const o = []; for (let i = 0; i < liste.length; i += 2) { assert.equal(liste[i], "-c"); o.push(liste[i + 1]); } return o; };
  const alle = [...paare(HAERTUNG.GRUND), ...paare(HAERTUNG.OHNE_HOOKS), ...paare(HAERTUNG.OHNE_SIGNIEREN(null))].filter((p) => !p.startsWith("core.quotepath="));
  assert.ok(alle.length >= 10);
  for (const p of alle) {
    const [k, w] = [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)];
    if (k === "core.hooksPath") { assert.match(text, /HOOKS=\/dev\/null/); assert.match(text, /-c "core\.hooksPath=\$HOOKS"/); continue; }
    assert.ok(text.includes(`-c ${k}=${w}`), `git-sicher setzt ${k}=${w} nicht`);
  }
});

// Konkrete Schlüssel zu jedem Muster der Werkstatt-Liste: Werkstatt UND Kern müssen sie als gefährlich sehen
const BEISPIELE = ["credential.helper", "credential.https://example.org.helper", "core.askpass", "core.gitproxy", "core.alternaterefscommand", "gpg.program", "gpg.x509.program",
  "gpg.ssh.defaultKeyCommand", "gpg.ssh.program", "merge.x.driver", "filter.x.clean", "filter.x.smudge", "filter.x.process", "remote.o.uploadpack", "remote.o.receivepack", "remote.o.vcs"];

test("jedes Muster der Werkstatt-Liste ist durch mindestens ein Beispiel abgedeckt, und git-sicher verweigert alle Beispiele", () => {
  for (const re of GEFAEHRLICH_MUSTER) assert.ok(BEISPIELE.some((k) => re.test(k.toLowerCase())), `kein Beispiel für ${re}`);
  for (const k of BEISPIELE) {
    const d = repo();
    const evil = join(tmp("brain-evil-"), "evil.sh"); writeFileSync(evil, "#!/bin/sh\nexit 1\n"); chmodSync(evil, 0o755);
    g(d, "config", k, evil);
    const werkstatt = gefaehrlicheSchluessel(liesGitKonfiguration(d, { frisch: true }).eintraege);
    assert.equal(werkstatt.length, 1, `Werkstatt sieht ${k} nicht als gefährlich`);
    // bei JEDEM Befehl (auch lesenden): ein Partial Clone lädt beim Lesen nach und startet dann Netz-Programme
    for (const sub of [["status", "--porcelain"], ["cat-file", "-t", "HEAD"], ["fetch", "--quiet"]]) {
      const r = spawnSync(SICHER, ["-C", d, ...sub], { encoding: "utf8" });
      assert.equal(r.status, 126, `git-sicher lässt ${k} bei ${sub[0]} durch: ${r.stderr}`);
    }
  }
});

// Die Werkstatt fährt eine Sperrliste (GEFAEHRLICH) und fragt bei Treffern nach Vertrauen; der Kern kennt keine Vertrauensfrage und fährt deshalb
// eine ERLAUBNISLISTE (git-sicher-pruefung.pl, fail-closed): strenger und nicht umgehbar. Sicherungsnetz: nichts, was die Werkstatt als
// gefährlich kennt, darf auf der Erlaubnisliste des Kerns stehen.
test("die Erlaubnisliste des Kerns enthält keinen Schlüssel, den die Werkstatt als gefährlich kennt", () => {
  const pl = readFileSync(pfad("kern", "git-sicher-pruefung.pl"), "utf8");
  const schluessel = [...pl.matchAll(/^\s*"([a-z.*-]+)"\s*=>/gm)].map((m) => m[1]);
  assert.ok(schluessel.length >= 30, `zu wenige Schlüssel gelesen: ${schluessel.length}`);
  for (const k of schluessel) {
    const beispiel = k.replaceAll("*", "x");
    for (const re of GEFAEHRLICH_MUSTER) assert.ok(!re.test(beispiel), `${k} steht auf der Erlaubnisliste, ist aber gefährlich (${re})`);
  }
  assert.ok(!schluessel.some((k) => /^(http|credential|filter|diff|url|include|submodule|man|help|core\.(fsmonitor|worktree|sshcommand|editor|pager|askpass|gitproxy|attributesfile))/.test(k)), "unerwarteter Abschnitt auf der Erlaubnisliste");
});
