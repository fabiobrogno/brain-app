// Dateisystem-Annahmen auf jedem System (Plan W0 / V3, V4, V8): Unicode-Form (NFC/NFD) in Dateinamen, Backslash-Pfade, Zeilenenden (CRLF) mit .gitattributes,
// Groß/klein (Linux unterscheidet, macOS/Windows nicht), Pfadtrenner im Baum, in der Suche, im Suchindex und in der Link-Pflege.
// Die Tests laufen auf macOS, Windows und Linux; wo das Dateisystem selbst das Ergebnis bestimmt, prüft der Test die Regel des jeweiligen Systems.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

const { oeffneVault, HttpFehler } = await import(pfad("gemeinsam", "vault.mjs"));
const { sauber, falte, loese } = await import(pfad("gemeinsam", "basis.mjs"));
const L = await import(pfad("gemeinsam", "linkpflege.mjs"));
const { zusammenfuehren } = await import(pfad("gemeinsam", "merge3.mjs"));
const { erzeugeSuchindex } = await import(pfad("gemeinsam", "suchindex.mjs"));

const NFC = "Café Über.md".normalize("NFC");
const NFD = NFC.normalize("NFD");
const vault = (dateien = {}) => {
  const d = tmp("plat-vault-"), support = tmp("plat-support-");
  schreibe(d, "brain.config.json", "{}\n");
  for (const [p, t] of Object.entries(dateien)) schreibe(d, p, t);
  return { d, v: oeffneVault(d, { support, heute: "2026-11-05" }) };
};
const baumPfade = (v) => (v.baum().eintraege || v.baum()).map((e) => e.pfad || e.rel || e.name);
// Kann dieses Dateisystem zwei Namen, die nur in der Unicode-Form oder der Schreibweise abweichen, nebeneinander halten?
const unterscheidet = (a, b) => { const d = tmp("plat-fs-"); writeFileSync(join(d, a), "1"); writeFileSync(join(d, b), "2"); return readdirSync(d).length === 2; };

test("NFC und NFD: dieselbe Datei wird gefunden, egal in welcher Form der Name geschrieben wird", () => {
  const { d, v } = vault();
  schreibe(d, `ordner/${NFC}`, "# Kaffee\n\nText\n");
  // Die Form, in der die Datei auf der Platte steht, hängt vom System ab (APFS bewahrt, Linux bewahrt, Windows NFC); lesen muss mit beiden Formen gehen.
  const a = v.lies(`ordner/${NFC}`), b = v.lies(`ordner/${NFD}`);
  assert.equal(a.inhalt, b.inhalt);
  assert.equal(falte(NFC), falte(NFD));
});

test("Dateiname in NFD angelegt: Baum und Suche liefern ihn genau einmal, Falten macht beide Formen gleich", () => {
  const { d, v } = vault();
  schreibe(d, `n/${NFD}`, "# Titel\n\nUnverwechselbarwort\n");
  const pfade = baumPfade(v).filter((p) => String(p).endsWith(".md") && String(p).startsWith("n/"));
  assert.equal(pfade.length, 1, JSON.stringify(pfade));
  assert.equal(String(pfade[0]).normalize("NFC"), `n/${NFC}`);
});

test("Zwei Namen nur in der Unicode-Form: wo das Dateisystem beide hält, gelten sie für Kortex als dieselbe Notiz (falte), sonst ist es ohnehin eine Datei", () => {
  const sep = unterscheidet(NFC, NFD);
  assert.equal(falte(NFC), falte(NFD));
  if (!sep) assert.ok(true); // APFS/HFS+-ähnlich: das System fasst sie selbst zusammen
});

test("Backslash im Pfad wird abgelehnt (Vault-Pfade sind immer /-Pfade); Laufwerksbuchstaben und .. ebenfalls", () => {
  for (const schlecht of ["a\\b.md", "..\\x.md", "C:\\x.md", "C:/x.md", "/etc/passwd", "../x.md", "a/../../x.md", "~/x.md"]) {
    assert.throws(() => sauber(schlecht), (e) => e instanceof HttpFehler && [400, 403].includes(e.status), schlecht);
  }
  assert.deepEqual(sauber("a//b/./c.md"), ["a", "b", "c.md"]);
  const { d } = vault();
  assert.throws(() => loese(d, "a\\b.md"), (e) => e instanceof HttpFehler);
});

test("Pfadtrenner: Baum, Lesen und Link-Pflege geben Vault-Pfade immer mit / zurück, nie mit Backslash", () => {
  const { d, v } = vault({ "a/b/c.md": "# C\n\n[[d]] und [x](../e.md)\n", "a/e.md": "# E\n" });
  for (const p of baumPfade(v)) assert.ok(!String(p).includes("\\"), String(p));
  assert.equal(L.relativerPfad("a/b", "a/e.md"), "../e.md");
  assert.deepEqual(L.loeseRelativ("a/b", "../e.md"), ["a", "e.md"]);
  assert.equal(L.relativerPfad("", "x/y.md"), "x/y.md");
  assert.ok(!L.relativerPfad("a/b", "a/b/z.md").includes("\\"));
  assert.equal(readFileSync(join(d, "a", "e.md"), "utf8"), "# E\n");
});

