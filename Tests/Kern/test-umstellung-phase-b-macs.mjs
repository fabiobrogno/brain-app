// test-umstellung-phase-b-macs.mjs — Paket P7d: der Zwei-Mac-Fall (Plan docs/plaene/p7-umstellung.md Abschnitt 6).
// Mac A (Fixture-Vault, Phase A durch) und Mac B (zweiter Klon über ein gemeinsames nacktes Repository, Kit-Stand mit Stummel-Hooks, ohne Gerätemerker). Lokale Remotes gibt es nur in der
// Testumgebung. Geprüft wird: Phase B auf A wird ohne Bestätigung verweigert und mit Bestätigung durchgeführt · ein Mac mit Merker, aber ohne Phase A sperrt das Tor · nach dem Abgleich fehlt
// .tools auf B und der Befund auf B meldet „auf anderem Mac umgestellt“ · der Revert auf A bringt .tools auf B zurück.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { umstellungsFixture } from "./umstellung-hilfe.mjs";
import { GEHEIM } from "./fixture-altvault.mjs";
import { phaseAFertig, tuerOffen, tor, bedingung, BEST, gitIn } from "./umstellung-hilfe-b.mjs";
import { phaseB } from "../umstellung/phase-b.mjs";
import { rueckweg } from "../umstellung/rueckweg.mjs";
import { erstelleBefund } from "../umstellung/befund.mjs";

const git = (...a) => { const r = spawnSync("/usr/bin/git", a, { encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" } }); if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`); return r.stdout.trim(); };

test("Zwei Macs: Bestätigung ist Pflicht · ein Mac ohne Phase A sperrt · nach Phase B fehlt .tools auf B · der Revert auf A repariert B", async () => {
  const h = umstellungsFixture(["kit-versioniert", "hookspath-relativ", "hooks-alt-sh", "mcp-claude-alt", "plist-alt-dieser", "altfelder", "remote-lokal-pfad"]);
  try {
    // das gemeinsame nackte Repository (lokaler Remote, nur in der Testumgebung erlaubt)
    const bare = join(h.a.extern, "ziel.git");
    git("init", "-q", "--bare", "-b", "main", bare);
    await phaseAFertig(h);
    gitIn(h.a.vault, "push", "-q", "origin", "main");
    // Mac B: zweiter Klon mit Kit-Stand (.tools versioniert, relativer core.hooksPath, Stummel-Hook) – keine Umstellung, kein Gerätemerker von B
    const b = join(h.a.basis, "mac-b");
    git("clone", "-q", bare, b);
    git("-C", b, "config", "core.hooksPath", ".tools/git-hooks");
    assert.ok(existsSync(join(b, ".tools", "git-hooks", "pre-commit")), "B hat den Kit-Stummel-Hook");
    assert.ok(existsSync(join(b, ".kortex", "geraete")), "B kennt den Merker von A (kam mit dem Abgleich)");
    await tuerOffen(h);

    // 1) ohne Bestätigung: Tor zu, Phase B verweigert, nichts verändert
    assert.deepEqual(tor(h, {}).offen, ["bestaetigung"]);
    const kopf = gitIn(h.a.vault, "rev-parse", "HEAD");
    await assert.rejects(phaseB(h.z(), { bestaetigt: true, entscheidungen: {} }), (e) => e.code === "tor-zu" && /anderen Mac/.test(e.message));
    assert.ok(existsSync(join(h.a.vault, ".tools", "VERSION")));
    assert.equal(gitIn(h.a.vault, "rev-parse", "HEAD"), kopf);

    // 2) ein Mac im Vault mit Merker, aber ohne Phase A (z. B. Kortex dort neu installiert, Umstellung nicht beendet): das Tor bleibt zu, auch mit Bestätigung
    h.a.schreibe(join(h.a.vault, ".kortex", "geraete", "bbbbbbbbbbbb.json"), JSON.stringify({ name: `Mac-${GEHEIM}`, kortexVersion: "0.5.1" }));
    assert.equal(bedingung(tor(h), "macs").grund, "geraet-ohne-phase-a");
    await assert.rejects(phaseB(h.z(), { bestaetigt: true, entscheidungen: BEST }), (e) => e.code === "tor-zu");
    rmSync(join(h.a.vault, ".kortex", "geraete", "bbbbbbbbbbbb.json"));
    await tuerOffen(h);                                             // der Stand hat sich geändert: Probelauf erneut

    // 3) mit Bestätigung: durchgeführt
    const r = await phaseB(h.z(), { bestaetigt: true, entscheidungen: BEST });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.phaseB, "fertig");
    gitIn(h.a.vault, "push", "-q", "origin", "main");

    // 4) Mac B zieht: .tools verschwindet, der Hook-Pfad zeigt ins Leere (genau das Risiko, das das Tor verhindern soll), der Befund auf B sagt „auf anderem Mac aufgeräumt“
    assert.ok(existsSync(join(b, ".tools", "git-hooks", "pre-commit")));
    git("-C", b, "pull", "-q", "--ff-only");
    assert.ok(!existsSync(join(b, ".tools")), ".tools ist auf B verschwunden");
    assert.equal(git("-C", b, "config", "--local", "core.hooksPath"), ".tools/git-hooks", "B zeigt jetzt ins Leere");
    const befundB = erstelleBefund({ vault: b, home: h.a.home, support: join(h.a.basis, "support-b"), claudeHomes: [] });
    const anderer = befundB.funde.find((f) => f.kategorie === "anderer-mac");
    assert.ok(anderer, "Befund auf B: auf anderem Mac umgestellt");
    assert.equal(anderer.details.aufgeraeumt, 1);
    assert.match(anderer.text, /aufgeräumt/);
    assert.ok(!JSON.stringify(befundB).includes(GEHEIM));

    // 5) der Revert auf A bringt .tools auf B zurück
    const rw = await rueckweg(h.z(), { bestaetigt: true, schritte: ["B3", "B2", "B1"] });
    assert.equal(rw.ok, true, JSON.stringify(rw));
    gitIn(h.a.vault, "push", "-q", "origin", "main");
    git("-C", b, "pull", "-q", "--ff-only");
    assert.ok(existsSync(join(b, ".tools", "git-hooks", "pre-commit")), "der Revert hat .tools auf B zurückgebracht");
    assert.equal(readFileSync(join(b, ".tools", "VERSION"), "utf8"), readFileSync(join(h.a.vault, ".tools", "VERSION"), "utf8"));
  } finally { h.weg(); }
});
