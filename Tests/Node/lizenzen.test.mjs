// Lizenzen: THIRD-PARTY-NOTICES.md nennt jeden ausgelieferten Fremdbestandteil (jede Datei unter vendor/ der Oberfläche und der 3D-Ansicht,
// jedes Marken-Logo, Node und Sparkle in der Version, die wirklich gebaut wird), der App-Bau legt die Datei ins Paket, und die Oberfläche
// „Lizenzen …“ kann sie lesen. Liegt ein gebautes Paket unter build/Kortex.app, wird auch das geprüft (der Rauchtest tut es in der CI immer).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";

const W = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const lies = (...t) => readFileSync(join(W, ...t), "utf8");
const NOTICES = lies("THIRD-PARTY-NOTICES.md");

function alleDateien(ordner) {
  const r = [];
  const geh = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) geh(p); else r.push(p); } };
  geh(join(W, ordner));
  return r;
}

test("jede Datei unter vendor/ (Studio und 3D-Ansicht) ist in den Hinweisen genannt", () => {
  const dateien = [...alleDateien("Ressourcen/studio/vendor"), ...alleDateien("Ressourcen/kern/ansicht/vendor")];
  assert.ok(dateien.length >= 50, `zu wenige Vendor-Dateien gefunden (${dateien.length}) — Suchpfad prüfen`);
  const fehlt = dateien.filter((d) => basename(d) !== "DRITTANBIETER.md" && !NOTICES.includes(basename(d))).map((d) => relative(W, d));
  assert.deepEqual(fehlt, [], `Diese Vendor-Dateien fehlen in THIRD-PARTY-NOTICES.md: ${fehlt.join(", ")}`);
});

test("jedes Marken-Logo und die Herkunftsdateien unter Ressourcen/logos sind genannt", () => {
  const fehlt = alleDateien("Ressourcen/logos").map((d) => basename(d)).filter((n) => !NOTICES.includes(n));
  assert.deepEqual(fehlt, [], `Diese Logo-Dateien fehlen in THIRD-PARTY-NOTICES.md: ${fehlt.join(", ")}`);
});

test("Node.js und Sparkle stehen mit der Version, die gebaut wird", () => {
  const node = lies("scripts", "node-version.txt").trim();
  assert.match(node, /^v\d+\.\d+\.\d+$/);
  assert.ok(NOTICES.includes(node), `Node ${node} (scripts/node-version.txt) fehlt in THIRD-PARTY-NOTICES.md`);
  const sparkle = /exact:\s*"([\d.]+)"/.exec(lies("Package.swift"))?.[1];
  assert.ok(sparkle, "Sparkle-Version in Package.swift nicht gefunden");
  assert.ok(NOTICES.includes(`Sparkle ${sparkle}`), `Sparkle ${sparkle} (Package.swift) fehlt in THIRD-PARTY-NOTICES.md`);
  assert.match(NOTICES, /bsdiff/, "Sparkle-Lizenztext (mit den Lizenzen der Quelldateien) fehlt");
});

test("Lizenztexte stehen im Wortlaut: MIT (three.js), SIL OFL 1.1 (Geist), Sparkle, CC0 und Markenhinweis", () => {
  for (const muster of [/The MIT License/, /SIL OPEN FONT LICENSE Version 1\.1/, /Andy Matuschak/, /CC0 1\.0/, /mit keinem dieser\s+Unternehmen verbunden/]) {
    assert.match(NOTICES, muster, `Hinweise ohne ${muster}`);
  }
});

test("keine privaten Pfade oder Namen in den Hinweisen", () => {
  assert.doesNotMatch(NOTICES, /\/Users\/|fbFirma|brogno-group|\.claude/);
});

test("der App-Bau legt die Hinweise ins Paket (Resources/ und neben die Oberfläche) und bricht sonst ab", () => {
  const bau = lies("scripts", "baue-app.sh");
  assert.match(bau, /cp THIRD-PARTY-NOTICES\.md "\$NEU\/Contents\/Resources\/THIRD-PARTY-NOTICES\.md"/);
  assert.match(bau, /cp THIRD-PARTY-NOTICES\.md "\$NEU\/Contents\/Resources\/studio\/THIRD-PARTY-NOTICES\.md"/);
  assert.match(bau, /cp LICENSE "\$NEU\/Contents\/Resources\/LICENSE"/);
  assert.match(bau, /Resources\/studio\/THIRD-PARTY-NOTICES\.md Resources\/LICENSE Resources\/node-runtime\/LICENSE/, "Endkontrolle im Paket fehlt");
});

test("gebautes Paket (falls vorhanden) enthält die Hinweise zweimal, unverändert, samt Node-Lizenz", { skip: !existsSync(join(W, "build/Kortex.app/Contents/Resources")) }, () => {
  const res = join(W, "build/Kortex.app/Contents/Resources");
  assert.equal(readFileSync(join(res, "THIRD-PARTY-NOTICES.md"), "utf8"), NOTICES);
  assert.equal(readFileSync(join(res, "studio", "THIRD-PARTY-NOTICES.md"), "utf8"), NOTICES);
  assert.ok(statSync(join(res, "node-runtime", "LICENSE")).size > 1000);
});

test("Oberfläche: Menüpunkt „Lizenzen …“ verdrahtet, Zerlegung des Textes liefert Überschriften, Tabellen und Lizenzblöcke", async () => {
  const app = lies("Ressourcen", "studio", "app.js");
  assert.match(app, /id: "lizenzen", tun: oeffneLizenzen/);
  const { zerlegeLizenzText, LIZENZ_DATEI } = await import(join(W, "Ressourcen", "studio", "lizenzen.js"));
  assert.equal(LIZENZ_DATEI, "THIRD-PARTY-NOTICES.md");
  const b = zerlegeLizenzText(NOTICES);
  assert.equal(b[0].art, "h");
  assert.ok(b.some((x) => x.art === "h" && x.text.startsWith("Sparkle")));
  assert.ok(b.some((x) => x.art === "code" && x.text.includes("| Bestandteil |")), "Tabelle fehlt");
  assert.ok(b.some((x) => x.art === "code" && x.text.includes("Andy Matuschak")), "Sparkle-Lizenz fehlt als Block");
  const roh = zerlegeLizenzText("# A\n\nein\nAbsatz\n\n```\nx\n  y\n```\n");
  assert.deepEqual(roh, [{ art: "h", stufe: 1, text: "A" }, { art: "p", text: "ein Absatz" }, { art: "code", text: "x\n  y" }]);
});