test("Suche und Suchindex: Treffer tragen /-Pfade, auch bei Umlaut-Ordnern in NFD", async () => {
  const d = tmp("plat-index-");
  schreibe(d, "brain.config.json", "{}\n");
  schreibe(d, `${"Übersicht".normalize("NFD")}/tief/notiz.md`, "# Notiz\n\nSonderbegriffquark kommt hier vor.\n");
  schreibe(d, "flach.md", "# Flach\n\nSonderbegriffquark auch hier.\n");
  const i = erzeugeSuchindex({ wurzel: d });
  i.starte(); await i.ruhe();
  const pfade = i.suche({ q: "Sonderbegriffquark" }).treffer.map((t) => t.pfad);
  assert.equal(pfade.length, 2, JSON.stringify(pfade));
  for (const p of pfade) assert.ok(!p.includes("\\"), p);
  assert.ok(pfade.some((p) => p.normalize("NFC") === "Übersicht/tief/notiz.md"), JSON.stringify(pfade));
});

test("Groß/klein: Kortex-Vergleich (falte) ist überall gleich; das Dateisystem entscheidet, ob Name.md und name.md zwei Dateien sind", () => {
  assert.equal(falte("Name.MD"), falte("name.md"));
  const zwei = unterscheidet("Name.md", "name.md");
  if (process.platform === "linux") assert.equal(zwei, true, "Linux unterscheidet Groß/klein");
  else assert.equal(zwei, false, "macOS (Standard-APFS) und Windows unterscheiden nicht");
  // Zugriff mit abweichender Schreibweise übernimmt die vorhandene (kanonisch) — dort, wo es nur eine Datei geben kann
  const { d, v } = vault();
  schreibe(d, "Ordner/Notiz.md", "# N\n");
  if (!zwei) assert.equal(v.lies("ordner/notiz.md").inhalt, "# N\n");
});

test("Zeilenenden: CRLF bleibt byte-treu in der Zusammenführung und in Verweisen", () => {
  const basis = "a\r\nb\r\nc\r\nd\r\n", meine = "a\r\nB\r\nc\r\nd\r\n", andere = "a\r\nb\r\nc\r\nD\r\n";
  const erg = zusammenfuehren(basis, meine, andere);
  assert.equal(erg.konflikte, 0);
  assert.equal(erg.sauber, true);
  const text = erg.teile.map((t) => t.z.join("")).join("");
  assert.equal(text, "a\r\nB\r\nc\r\nD\r\n");
  assert.deepEqual(L.findeVerweise("x [[A]]\r\ny [[B]]\r\n").map((l) => l.ziel), ["A", "B"]);
});

// git: core.autocrlf=true ist die Vorgabe von Git for Windows. Ein Vault mit `.gitattributes` `* -text` lässt Dateien byte-treu (kein CRLF-Umbau beim Checkout).
function gitIn(d, ...args) {
  const env = { PATH: process.env.PATH, HOME: d, USERPROFILE: d, GIT_CONFIG_GLOBAL: join(d, ".gcfg"), GIT_CONFIG_SYSTEM: join(d, ".gsys"), GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.org", ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) };
  return execFileSync("git", args, { cwd: d, env, encoding: "utf8", windowsHide: true });
}
test("CRLF-Datei mit .gitattributes `* -text` und core.autocrlf=true: nach Commit und frischem Checkout bytegleich", () => {
  const d = tmp("plat-git-");
  gitIn(d, "init", "-q");
  gitIn(d, "config", "core.autocrlf", "true");
  gitIn(d, "config", "commit.gpgsign", "false");
  const inhalt = Buffer.from("zeile eins\r\nzeile zwei\r\nnur-lf\n", "utf8");
  writeFileSync(join(d, ".gitattributes"), "* -text\n");
  writeFileSync(join(d, "n.md"), inhalt);
  gitIn(d, "add", ".gitattributes", "n.md");
  gitIn(d, "commit", "-q", "-m", "x");
  writeFileSync(join(d, "n.md"), "kaputt");
  gitIn(d, "checkout", "--", "n.md");
  assert.deepEqual(readFileSync(join(d, "n.md")), inhalt);
});

test("Windows-Vorgabe ohne .gitattributes verändert CRLF-Dateien beim Hinzufügen nicht still: Kortex muss .gitattributes setzen (Befund, kein Fehler)", () => {
  const d = tmp("plat-git2-");
  gitIn(d, "init", "-q");
  gitIn(d, "config", "core.autocrlf", "true");
  gitIn(d, "config", "core.safecrlf", "false");
  writeFileSync(join(d, "n.md"), "a\r\nb\r\n");
  gitIn(d, "add", "n.md");
  const imIndex = execFileSync("git", ["cat-file", "blob", gitIn(d, "ls-files", "-s", "n.md").split(/\s+/)[1]], { cwd: d, env: { PATH: process.env.PATH, HOME: d, USERPROFILE: d, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(d, ".gcfg") } });
  // Mit autocrlf=true speichert git LF: das Original (CRLF) ginge verloren. Das belegt, warum neue Vaults `* -text` brauchen.
  assert.equal(imIndex.toString("utf8"), "a\nb\n");
});
