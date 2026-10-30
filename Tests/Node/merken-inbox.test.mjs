// Schnell merken schreibt in den konfigurierten Posteingang (brain.config.json → ordner.inbox), nicht fest nach 00_inbox; und das Studio kennt den
// Hinweis der Hintergrund-Sicherung („Konflikt – im Studio lösen“) aus dem Support-Ordner.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, pfad, repo } from "./hilfe.mjs";

const { oeffneVault } = await import(pfad("gemeinsam", "vault.mjs"));
const { merkerDatei, leseAbgleichStand, loescheAbgleichStand } = await import(pfad("gemeinsam", "sicherungsmerker.mjs"));

const vault = (config) => {
  const d = tmp();
  schreibe(d, "00_inbox/alt.md", "# Alt\n");
  if (config !== undefined) schreibe(d, "brain.config.json", typeof config === "string" ? config : JSON.stringify(config));
  return { d, v: oeffneVault(d, { heute: "2026-10-30" }) };
};

test("ohne Konfiguration: 00_inbox (wie bisher)", () => {
  const { d, v } = vault();
  const r = v.merken({ text: "Idee", titel: "Meine Idee" });
  assert.equal(r.pfad, "00_inbox/2026-10-30_meine-idee.md");
  assert.equal(readFileSync(join(d, r.pfad), "utf8"), "# Meine Idee\n\nIdee\n");
});

test("ordner.inbox in der Konfiguration: Schnell merken legt dort an (auch ein neuer Ordner), 00_inbox bleibt unberührt", () => {
  const { d, v } = vault({ ordner: { inbox: "Eingang" } });
  const r = v.merken({ text: "Aufgabe vom Handy", titel: "Lieferant anrufen" });
  assert.equal(r.pfad, "Eingang/2026-10-30_lieferant-anrufen.md");
  assert.equal(readFileSync(join(d, r.pfad), "utf8"), "# Lieferant anrufen\n\nAufgabe vom Handy\n");
  assert.equal(v.merken({ text: "Nochmal", titel: "Lieferant anrufen" }).pfad, "Eingang/2026-10-30_lieferant-anrufen-2.md");
  assert.equal(existsSync(join(d, "00_inbox", "2026-10-30_lieferant-anrufen.md")), false);
  // Umlaute und Bindestriche im Ordnernamen sind erlaubt (wie im Kern)
  const u = vault({ ordner: { inbox: "Posteingang-Büro" } });
  assert.equal(u.v.merken({ text: "x", titel: "T" }).pfad, "Posteingang-Büro/2026-10-30_t.md");
});

test("ungültige oder gefährliche Angaben fallen auf 00_inbox zurück: Pfad, versteckt, Wiki, Archiv, kein Text, kaputte Datei", () => {
  const schlecht = [
    { ordner: { inbox: "../draussen" } }, { ordner: { inbox: "a/b" } }, { ordner: { inbox: "/etc" } }, { ordner: { inbox: ".git" } }, { ordner: { inbox: ".." } },
    { ordner: { inbox: "09_wiki" } }, { ordner: { inbox: "09_WIKI" } }, { ordner: { inbox: "90_archiv" } }, { ordner: { inbox: "node_modules" } },
    { ordner: { inbox: "Wissen", wiki: "wissen" } }, { ordner: { inbox: 5 } }, { ordner: { inbox: "" } }, { ordner: {} }, { ordner: null }, [], "kein json {",
  ];
  for (const c of schlecht) {
    const { d, v } = vault(c);
    const r = v.merken({ text: "x", titel: "T" });
    assert.equal(r.pfad, "00_inbox/2026-10-30_t.md", JSON.stringify(c));
    assert.ok(existsSync(join(d, r.pfad)));
  }
});

test("ein Verweis als Konfigurationsdatei wird nicht gelesen", async () => {
  const { symlinkSync } = await import("node:fs");
  const d = tmp();
  const ziel = tmp();
  schreibe(ziel, "c.json", JSON.stringify({ ordner: { inbox: "Fremd" } }));
  symlinkSync(join(ziel, "c.json"), join(d, "brain.config.json"));
  const v = oeffneVault(d, { heute: "2026-10-30" });
  assert.equal(v.merken({ text: "x", titel: "T" }).pfad, "00_inbox/2026-10-30_t.md");
});

test("Studio-Status: sicherungStand kommt aus dem Support-Ordner; ein erfolgreicher Abgleich löscht ihn, die Bestätigung des Ziels bleibt", async () => {
  const support = tmp("brain-support-merken-");
  const d = repo();
  const v = oeffneVault(d, { support });
  assert.equal((await v.gitStatus()).sicherungStand, null);
  mkdirSync(join(support, "backup"), { recursive: true });
  writeFileSync(merkerDatei(d, support), JSON.stringify({ remoteBestaetigt: "https://example.org/u/r.git", abgleich: { stand: "konflikt", zeit: "2026-10-30T10:00:00.000Z" } }) + "\n");
  assert.equal(leseAbgleichStand(d, support), "konflikt");
  assert.equal((await v.gitStatus()).sicherungStand, "konflikt");
  // unbekannter Stand wird ignoriert
  writeFileSync(merkerDatei(d, support), JSON.stringify({ abgleich: { stand: "boese" } }) + "\n");
  assert.equal(leseAbgleichStand(d, support), null);
  writeFileSync(merkerDatei(d, support), JSON.stringify({ remoteBestaetigt: "https://example.org/u/r.git", abgleich: { stand: "konflikt" } }) + "\n");
  assert.equal(loescheAbgleichStand(d, { support }), true);
  assert.deepEqual(JSON.parse(readFileSync(merkerDatei(d, support), "utf8")), { remoteBestaetigt: "https://example.org/u/r.git" });
  assert.equal(loescheAbgleichStand(d, { support }), false, "nichts mehr zu löschen");
  assert.equal((await v.gitStatus()).sicherungStand, null);
});

test("ein erfolgreicher Abgleich im Studio (gitSync) löscht den Vermerk der Hintergrund-Sicherung; nachsehen liefert ihn mit", async () => {
  const { g } = await import("./hilfe.mjs");
  const support = tmp("brain-support-sync-");
  const bare = tmp("brain-bare-sync-");
  g(bare, "init", "-q", "--bare", "-b", "main");
  const d = repo();
  g(d, "remote", "add", "origin", bare);
  g(d, "push", "-q", "-u", "origin", "main");
  const v = oeffneVault(d, { support });
  mkdirSync(join(support, "backup"), { recursive: true });
  writeFileSync(merkerDatei(d, support), JSON.stringify({ remoteBestaetigt: bare, abgleich: { stand: "konflikt" } }) + "\n");
  assert.equal((await v.gitNachsehen()).sicherungStand, "konflikt");
  const r = await v.gitSync({});
  assert.equal(r.ergebnis, "aktuell");
  assert.equal(leseAbgleichStand(d, support), null);
  assert.equal((await v.gitStatus()).sicherungStand, null);
  assert.equal(JSON.parse(readFileSync(merkerDatei(d, support), "utf8")).remoteBestaetigt, bare);
});
