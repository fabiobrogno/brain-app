// KI-Konten: womit starten neu erkannte Konten? Der Hinweis „Neu gefunden und noch nicht eingetragen … Sie starten gesperrt“ darf nichts behaupten, was der Abgleich nicht tut.
// Die Werkstatt meldet je neuem Konto `startet` ("gesperrt" | "teils"), gerechnet mit derselben Rechnung wie der Abgleich (rechne) und derselben Stufenregel (stufeFuer);
// die Oberfläche macht aus `teils` den ehrlichen Text. Hier: Übereinstimmung mit dem, was der Abgleich danach wirklich einträgt, und der Text. Nur Wegwerf-Orte im Temp-Ordner.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "CURSOR_CONFIG_DIR", "GEMINI_CLI_HOME", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL"]) delete process.env[k];
process.env.HOME = tmp("brain-home-");

const K = await import(pfad("gemeinsam", "ki-konten.mjs"));
const { erzeugeKonten } = await import(pfad("werkstatt", "konten.mjs"));
const { erkenneKonten } = await import(pfad("werkstatt", "konten-erkennung.mjs"));
const { TE } = await import(pfad("studio", "texte-einrichtung.js"));
const { TK } = await import(pfad("studio", "texte-konten.js"));

const neuesVault = () => { const d = tmp("brain-vault-"); schreibe(d, "brain.config.json", "{}\n"); schreibe(d, "00_inbox/n.md", "# N\n"); return realpathSync(d); };
const HOOKS = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "[ -x '/x/bin/kortex' ] && exec '/x/bin/kortex' hook session-start || exit 0" }] }] } });
const profil = (home, name, verbunden) => { const p = join(home, `.claude-${name}`); mkdirSync(p, { recursive: true }); writeFileSync(join(p, "settings.json"), verbunden ? HOOKS : "{}\n"); return realpathSync(p); };
const erzeuge = (home, support, vaults, quelle) => erzeugeKonten({ support, home: () => home, vaults: () => vaults.map((p) => ({ pfad: p, name: p.split("/").pop() })),
  erkennung: () => erkenneKonten({ home, programme: [] }), quelleVon: () => quelle });
const startetVon = (stand, ordner) => stand.neu.find((k) => k.ordner.endsWith(ordner))?.startet;

test("Das einzige verbundene Konto in einem von Kortex angelegten Vault startet NICHT gesperrt: `startet` ist „teils“ — und der Abgleich trägt genau das ein", () => {
  const home = tmp("brain-home-"), s = tmp("brain-support-"), v = neuesVault();
  profil(home, "alt", false);
  erzeuge(home, s, [v], "angelegt").synchronisiere(); // die Liste gibt es, ein nicht verbundenes Konto steht darin
  const neu = profil(home, "neu", true); // neu dazu, schon mit Kortex verbunden
  const k = erzeuge(home, s, [v], "angelegt");
  const stand = k.stand({ lesend: true });
  assert.equal(startetVon(stand, ".claude-neu"), "teils");
  k.abgleich();
  const d = K.liesKonten(s).daten, id = Object.keys(d.konten).find((x) => d.konten[x].ordner === neu);
  assert.equal(K.stufeFuer(d, v, id), "posteingang", "so startet es wirklich");
});

test("Derselbe Fall in einem Vault, den der Nutzer selbst geöffnet hat: gesperrt — Hinweis und Abgleich stimmen überein", () => {
  const home = tmp("brain-home-"), s = tmp("brain-support-"), v = neuesVault();
  profil(home, "alt", false);
  erzeuge(home, s, [v], "bestaetigt").synchronisiere();
  const neu = profil(home, "neu", true);
  const k = erzeuge(home, s, [v], "bestaetigt");
  assert.equal(startetVon(k.stand({ lesend: true }), ".claude-neu"), "gesperrt");
  k.abgleich();
  const d = K.liesKonten(s).daten, id = Object.keys(d.konten).find((x) => d.konten[x].ordner === neu);
  assert.equal(K.stufeFuer(d, v, id), "gesperrt");
});

test("Ein nicht verbundenes neues Konto startet gesperrt; sind es mehrere verbundene, gilt die Ausnahme nicht", () => {
  const home = tmp("brain-home-"), s = tmp("brain-support-"), v = neuesVault();
  profil(home, "alt", false);
  erzeuge(home, s, [v], "angelegt").synchronisiere();
  profil(home, "leer", false);
  let k = erzeuge(home, s, [v], "angelegt");
  assert.equal(startetVon(k.stand({ lesend: true }), ".claude-leer"), "gesperrt", "nicht verbunden");
  profil(home, "eins", true); profil(home, "zwei", true);
  k = erzeuge(home, s, [v], "angelegt");
  const stand = k.stand({ lesend: true });
  assert.equal(startetVon(stand, ".claude-eins"), "gesperrt", "zwei verbundene Konten: keines ist „das einzige“");
  assert.equal(startetVon(stand, ".claude-zwei"), "gesperrt");
  k.abgleich();
  const d = K.liesKonten(s).daten;
  for (const id of Object.keys(d.konten)) assert.equal(K.stufeFuer(d, v, id), "gesperrt");
});

test("Ohne Liste (erster Start, Übernahme): ein schon verbundenes Konto behält seine Rechte (teils), ein anderes startet gesperrt; defekte Liste: alles gesperrt", () => {
  const home = tmp("brain-home-"), s = tmp("brain-support-"), v = neuesVault();
  const a = profil(home, "verbunden", true); profil(home, "frei", false);
  const k = erzeuge(home, s, [v], "bestaetigt");
  const stand = k.stand({ lesend: true });
  assert.equal(stand.zustand, "fehlt");
  assert.equal(startetVon(stand, ".claude-verbunden"), "teils");
  assert.equal(startetVon(stand, ".claude-frei"), "gesperrt");
  k.abgleich();
  const d = K.liesKonten(s).daten, id = Object.keys(d.konten).find((x) => d.konten[x].ordner === a);
  assert.equal(K.stufeFuer(d, v, id), "posteingang");
  // defekt: die Liste wird streng neu angelegt, alles gesperrt
  const h2 = tmp("brain-home-"), s2 = tmp("brain-support-");
  profil(h2, "verbunden", true);
  writeFileSync(K.kontenPfad(s2), "{kaputt");
  const k2 = erzeuge(h2, s2, [v], "bestaetigt");
  const st2 = k2.stand({ lesend: true });
  assert.notEqual(st2.zustand, "ok");
  assert.equal(startetVon(st2, ".claude-verbunden"), "gesperrt");
});

test("Der Text sagt die Wahrheit: nur bei `startet: teils` steht die Ausnahme da, sonst „Sie starten gesperrt.“ ohne Einschränkung", () => {
  assert.match(TE.ki.neuKonten("X"), /Sie starten gesperrt\.$/);
  assert.ok(!/Posteingang/.test(TE.ki.neuKonten("X", false)));
  assert.match(TE.ki.neuKonten("X", true), /Sie starten gesperrt, außer .*Posteingang.*einzige verbundene Konto.*angelegt oder geklont/);
  assert.match(TK.neu.text("X"), /starten sie gesperrt\.$/);
  assert.ok(!/Posteingang/.test(TK.neu.text("X", false)));
  assert.match(TK.neu.text("X", true), /gesperrt, außer .*Posteingang.*einzige verbundene Konto.*angelegt oder geklont/);
});
