// Eine Zeitzone für alles: die des Macs (gemeinsam/zeit.mjs). Früher rechnete die Werkstatt in Berliner Zeit (Dateinamen im Posteingang, Fälligkeiten,
// „heute“ im Index, Verlauf nach Tagen, Sicherungsnamen), das Studio in Ortszeit — außerhalb der MEZ und rund um Mitternacht widersprachen sich Datei und Anzeige.
// Hier laufen dieselben Abläufe mit Zeitzonen-Varianten (TZ je Fall gesetzt); Berlin kommt nur als eingespritzte Zone der Tests vor (hilfe.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmp, schreibe, g, pfad } from "./hilfe.mjs";

const { heuteIso, stempel, plusTageIso, wochentagIso, zeitzone } = await import(pfad("gemeinsam", "zeit.mjs"));
const { oeffneVault } = await import(pfad("gemeinsam", "vault.mjs"));
const { sicherungFuer } = await import(pfad("gemeinsam", "sicherung.mjs"));
const gitFn = await import(pfad("gemeinsam", "git.mjs"));
const { heuteLokal } = await import(pfad("kern", "aufgaben.mjs"));

// 23:30 UTC am 30.10.2026 (Berlin: schon 31.10. 00:30; Los Angeles: 30.10. 16:30; Tokio: 31.10. 08:30)
const SPAET = new Date("2026-10-30T23:30:00Z");
const ZONEN = [["Europe/Berlin", "2026-10-31"], ["UTC", "2026-10-30"], ["America/Los_Angeles", "2026-10-30"], ["Asia/Tokyo", "2026-10-31"], ["Pacific/Auckland", "2026-10-31"]];

// TZ nur für die Dauer von fn ändern
async function inZone(zone, fn) {
  const alt = process.env.TZ;
  process.env.TZ = zone;
  try { return await fn(); } finally { if (alt === undefined) delete process.env.TZ; else process.env.TZ = alt; }
}

test("heuteIso: ohne Angabe die Zeitzone des Prozesses (TZ), mit Angabe die eingespritzte", async () => {
  for (const [zone, soll] of ZONEN) {
    assert.equal(await inZone(zone, () => heuteIso(SPAET)), soll, `TZ=${zone}`);
    assert.equal(heuteIso(SPAET, zone), soll, `zone=${zone}`);
  }
  assert.equal(await inZone("America/Los_Angeles", () => heuteIso(SPAET, "Europe/Berlin")), "2026-10-31", "die eingespritzte Zone schlägt TZ");
  assert.equal(heuteIso(SPAET, "Gibt/Es/Nicht"), heuteIso(SPAET), "unbekannte Zone: Zone des Prozesses");
  assert.equal(await inZone("Asia/Tokyo", () => zeitzone()), "Asia/Tokyo");
});

test("heuteIso: Zeitumstellung (Ende der Sommerzeit 25.10.2026, Beginn 29.03.2026)", () => {
  assert.equal(heuteIso(new Date("2026-10-24T21:59:59Z"), "Europe/Berlin"), "2026-10-24");
  assert.equal(heuteIso(new Date("2026-10-24T22:00:00Z"), "Europe/Berlin"), "2026-10-25");
  assert.equal(heuteIso(new Date("2026-10-25T22:59:59Z"), "Europe/Berlin"), "2026-10-25", "der 25. hat 25 Stunden");
  assert.equal(heuteIso(new Date("2026-10-25T23:00:00Z"), "Europe/Berlin"), "2026-10-26");
  assert.equal(heuteIso(new Date("2026-03-28T22:59:59Z"), "Europe/Berlin"), "2026-03-28");
  assert.equal(heuteIso(new Date("2026-03-28T23:00:00Z"), "Europe/Berlin"), "2026-03-29");
});

test("stempel, plusTageIso, wochentagIso", () => {
  assert.equal(stempel(new Date("2026-10-24T21:15:02Z"), "Europe/Berlin"), "20261024-231502", "Sommerzeit");
  assert.equal(stempel(new Date("2026-12-01T10:00:00Z"), "Europe/Berlin"), "20261201-110000", "Winterzeit");
  assert.equal(stempel(new Date("2026-12-01T10:00:00Z"), "UTC"), "20261201-100000");
  assert.equal(plusTageIso("2026-10-30", 1), "2026-10-31");
  assert.equal(plusTageIso("2026-10-30", 3), "2026-11-02");
  assert.equal(plusTageIso("2026-12-31", 1), "2027-01-01");
  assert.equal(plusTageIso("2028-02-28", 1), "2028-02-29");
  assert.equal(plusTageIso("2026-03-28", 1), "2026-03-29", "Sommerzeit-Tag: reine Kalenderrechnung");
  assert.equal(plusTageIso("kaputt", 1), null);
  assert.equal(wochentagIso("2026-10-30"), 5);
  assert.equal(wochentagIso("2026-11-01"), 0);
  assert.equal(wochentagIso("x"), null);
});

test("Werkstatt: Dateiname im Posteingang („Schnell merken“) folgt der Zeitzone des Macs", async () => {
  for (const [zone, tag] of ZONEN) {
    const d = tmp("brain-zeit-");
    const v = oeffneVault(d, { jetzt: () => SPAET });
    const pfadNeu = await inZone(zone, () => v.merken({ text: "Erste Idee", titel: "Idee" }).pfad);
    assert.equal(pfadNeu, `00_inbox/${tag}_idee.md`, `TZ=${zone}`);
  }
});

