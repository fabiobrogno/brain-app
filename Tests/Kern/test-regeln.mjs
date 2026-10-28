// K2 Regeln am Read: passende Lektionen („Gilt für") wörtlich als additionalContext (nur JSON), am besten passende
// zuerst, ganze Regeln im Budget, je Sitzung einmal; Steckbrief beim ersten Read je Repo; nie mit Zugangsdaten.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { leseLektionen, musterZuRegex, regelnFuer, REGEL_BUDGET } from "../regeln.mjs";
import { merkeGezeigt } from "../gezeigt.mjs";
import { tempOrdner, tempVault, hook, TEMP_HOME } from "./verlauf-fixture.mjs";

// Secret-Köder dynamisch gebaut (kein Klartext-Muster im Quelltext, sonst schlägt der Publish-Check an).
const KOEDER = ["tok", "en"].join("") + "=abcdefgh12345678";
const LEKTIONEN = "﻿# Lektionen\r\n\r\nKurze Regeln.\r\n\r\n"
  + "- **Swift bauen** — Swift-Dateien nur mit `xcrun swift build` bauen.\r\n  Warum: zweimal falscher Compiler. · Wie: vor jedem Build.\r\n  Gilt für: `*.swift`\r\n\r\n"
  + "- **Brain-App** — In der Brain-App nie direkt auf main arbeiten.\r\n  Gilt für: `~/source/brain-app/**`, `**/Package.swift`\r\n\r\n"
  + "- **Ohne Muster** — Gilt nie beim Lesen.\r\n\r\n"
  + `- **Geheim** — Nutze ${KOEDER} beim Build.\r\n  Gilt für: \`*.swift\`\r\n\r\n`
  + "- **Kit-Tests** — Kit-Tests immer über run-all.sh.\r\n  Gilt für: `.tools/**/*.mjs`\r\n";
function vaultMitLektionen(name = "Mein Brän") {
  const v = tempVault(name);
  writeFileSync(join(v, "09_wiki", "_lektionen.md"), LEKTIONEN);
  return v;
}
const lesen = (v, sid, datei, extra = {}) => hook("regeln-lesen.mjs",
  { session_id: sid, hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: datei }, cwd: v, ...extra }, { vault: v });
const kontext = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : "");

test("leseLektionen: nur Einträge mit „Gilt für“, Regeltext ohne die Muster-Zeile, BOM/CRLF egal", () => {
  const l = leseLektionen(vaultMitLektionen());
  assert.deepEqual(l.map((x) => x.muster), [["*.swift"], ["~/source/brain-app/**", "**/Package.swift"], ["*.swift"], [".tools/**/*.mjs"]]);
  assert.equal(l[0].text, "- **Swift bauen** — Swift-Dateien nur mit `xcrun swift build` bauen.\n  Warum: zweimal falscher Compiler. · Wie: vor jedem Build.");
  assert.match(l[0].id, /^[0-9a-f]{12}$/);
  assert.equal(new Set(l.map((x) => x.id)).size, 4);
  assert.deepEqual(leseLektionen(tempVault()), [], "ohne _lektionen.md leer");
});

test("musterZuRegex: *, **, ?, ~/ und Sonderzeichen", () => {
  const passt = (m, p) => musterZuRegex(m, "/h").test(p);
  assert.equal(passt("*.swift", "/a/b/App.swift"), true);
  assert.equal(passt("*.swift", "/a/b/App.swiftx"), false);
  assert.equal(passt("~/source/brain-app/**", "/h/source/brain-app/Sources/A.swift"), true);
  assert.equal(passt("~/source/brain-app/**", "/h/source/andere/A.swift"), false);
  assert.equal(passt("~/source/brain-app/**", "/x/h/source/brain-app/a"), false, "absolut = ab Wurzel");
  assert.equal(passt("src/**/test.js", "/r/src/test.js"), true);
  assert.equal(passt("src/**/test.js", "/r/src/a/b/test.js"), true);
  assert.equal(passt("src/**/test.js", "/r/src/xtest.js"), false);
  assert.equal(passt(".tools/**/*.mjs", "/v/.tools/tests/b.mjs"), true);
  assert.equal(passt(".tools/**/*.mjs", "/v/tools/a.mjs"), false);
  assert.equal(passt("Notiz (1)?.md", "/a/Notiz (1)a.md"), true);
});

