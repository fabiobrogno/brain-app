// Hüllen-Vertrag (Ressourcen/studio/huellen-vertrag.json): jede Aktion, die das Studio aufruft, steht im Vertrag; Vertrag und Swift (AppAktion.pruefe) nennen dieselben Namen;
// die Aktionen „nur bei offener Einrichtung“ sind genau die, die EinrichtungsOverlay.nurAusEinrichtung in Swift kennt.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const W = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const vertrag = JSON.parse(readFileSync(join(W, "Ressourcen/studio/huellen-vertrag.json"), "utf8"));
const namen = vertrag.aktionen.map((a) => a.name);

test("Vertrag: Namen eindeutig, jede Aktion mit Wert, Antwort und Zweck", () => {
  assert.equal(new Set(namen).size, namen.length);
  for (const a of vertrag.aktionen) { assert.ok("wert" in a && a.antwort && a.zweck, a.name); }
});

test("das Studio ruft nur Aktionen aus dem Vertrag auf", () => {
  const dir = join(W, "Ressourcen/studio");
  const fremd = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".js"))) {
    const text = readFileSync(join(dir, f), "utf8");
    for (const m of text.matchAll(/\baktion(?:MitAntwort)?\(\s*"([a-z-]+)"/g)) if (!namen.includes(m[1])) fremd.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(fremd, []);
});

test("Vertrag und Swift nennen dieselben Aktionen", () => {
  const swift = readFileSync(join(W, "Sources/BrainCore/AppAktion.swift"), "utf8");
  const inSwift = [...swift.matchAll(/^ {8}case "([a-z-]+)":/gm)].map((m) => m[1]).sort();
  assert.deepEqual(inSwift, [...namen].sort());
});

test("„nur bei offener Einrichtung“ stimmt mit Swift überein", () => {
  const swift = readFileSync(join(W, "Sources/BrainCore/EinrichtungsOverlay.swift"), "utf8");
  const zeile = /case \.gitPruefen[^\n]*return true/.exec(swift)?.[0] || "";
  const swiftNamen = { gitPruefen: "git-pruefen", gitInstallieren: "git-installieren", kopieren: "kopieren", einrichtungEnde: "einrichtung-ende", einrichtungSchritt: "einrichtung-schritt" };
  const ausSwift = Object.entries(swiftNamen).filter(([k]) => zeile.includes("." + k)).map(([, v]) => v).sort();
  const ausVertrag = vertrag.aktionen.filter((a) => a.nurBeiOffenerEinrichtung).map((a) => a.name).sort();
  assert.deepEqual(ausVertrag, ausSwift);
  assert.equal(ausSwift.length, 5);
});

test("Befehle der Hülle an das Studio sind im Studio vorhanden", () => {
  const app = readFileSync(join(W, "Ressourcen/studio/app.js"), "utf8");
  for (const b of vertrag.huellenBefehle) assert.ok(b.name === "hinweis" ? app.includes("window.studio.hinweis") : app.includes(`${b.name}: (arg)`), b.name);
});

test("Einrichtung (E2): die Sitzung bestätigt die Seite (immer erlaubt), die Schritte nennen dieselben Namen wie Swift", () => {
  const sitzung = vertrag.aktionen.find((a) => a.name === "einrichtung-sitzung");
  assert.ok(sitzung, "einrichtung-sitzung steht im Vertrag");
  assert.ok(!sitzung.nurBeiOffenerEinrichtung, "die Meldung selbst muss vor der Bestätigung gehen");
  const schritt = vertrag.aktionen.find((a) => a.name === "einrichtung-schritt");
  assert.equal(schritt?.nurBeiOffenerEinrichtung, true);
  const swift = readFileSync(join(W, "Sources/BrainCore/EinrichtungsZustand.swift"), "utf8");
  const faelle = /enum EinrichtungsSchritt[^{]*\{([\s\S]*?)\n\}/.exec(swift)?.[1] ?? "";
  const inSwift = [...faelle.matchAll(/^\s*case (\w+)\s*$/gm)].map((m) => m[1]);
  assert.deepEqual(inSwift, ["vault", "ki", "sicherung"]);
  for (const n of inSwift) assert.ok(schritt.wert.includes(`"${n}"`), `Vertrag nennt den Schritt ${n}`);
  // Das Studio ruft beide auf (Sitzung beim Öffnen/Schließen/Laden, Schritt nach jedem erledigten Schritt)
  const dir = join(W, "Ressourcen/studio");
  const text = readdirSync(dir).filter((n) => n.endsWith(".js")).map((n) => readFileSync(join(dir, n), "utf8")).join("\n");
  assert.match(text, /aktion(?:MitAntwort)?\(\s*"einrichtung-sitzung"/);
  assert.match(text, /aktion(?:MitAntwort)?\(\s*"einrichtung-schritt"/);
});