test("Werkstatt: „heute“ im Index (abgelaufen/überfällig) und im Datum der Aufgabe richten sich nach der Zeitzone", async () => {
  // Eine Seite, die am 30.10.2026 abläuft: in Los Angeles (noch der 30.) ist sie nicht abgelaufen, in Berlin (schon der 31.) schon
  const d = tmp("brain-zeit-i-");
  schreibe(d, "09_wiki/seite.md", "---\npruefen_bis: 2026-10-30\n---\n# Seite\n\nText\n");
  const ablauf = async (zone) => inZone(zone, async () => { const v = oeffneVault(d, { jetzt: () => SPAET }); const z = (await v.notizen()).notizen.find((n) => n.pfad === "09_wiki/seite.md"); return z.ansichten.includes("abgelaufen"); });
  assert.equal(await ablauf("America/Los_Angeles"), false);
  assert.equal(await ablauf("Europe/Berlin"), true);
  // Aufgabe: Dateiname und „heute“ der Zähler
  assert.equal(await inZone("America/Los_Angeles", () => heuteLokal(SPAET)), "2026-10-30");
  assert.equal(await inZone("Europe/Berlin", () => heuteLokal(SPAET)), "2026-10-31");
  assert.equal(heuteLokal(SPAET, "Asia/Tokyo"), "2026-10-31");
  const w = tmp("brain-zeit-a-"); schreibe(w, "brain.config.json", "{}\n");
  const v = oeffneVault(w, { jetzt: () => SPAET });
  const los = await inZone("America/Los_Angeles", () => v.aufgabeAnlegen({ titel: "Zeitzonen-Test", faellig: "2026-10-30" }));
  assert.ok(los.pfad.includes("2026-10-30-zeitzonen-test"), los.pfad);
  assert.equal((await inZone("America/Los_Angeles", () => v.aufgaben())).zaehler.ueberfaellig, 0, "in Los Angeles ist der 30. noch heute");
  assert.equal((await inZone("Europe/Berlin", () => v.aufgaben())).zaehler.ueberfaellig, 1, "in Berlin ist der 30. schon gestern");
});

test("Werkstatt: Verlauf nach Tagen gruppiert in Ortszeit, Beschriftung ebenfalls", async () => {
  process.env.HOME = tmp("brain-home-"); process.env.GIT_CONFIG_NOSYSTEM = "1"; // keine echte ~/.gitconfig
  const d = tmp("brain-zeit-g-");
  g(d, "init", "-q", "-b", "main");
  schreibe(d, "a.md", "# A\n");
  g(d, "add", "--", "a.md");
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (k.startsWith("GIT_") && k !== "GIT_CONFIG_NOSYSTEM") delete e[k];
  Object.assign(e, { GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.org", GIT_AUTHOR_DATE: "2026-10-30T23:30:00Z", GIT_COMMITTER_DATE: "2026-10-30T23:30:00Z" });
  execFileSync("git", ["commit", "-q", "-m", "spaet"], { cwd: d, env: e });
  const tag = (zone) => inZone(zone, async () => (await gitFn.log(d)).tage[0]);
  const berlin = await tag("Europe/Berlin"), la = await tag("America/Los_Angeles");
  assert.equal(berlin.datum, "2026-10-31"); assert.match(berlin.beschriftung, /31\. Oktober 2026/);
  assert.equal(la.datum, "2026-10-30"); assert.match(la.beschriftung, /30\. Oktober 2026/);
});

test("Sicherungsname einer defekten Datei in Ortszeit", async () => {
  for (const [zone, erwartet] of [["Europe/Berlin", "20261031-003000"], ["UTC", "20261030-233000"], ["America/Los_Angeles", "20261030-163000"]]) {
    const d = tmp("brain-zeit-s-"); schreibe(d, "vaults.json", "kaputt");
    const name = await inZone(zone, () => sicherungFuer("vaults.json").sichere(d, join(d, "vaults.json"), { jetzt: SPAET.getTime() }));
    assert.equal(name, `vaults.json.defekt-${erwartet}`, zone);
    assert.deepEqual(readdirSync(d).sort(), ["vaults.json", name].sort());
  }
});

test("Kein fester Ort im Programmcode: die Zeitzone „Europe/Berlin“ steht nur in zeit.mjs-Kommentaren und in Tests", () => {
  const fund = [];
  const lies = (rel) => readFileSync(pfad(...rel.split("/")), "utf8");
  for (const rel of ["gemeinsam/pruefung.mjs", "gemeinsam/vault.mjs", "gemeinsam/notizen.mjs", "gemeinsam/git.mjs", "gemeinsam/sicherung.mjs", "gemeinsam/vorlage.mjs", "gemeinsam/vaults.mjs", "gemeinsam/aufgaben-vault.mjs",
    "kern/aufgaben.mjs", "studio/app.js", "studio/aufgaben.js", "studio/posteingang.js", "studio/verlauf.js", "mcp/aufgaben-werkzeuge.mjs"]) {
    for (const z of lies(rel).split("\n")) if (/timeZone\s*:\s*["']Europe\/Berlin["']/.test(z)) fund.push(`${rel}: ${z.trim().slice(0, 80)}`);
  }
  assert.deepEqual(fund, []);
});