test("regelnFuer: spezifischste zuerst, Zugangsdaten nie, gezeigte nicht noch einmal, Budget in ganzen Regeln", () => {
  const v = vaultMitLektionen();
  const datei = "/h/source/brain-app/Sources/App.swift";
  const r = regelnFuer(v, datei, { home: "/h" });
  assert.match(r.text, /^Brain-Regeln für diese Datei \(wörtlich aus 09_wiki\/_lektionen\.md\):\n- \*\*Brain-App\*\*.*\n- \*\*Swift bauen\*\*/);
  assert.doesNotMatch(r.text, /abcdefgh12345678|Ohne Muster|Kit-Tests/);
  assert.equal(r.ids.length, 2);
  assert.ok(r.text.length <= REGEL_BUDGET);
  const knapp = regelnFuer(v, datei, { home: "/h", max: 200 });
  assert.ok(knapp.text.length <= 200, String(knapp.text.length));
  assert.match(knapp.text, /Brain-App/);
  assert.doesNotMatch(knapp.text, /Swift bauen|\(gekürzt\)/);
  assert.match(knapp.text, /\(1 weitere passende Regel in 09_wiki\/_lektionen\.md\)$/);
  const ohneErste = regelnFuer(v, datei, { home: "/h", gezeigt: new Set([`regel:${r.ids[0]}`]) });
  assert.deepEqual(ohneErste.ids, [r.ids[1]]);
  assert.deepEqual(regelnFuer(v, "/h/notiz.txt", { home: "/h" }), { text: "", ids: [] });
});

test("regeln-lesen: nur JSON additionalContext, je Sitzung einmal, andere Sitzung bekommt die Regeln wieder", () => {
  const v = vaultMitLektionen();
  const datei = join(TEMP_HOME, "source", "brain-app", "Sources", "App.swift");
  const a = lesen(v, "s1", datei);
  assert.equal(a.status, 0);
  assert.equal(JSON.parse(a.stdout).hookSpecificOutput.hookEventName, "PreToolUse");
  assert.match(kontext(a), /^Brain-Regeln für diese Datei/);
  assert.match(kontext(a), /Brain-App[\s\S]*Swift bauen/);
  assert.doesNotMatch(a.stdout, /abcdefgh12345678/);
  assert.equal(lesen(v, "s1", datei).stdout, "", "Dedupe je Sitzung");
  assert.match(kontext(lesen(v, "s2", datei)), /Swift bauen/);
});

test("regeln-lesen: Datei außerhalb jeder Regel, anderes Werkzeug, ohne session_id, kaputtes stdin → still, Exit 0", () => {
  const v = vaultMitLektionen();
  for (const r of [
    lesen(v, "s1", "/irgendwo/notiz.txt"),
    lesen(v, "s1", join(TEMP_HOME, "a.swift"), { tool_name: "Edit" }),
    lesen(v, "", join(TEMP_HOME, "a.swift")),
    hook("regeln-lesen.mjs", "kaputt", { vault: v }),
    lesen(tempVault(), "s1", join(TEMP_HOME, "a.swift")),
  ]) {
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  }
});

test("regeln-lesen: Steckbrief beim ersten Read im Repo (projektAutomatik), nicht wenn der Start ihn schon zeigte, nicht bei Schalter aus", () => {
  const v = tempVault("Mein Brän");
  mkdirSync(join(v, "09_wiki", "projekte"), { recursive: true });
  const seite = "09_wiki/projekte/entitaet_garten-app.md";
  writeFileSync(join(v, seite), '---\nname: garten-app\ndescription: x\ntyp: entitaet\nrepo: jo/garten-app\npruefen: ["node --test"]\n---\n# Garten-App\n');
  const repo = join(tempOrdner("Arbeit Ü"), "garten-app");
  mkdirSync(join(repo, ".git"), { recursive: true });
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "garten-app", version: "0.3.0" }));
  const a = lesen(v, "s1", join(repo, "src", "a.js"));
  assert.match(kontext(a), /^Projekt-Steckbrief .*\n- Prüfen: `node --test`\n- Stack laut package\.json: garten-app 0\.3\.0/);
  assert.equal(lesen(v, "s1", join(repo, "src", "b.js")).stdout, "", "nur beim ersten Read je Repo");
  merkeGezeigt(v, "s2", `steckbrief:${seite}`);
  assert.equal(lesen(v, "s2", join(repo, "a.js")).stdout, "", "Sitzungsstart hat ihn schon gezeigt");
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ automatik: { projektAutomatik: false } }));
  assert.equal(lesen(v, "s3", join(repo, "a.js")).stdout, "");
  // Schalter aus: für s3 darf nichts gemerkt worden sein (Datei gar nicht angelegt). Ersetzt die ungeankerte Regex-Prüfung
  // auf s1.txt, die zufällig Temp-Pfade traf (Ruling P3).
  assert.equal(existsSync(join(v, ".logs", "gezeigt", "s3.txt")), false);
});
