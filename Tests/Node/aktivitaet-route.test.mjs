// Werkstatt-Routen des Aktivitätsprotokolls (P8a): GET /api/aktivitaet (seit, art, limit, vault=alle, nur=ungelesen), POST …/gelesen, POST …/rueckgaengig (nur unverändert,
// git-sicher mit ausgeschalteten Hooks, sonst Papierkorb) und das Ereignis „aktivitaet“ auf dem Live-Strom (/api/ereignisse). Nur Wegwerf-Ordner.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { tmp, schreibe, repo, g, pfad, echt } from "./hilfe.mjs";

const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const A = await import(pfad("gemeinsam", "aktivitaet.mjs"));
const K = await import(pfad("gemeinsam", "ki-konten.mjs"));

const sha = (s) => createHash("sha256").update(s).digest("hex");
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
const aufruf = (h) => async (methode, p, daten) => {
  const [pf, q] = p.split("?");
  const r = await h({ methode, pfad: pf, query: q || null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
  return { status: r.status, j };
};
function aufbau({ git = false, ereignisse = {} } = {}) {
  const support = tmp("akt-r-support-");
  const d = git ? repo("akt-r-repo-") : tmp("akt-r-vault-");
  schreibe(d, "brain.config.json", "{}\n"); schreibe(d, "00_inbox/.gitkeep", ""); schreibe(d, "05_aufgaben/.gitkeep", "");
  if (git) { g(d, "add", "--", "."); g(d, "commit", "-q", "-m", "Grundstand"); }
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "Haupt", pfad: d, farbe: "#5B8DEF" }], aktiv: d }));
  const h = erzeugeHandler({ vault: d, vaultOptionen: { support }, ereignisse: { aktivitaetPollMs: 40, modus: "poll", pollMs: 80, entprellMs: 40, ...ereignisse } });
  const rufe = aufruf(h);
  const ev = (e) => A.schreibeEreignis(support, d, e);
  // eine KI-Ablage: Datei da + Ereignis mit Hash
  const ablage = (rel, inhalt, extra = {}) => {
    schreibe(d, rel, inhalt);
    return ev({ art: rel.startsWith("05_") ? "ablage-aufgabe" : "ablage-notiz", konto: null, wer: "Claude Code", text: "hat etwas abgelegt.", pfade: [rel], rueckgaengig: { art: "ablage-entfernen", pfad: rel, hash: sha(inhalt) }, ...extra });
  };
  return { support, d, h, rufe, ev, ablage, kennung: A.kennungVault(d) };
}

test("GET /api/aktivitaet: neueste zuerst, ungelesen, Filter art (Alias abweisungen), seit, limit, Fehler bei falschen Angaben", async () => {
  const { rufe, ev, d } = aufbau();
  assert.deepEqual((await rufe("GET", "/api/aktivitaet")).j, { vault: { name: d.split("/").pop(), pfad: d, kennung: A.kennungVault(d) }, ereignisse: [], ungelesen: 0, gesamt: 0 });
  const z = (s) => new Date(Date.UTC(2026, 9, 31, 8, 0, s)).toISOString();
  ev({ art: "ablage-aufgabe", wer: "Claude Code", text: "hat eine Aufgabe angelegt.", zeit: z(1), pfade: ["05_aufgaben/a.md"], rueckgaengig: { art: "ablage-entfernen", pfad: "05_aufgaben/a.md", hash: "a".repeat(64) } });
  ev({ art: "abweisung", grund: "gesperrt", wer: "Codex", text: "wollte lesen.", zeit: z(2), programm: "codex" });
  ev({ art: "pflege", text: "Pflege fertig.", zeit: z(3) });
  const r = (await rufe("GET", "/api/aktivitaet")).j;
  assert.deepEqual(r.ereignisse.map((e) => e.art), ["pflege", "abweisung", "ablage-aufgabe"]);
  assert.equal(r.ungelesen, 3); assert.equal(r.gesamt, 3);
  const [pflege, abw, abl] = r.ereignisse;
  assert.equal(abl.rueckgaengigMoeglich, true); assert.equal(abl.rueckgaengig, undefined, "der Hash verlässt die Werkstatt nie"); assert.equal(abl.dk, undefined);
  assert.equal(abw.rueckgaengigMoeglich, false); assert.equal(abw.programmName, "Codex"); assert.equal(abw.gelesen, false); assert.equal(abw.vaultName, d.split("/").pop());
  assert.equal(pflege.zurueckgenommen, null);
  assert.deepEqual((await rufe("GET", "/api/aktivitaet?art=abweisungen")).j.ereignisse.map((e) => e.art), ["abweisung"]);
  assert.deepEqual((await rufe("GET", "/api/aktivitaet?art=pflege,ablage-aufgabe")).j.ereignisse.map((e) => e.art), ["pflege", "ablage-aufgabe"]);
  assert.deepEqual((await rufe("GET", `/api/aktivitaet?seit=${encodeURIComponent(z(1))}`)).j.ereignisse.map((e) => e.art), ["pflege", "abweisung"]);
  assert.equal((await rufe("GET", "/api/aktivitaet?limit=1")).j.ereignisse.length, 1);
  assert.equal((await rufe("GET", "/api/aktivitaet?limit=1")).j.gesamt, 3);
  assert.equal((await rufe("GET", "/api/aktivitaet?art=quatsch")).status, 400);
  assert.equal((await rufe("GET", "/api/aktivitaet?seit=gestern")).status, 400);
  assert.equal((await rufe("POST", "/api/aktivitaet", {})).status, 405);
});

test("vault=alle: Ereignisse aller Vaults der Liste, mit Vault-Name und -Pfad; Rückgängig nur im offenen Vault angeboten", async () => {
  const { rufe, ev, support, d } = aufbau();
  const zweiter = tmp("akt-r-zweiter-"); schreibe(zweiter, "brain.config.json", "{}\n");
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "Haupt", pfad: d }, { name: "Firma", pfad: zweiter }], aktiv: d }));
  ev({ art: "abweisung", grund: "gesperrt", wer: "Codex", text: "x", zeit: "2026-10-31T08:00:00.000Z" });
  A.schreibeEreignis(support, zweiter, { art: "ablage-notiz", text: "y", pfade: ["00_inbox/n.md"], rueckgaengig: { art: "ablage-entfernen", pfad: "00_inbox/n.md", hash: "b".repeat(64) }, zeit: "2026-10-31T09:00:00.000Z" });
  assert.equal((await rufe("GET", "/api/aktivitaet")).j.gesamt, 1);
  const r = (await rufe("GET", "/api/aktivitaet?vault=alle")).j;
  assert.deepEqual(r.ereignisse.map((e) => [e.vaultName, e.vaultPfad, e.rueckgaengigMoeglich]), [["Firma", zweiter, false], ["Haupt", d, false]]);
});

test("gelesen: einzelne Ids und „alle“; der Zähler sinkt, nur=ungelesen filtert, Fehler bei falscher Eingabe", async () => {
  const { rufe, ev } = aufbau();
  const a = ev({ art: "abweisung", text: "1", zeit: "2026-10-31T08:00:00.000Z" }), b = ev({ art: "abweisung", text: "2", zeit: "2026-10-31T08:01:00.000Z" }), c = ev({ art: "pflege", text: "3", zeit: "2026-10-31T08:02:00.000Z" });
  assert.equal((await rufe("GET", "/api/aktivitaet")).j.ungelesen, 3);
  assert.deepEqual((await rufe("POST", "/api/aktivitaet/gelesen", { ids: [a.id] })).j, { ok: true, ungelesen: 2 });
  assert.deepEqual((await rufe("GET", "/api/aktivitaet?nur=ungelesen")).j.ereignisse.map((e) => e.id), [c.id, b.id]);
  assert.equal((await rufe("GET", "/api/aktivitaet")).j.ereignisse.find((e) => e.id === a.id).gelesen, true);
  assert.deepEqual((await rufe("POST", "/api/aktivitaet/gelesen", { alle: true })).j, { ok: true, ungelesen: 0 });
  // ein später eingehendes Ereignis ist wieder ungelesen
  ev({ art: "pflege-fehler", text: "4" });
  assert.equal((await rufe("GET", "/api/aktivitaet")).j.ungelesen, 1);
  assert.equal((await rufe("POST", "/api/aktivitaet/gelesen", {})).status, 400);
  assert.equal((await rufe("POST", "/api/aktivitaet/gelesen", { ids: [1] })).status, 400);
  assert.equal((await rufe("POST", "/api/aktivitaet/gelesen", { alle: true, vault: "/gibt/es/nicht" })).status, 404);
  assert.deepEqual((await rufe("POST", "/api/aktivitaet/gelesen", { alle: true, vault: "alle" })).j, { ok: true, ungelesen: 0 });
});

test("Rückgängig ohne Git: unveränderte Ablage wird entfernt (Kopie im Papierkorb), zweiter Versuch → schon zurückgenommen; Liste und Bestätigung stimmen", async () => {
  const { rufe, ablage, d, support, kennung } = aufbau();
  const e = ablage("00_inbox/2026-10-31_notiz.md", "# Notiz\n\nVon der KI.\n");
  const r = await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: e.id });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j, { ok: true, art: "entfernt", pfad: "00_inbox/2026-10-31_notiz.md", commit: null, papierkorb: true });
  assert.equal(existsSync(join(d, "00_inbox/2026-10-31_notiz.md")), false);
  const korb = join(support, "aktivitaet", "papierkorb", kennung);
  assert.deepEqual(readdirSync(korb), [`${e.id}-2026-10-31_notiz.md`]);
  assert.equal(readFileSync(join(korb, `${e.id}-2026-10-31_notiz.md`), "utf8"), "# Notiz\n\nVon der KI.\n");
  const l = (await rufe("GET", "/api/aktivitaet")).j.ereignisse;
  assert.equal(l.find((x) => x.id === e.id).rueckgaengigMoeglich, false); assert.ok(l.find((x) => x.id === e.id).zurueckgenommen);
  assert.equal(l[0].art, "rueckgaengig");
  const nochmal = await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: e.id });
  assert.equal(nochmal.status, 409); assert.equal(nochmal.j.art, "schon-zurueck");
});

test("Rückgängig, wenn die Datei seit der Ablage GEÄNDERT wurde: Rückfrage statt Löschen (409 geaendert), Datei und Papierkorb unberührt", async () => {
  const { rufe, ablage, d, support, kennung } = aufbau();
  const e = ablage("05_aufgaben/2026-10-31-x.md", "---\ntyp: aufgabe\ntitel: X\n---\n");
  writeFileSync(join(d, "05_aufgaben/2026-10-31-x.md"), "---\ntyp: aufgabe\ntitel: X\n---\nvom Nutzer ergänzt\n");
  const r = await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: e.id });
  assert.equal(r.status, 409); assert.equal(r.j.art, "geaendert"); assert.match(r.j.fehler, /seit der Ablage geändert/);
  assert.match(readFileSync(join(d, "05_aufgaben/2026-10-31-x.md"), "utf8"), /vom Nutzer ergänzt/);
  assert.equal(existsSync(join(support, "aktivitaet", "papierkorb", kennung)), false);
  assert.equal((await rufe("GET", "/api/aktivitaet")).j.ereignisse.find((x) => x.id === e.id).rueckgaengigMoeglich, true, "bleibt möglich: der Nutzer entscheidet selbst");
});

test("Rückgängig: Datei schon weg → „schon-weg“; falsche Eingaben und nicht rückgängig-fähige Ereignisse; ein Pfad aus dem Protokoll kann nie aus dem Vault führen", async () => {
  const { rufe, ablage, ev, d } = aufbau();
  const e = ablage("00_inbox/weg.md", "# Weg\n");
  writeFileSync(join(d, "00_inbox", "weg.md"), "# Weg\n"); // noch da …
  await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: e.id });
  const e2 = ablage("00_inbox/weg2.md", "# Weg 2\n");
  (await import("node:fs")).rmSync(join(d, "00_inbox", "weg2.md"));
  const r = await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: e2.id });
  assert.deepEqual([r.status, r.j.art, r.j.papierkorb], [200, "schon-weg", false]);
  const p = ev({ art: "pflege", text: "x" });
  assert.equal((await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: p.id })).status, 400);
  assert.equal((await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: "a_nichtda_000000" })).status, 404);
  assert.equal((await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: "../../x" })).status, 400);
  assert.equal((await rufe("POST", "/api/aktivitaet/rueckgaengig", {})).status, 400);
  const boese = ev({ art: "ablage-notiz", text: "x", rueckgaengig: { art: "ablage-entfernen", pfad: "../ausserhalb.md", hash: "c".repeat(64) } });
  assert.equal(boese.rueckgaengig, undefined, "schon beim Schreiben verworfen");
  assert.equal((await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: boese.id })).status, 400);
});

test("Rückgängig mit Git: eine schon gesicherte (committete) Ablage wird entfernt und die Löschung OHNE Hooks committet — die Datei bleibt in der Geschichte", async () => {
  const { rufe, d, ev } = aufbau({ git: true });
  const rel = "00_inbox/2026-10-31_gesichert.md", inhalt = "# Gesichert\n";
  schreibe(d, rel, inhalt); g(d, "add", "--", rel); g(d, "commit", "-q", "-m", "Sicherung");
  const e = ev({ art: "ablage-notiz", text: "x", pfade: [rel], rueckgaengig: { art: "ablage-entfernen", pfad: rel, hash: sha(inhalt) } });
  // ein Hook, der jeden Commit ablehnen würde: mit ausgeschalteten Hooks läuft er nicht
  const hook = join(d, ".git", "hooks", "pre-commit");
  mkdirSync(join(d, ".git", "hooks"), { recursive: true }); writeFileSync(hook, "#!/bin/sh\necho abgelehnt >&2\nexit 1\n"); chmodSync(hook, 0o755);
  const vorher = g(d, "rev-parse", "HEAD").trim();
  const r = await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: e.id });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.art, "entfernt"); assert.equal(r.j.papierkorb, true, "auch eine versionierte Datei geht erst in den Papierkorb"); assert.match(r.j.commit, /^[0-9a-f]{40}$/);
  assert.equal(existsSync(join(d, rel)), false);
  assert.equal(g(d, "rev-parse", "HEAD~1").trim(), vorher);
  assert.match(g(d, "log", "-1", "--format=%s"), /^Rückgängig: Ablage einer KI entfernt/);
  assert.equal(g(d, "show", `${vorher}:${rel}`), inhalt, "die Datei steht weiter in der Geschichte");
  assert.equal(g(d, "status", "--porcelain").trim(), "");
});

test("Rückgängig mit Git, Datei noch NICHT committet: Kopie im Papierkorb, kein Commit", async () => {
  const { rufe, ablage, d, support, kennung } = aufbau({ git: true });
  const vorher = g(d, "rev-parse", "HEAD").trim();
  const e = ablage("00_inbox/2026-10-31_neu.md", "# Neu\n");
  const r = await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: e.id });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.deepEqual([r.j.art, r.j.papierkorb, r.j.commit], ["entfernt", true, null]);
  assert.equal(g(d, "rev-parse", "HEAD").trim(), vorher);
  assert.ok(existsSync(join(support, "aktivitaet", "papierkorb", kennung, `${e.id}-2026-10-31_neu.md`)));
});

test("Rückgängig in einem Vault, dem nicht vertraut wird: 409 nicht-vertraut, nichts wird gelöscht", async () => {
  const { rufe, ablage, d } = aufbau();
  const e = ablage("00_inbox/n.md", "# N\n");
  await echt(async () => {
    const r = await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: e.id });
    assert.equal(r.status, 409); assert.equal(r.j.art, "nicht-vertraut");
  });
  assert.ok(existsSync(join(d, "00_inbox/n.md")));
});

test("Live: ein neuer Eintrag im Protokoll (von einem anderen Prozess) kommt als Ereignis „aktivitaet“ auf dem Strom; Rückgängig und „gelesen“ melden „zustand“", async () => {
  const { rufe, ev, ablage, h } = aufbau();
  const stand = (await rufe("GET", "/api/ereignisse")).j;
  assert.equal(typeof stand.aktuell, "number");
  let aktuell = stand.aktuell;
  const hole = async (genuegt, frist = 6000) => {
    const alle = [], ende = Date.now() + frist;
    while (Date.now() < ende) {
      const r = (await rufe("GET", `/api/ereignisse?seit=${aktuell}&epoche=${stand.epoche}&warte=1`)).j;
      aktuell = r.aktuell; alle.push(...r.ereignisse.filter((x) => x.typ === "aktivitaet"));
      if (genuegt(alle)) break;
    }
    return alle;
  };
  await pause(150);
  const e = ev({ art: "abweisung", grund: "gesperrt", konto: null, programm: "codex", wer: "Codex", vaultName: "V", text: "wollte lesen.", pfade: undefined });
  let l = await hole((x) => x.length >= 1);
  assert.equal(l.length, 1);
  assert.deepEqual({ ...l[0], n: undefined, zeit: undefined }, { typ: "aktivitaet", id: e.id, art: "abweisung", grund: "gesperrt", konto: null, programm: "codex", wer: "Codex", text: "wollte lesen.", rueckgaengig: false, vaultName: "V", n: undefined, zeit: undefined });
  const a = ablage("00_inbox/live.md", "# Live\n");
  l = await hole((x) => x.some((y) => y.id === a.id));
  assert.equal(l.find((y) => y.id === a.id).rueckgaengig, true);
  await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: a.id });
  l = await hole((x) => x.some((y) => y.art === "zustand"));
  assert.ok(l.some((y) => y.art === "zustand"), "nach Rückgängig: Listen neu laden");
  await rufe("POST", "/api/aktivitaet/gelesen", { alle: true });
  l = await hole((x) => x.some((y) => y.art === "zustand"), 3000);
  assert.ok(l.some((y) => y.art === "zustand"));
  h.ereignisse.beende();
});

test("Anmeldung abgelaufen: /api/ki/anmeldung meldet „nicht angemeldet“ für ein Konto, das früher angemeldet war → ein Ereignis (gedrosselt)", async () => {
  const { rufe, support, d, ev } = aufbau();
  const profil = tmp("akt-r-profil-");
  K.aendere(support, () => ({ version: 1, konten: { k_aaaaaaaa: { programm: "claude", ordner: profil, standard: false, name: "Firma", ordnerKennung: K.kennungVon(profil) } },
    vaults: { [d]: { ordnerKennung: K.kennungVon(d), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: "erweitert" } } } }));
  assert.equal((await rufe("POST", "/api/ki/anmeldung", { konto: "k_aaaaaaaa", zustand: "nicht-angemeldet" })).j.zustand, "nicht-angemeldet", "nie angemeldet: kein Ablauf");
  assert.equal((await rufe("GET", "/api/aktivitaet")).j.gesamt, 0);
  await rufe("POST", "/api/ki/anmeldung", { konto: "k_aaaaaaaa", zustand: "angemeldet" });
  assert.equal((await rufe("POST", "/api/ki/anmeldung", { konto: "k_aaaaaaaa", zustand: "nicht-angemeldet" })).j.zustand, "abgelaufen");
  await rufe("POST", "/api/ki/anmeldung", { konto: "k_aaaaaaaa", zustand: "nicht-angemeldet" });
  const l = (await rufe("GET", "/api/aktivitaet")).j.ereignisse;
  assert.equal(l.length, 1);
  assert.deepEqual([l[0].art, l[0].konto, l[0].wer, l[0].kontoName, l[0].programmName], ["anmeldung-abgelaufen", "k_aaaaaaaa", "Claude Code · Firma", "Firma", "Claude Code"]);
  assert.match(l[0].text, /muss sich neu anmelden/);
  void ev;
});

// ───────────────────────────── Härtung (Review P8a): ein Eintrag im Protokoll ist ein Hinweis, nie eine Berechtigung ─────────────────────────────
const rohZeile = (support, d, e) => { // am Schreiber vorbei: so könnte ein Programm mit Zugriff auf den Support-Ordner einen Eintrag fälschen
  const datei = A.ereignisDatei(support, A.kennungVault(d));
  mkdirSync(join(support, "aktivitaet"), { recursive: true });
  writeFileSync(datei, `${existsSync(datei) ? readFileSync(datei, "utf8") : ""}${JSON.stringify({ v: 1, zeit: new Date().toISOString(), konto: null, programm: null, text: "x", ...e })}\n`);
};

test("K1: ein gefälschter Eintrag kann keine Datei außerhalb der Ablage-Ordner löschen (Wiki, anderer Ordner, falscher Pfad, falsche Art, Unterordner, keine .md)", async () => {
  const { rufe, d, support, kennung } = aufbau();
  const inhalt = "# Wichtig\n";
  const faelle = [
    ["ablage-notiz", "09_wiki/wichtig.md", "Wiki"],
    ["ablage-notiz", "10_notizen/meins.md", "anderer Ordner"],
    ["ablage-aufgabe", "00_inbox/n.md", "Aufgabe, die im Posteingang liegt"],
    ["ablage-notiz", "05_aufgaben/a.md", "Notiz, die bei den Aufgaben liegt"],
    ["ablage-notiz", "00_inbox/unter/n.md", "Unterordner"],
    ["ablage-notiz", "00_inbox/n.txt", "keine .md"],
    ["abweisung", "00_inbox/n.md", "falsche Art"],
  ];
  let n = 0;
  for (const [art, rel, was] of faelle) {
    schreibe(d, rel, inhalt);
    n++;
    const eid = `a_forg${n}x_abcde${n}`;
    rohZeile(support, d, { id: eid, art, pfade: [rel], rueckgaengig: { art: "ablage-entfernen", pfad: rel, hash: sha(inhalt) } });
    const r = await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: eid });
    assert.ok([400, 409].includes(r.status), `${was}: ${r.status} ${JSON.stringify(r.j)}`);
    assert.ok(existsSync(join(d, rel)), `${was}: die Datei bleibt`);
  }
  assert.equal(existsSync(join(support, "aktivitaet", "papierkorb", kennung)), false, "nichts wurde angefasst, auch kein Papierkorb");
});

test("K1: pfade[0] und rueckgaengig.pfad müssen dieselbe Datei nennen; der Schreiber lässt sonst gar keine Rückgängig-Möglichkeit zu", async () => {
  const { rufe, d, support, ev } = aufbau();
  schreibe(d, "00_inbox/a.md", "# A\n"); schreibe(d, "00_inbox/b.md", "# B\n");
  const e = ev({ art: "ablage-notiz", text: "x", pfade: ["00_inbox/a.md"], rueckgaengig: { art: "ablage-entfernen", pfad: "00_inbox/b.md", hash: sha("# B\n") } });
  assert.equal(e.rueckgaengig, undefined);
  rohZeile(support, d, { id: "a_zzzzzz1_abcdef", art: "ablage-notiz", pfade: ["00_inbox/a.md"], rueckgaengig: { art: "ablage-entfernen", pfad: "00_inbox/b.md", hash: sha("# B\n") } });
  const r = await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: "a_zzzzzz1_abcdef" });
  assert.equal(r.status, 409); assert.equal(r.j.art, "unzulaessig");
  assert.ok(existsSync(join(d, "00_inbox/b.md")) && existsSync(join(d, "00_inbox/a.md")));
});

test("K1: eine Datei, die nicht zur Zeit des Eintrags angelegt wurde, wird nicht entfernt", async () => {
  const { rufe, d, ev } = aufbau();
  const inhalt = "# Alt\n";
  schreibe(d, "00_inbox/alt.md", inhalt);
  const e = ev({ art: "ablage-notiz", text: "x", zeit: new Date(Date.now() - 3600_000).toISOString(), pfade: ["00_inbox/alt.md"], rueckgaengig: { art: "ablage-entfernen", pfad: "00_inbox/alt.md", hash: sha(inhalt) } });
  const r = await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: e.id });
  assert.equal(r.status, 409); assert.equal(r.j.art, "unzulaessig"); assert.match(r.j.fehler, /anderen Zeit/);
  assert.ok(existsSync(join(d, "00_inbox/alt.md")));
});

test("W1: eine ignorierte Datei (nicht versioniert) wird nie ohne Kopie gelöscht und nie per Commit „entfernt“", async () => {
  const { rufe, d, ablage, support, kennung } = aufbau({ git: true });
  writeFileSync(join(d, ".gitignore"), "00_inbox/ignoriert.md\n"); g(d, "add", "--", ".gitignore"); g(d, "commit", "-q", "-m", "ignore");
  const vorher = g(d, "rev-parse", "HEAD").trim();
  const e = ablage("00_inbox/ignoriert.md", "# Ignoriert\n");
  assert.equal(g(d, "status", "--porcelain", "--", "00_inbox/ignoriert.md").trim(), "", "Git sieht sie nicht");
  const r = await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: e.id });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.deepEqual([r.j.art, r.j.papierkorb, r.j.commit], ["entfernt", true, null]);
  assert.equal(g(d, "rev-parse", "HEAD").trim(), vorher, "kein Commit");
  assert.equal(readFileSync(join(support, "aktivitaet", "papierkorb", kennung, `${e.id}-ignoriert.md`), "utf8"), "# Ignoriert\n");
});

test("W1: scheitert der Commit, kommt die Datei zurück und die Antwort ist ein Fehler (nie „entfernt“)", async () => {
  const { rufe, d, ev } = aufbau({ git: true });
  const rel = "00_inbox/2026-10-31_fest.md", inhalt = "# Fest\n";
  schreibe(d, rel, inhalt); g(d, "add", "--", rel); g(d, "commit", "-q", "-m", "Sicherung");
  const e = ev({ art: "ablage-notiz", text: "x", pfade: [rel], rueckgaengig: { art: "ablage-entfernen", pfad: rel, hash: sha(inhalt) } });
  writeFileSync(join(d, ".git", "index.lock"), ""); // ein anderer Git-Prozess hält die Sperre: der Commit scheitert
  const r = await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: e.id });
  rmSync(join(d, ".git", "index.lock"), { force: true });
  assert.equal(r.status, 500, JSON.stringify(r.j)); assert.equal(r.j.art, "festhalten-fehlgeschlagen");
  assert.equal(readFileSync(join(d, rel), "utf8"), inhalt, "die Datei ist unverändert wieder da");
  const l = (await rufe("GET", "/api/aktivitaet")).j.ereignisse;
  assert.equal(l.find((x) => x.id === e.id).zurueckgenommen, null, "nicht als zurückgenommen vermerkt");
  assert.equal(l.some((x) => x.art === "rueckgaengig"), false);
});

test("k2: bei offener Zusammenführung wird nichts entfernt (409 beschaeftigt), danach geht es", async () => {
  const { rufe, ablage, d } = aufbau({ git: true });
  const e = ablage("00_inbox/n.md", "# N\n");
  writeFileSync(join(d, ".git", "MERGE_HEAD"), "0".repeat(40) + "\n");
  const r = await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: e.id });
  assert.equal(r.status, 409); assert.equal(r.j.art, "beschaeftigt");
  assert.ok(existsSync(join(d, "00_inbox/n.md")));
  rmSync(join(d, ".git", "MERGE_HEAD"));
  assert.equal((await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: e.id })).status, 200, "danach geht es");
});

test("W2: der Live-Strom meldet nie Altes — auch nicht nach mehr als 300 und 600 Einträgen und nach Rotationen; Neues kommt genau einmal", async () => {
  const { erzeugeEreignisse } = await import(pfad("werkstatt", "ereignisse.mjs"));
  const support = tmp("akt-w2-support-"), d = tmp("akt-w2-vault-"); schreibe(d, "brain.config.json", "{}\n");
  const alt = Date.now() - 3600_000;
  for (let i = 0; i < 700; i++) A.schreibeEreignis(support, d, { art: "ablage-notiz", text: `alt ${i}`, zeit: new Date(alt + i * 1000).toISOString() }, { maxBytes: 100_000 });
  const h = erzeugeEreignisse({ support, aktivitaetPollMs: 30, modus: "poll", pollMs: 80, entprellMs: 40 });
  h.richteAuf(d, { aufgabenOrdner: "05_aufgaben" });
  const stand = await h.warte({}); await pause(150);
  let aktuell = stand.aktuell;
  const hole = async (ms) => { const aus = []; const ende = Date.now() + ms; while (Date.now() < ende) { const r = await h.warte({ seit: aktuell, epoche: stand.epoche, warteMs: 200 }); aktuell = r.aktuell; aus.push(...r.ereignisse.filter((x) => x.typ === "aktivitaet")); } return aus; };
  assert.deepEqual(await hole(600), [], "nichts Altes beim Start");
  const neu = [];
  for (let i = 0; i < 650; i++) { neu.push(A.schreibeEreignis(support, d, { art: "pflege", text: `neu ${i}` }, { maxBytes: 20_000 }).id); if (i % 50 === 49) await pause(60); }
  const gemeldet = await hole(1500);
  const ids = gemeldet.map((x) => x.id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, "keine Doppelten");
  assert.ok(gemeldet.every((x) => x.art === "zustand" || /^neu /.test(x.text)), "nichts aus der Vorzeit");
  assert.ok(ids.length > 0 && ids.every((i) => neu.includes(i)));
  const eins = A.schreibeEreignis(support, d, { art: "abweisung", text: "wollte lesen." });
  const l = await hole(800);
  assert.equal(l.filter((x) => x.id === eins.id).length, 1);
  h.beende();
});

test("k2: läuft ein Abgleich (gemeinsame Sperre) oder wartet ein gemerkter Konfliktstand (konfliktBasis), wird nichts entfernt (409 beschaeftigt)", async () => {
  const { rufe, ablage, d, support, kennung } = aufbau();
  const e = ablage("00_inbox/n.md", "# N\n");
  const sperre = join(support, "backup", `${kennung}.sperre`);
  mkdirSync(join(support, "backup"), { recursive: true });
  writeFileSync(sperre, JSON.stringify({ pid: process.pid, zeit: Date.now(), art: "studio-abgleich", marke: "abc" }));
  let r = await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: e.id });
  assert.equal(r.status, 409); assert.equal(r.j.art, "beschaeftigt"); assert.ok(existsSync(join(d, "00_inbox/n.md")));
  rmSync(sperre);
  const merker = join(support, "backup", `${kennung}.json`);
  writeFileSync(merker, JSON.stringify({ konfliktBasis: { dateien: ["a.md"], zeit: new Date().toISOString() } }) + "\n");
  r = await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: e.id });
  assert.equal(r.status, 409); assert.equal(r.j.art, "beschaeftigt"); assert.ok(existsSync(join(d, "00_inbox/n.md")));
  rmSync(merker);
  assert.equal((await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: e.id })).status, 200);
});

test("W4: ein Eintrag mit Zeit in der Zukunft schaltet den Live-Strom nicht ab (Marke nie nach vorn); eine zurückgestellte Uhr setzt die Marke zurück", async () => {
  const { erzeugeEreignisse } = await import(pfad("werkstatt", "ereignisse.mjs"));
  const support = tmp("akt-w4-support-"), d = tmp("akt-w4-vault-"); schreibe(d, "brain.config.json", "{}\n");
  let versatz = 0; // die Uhr des Hubs: springt um `versatz` ms
  const h = erzeugeEreignisse({ support, aktivitaetPollMs: 30, modus: "poll", pollMs: 80, entprellMs: 40, aktivitaetJetzt: () => Date.now() + versatz });
  h.richteAuf(d, { aufgabenOrdner: "05_aufgaben" });
  const stand = await h.warte({}); await pause(150);
  let aktuell = stand.aktuell;
  const hole = async (ms) => { const aus = []; const ende = Date.now() + ms; while (Date.now() < ende) { const r = await h.warte({ seit: aktuell, epoche: stand.epoche, warteMs: 150 }); aktuell = r.aktuell; aus.push(...r.ereignisse.filter((x) => x.typ === "aktivitaet")); } return aus; };
  // gefälscht: zehn Tage in der Zukunft (am Schreiber vorbei) — wird nie gemeldet und verschiebt nichts
  rohZeile(support, d, { id: "a_zukunf_abcdef", art: "pflege", text: "aus der Zukunft", zeit: new Date(Date.now() + 10 * 86400_000).toISOString() });
  assert.deepEqual(await hole(400), []);
  const e1 = A.schreibeEreignis(support, d, { art: "pflege", text: "normal 1" });
  assert.deepEqual((await hole(600)).map((x) => x.id), [e1.id], "danach kommen normale Einträge weiter");
  // der Schreiber selbst kappt die Zeit auf höchstens 60 s nach vorn
  const e2 = A.schreibeEreignis(support, d, { art: "pflege", text: "kappt", zeit: new Date(Date.now() + 5 * 86400_000).toISOString() });
  assert.ok(Date.parse(e2.zeit) <= Date.now() + 61_000);
  await hole(400);
  h.beende();

  // Uhr springt zurück: der Hub startet mit einer Uhr, die eine Stunde vorgeht (Marke = Zukunft), dann wird sie zurückgestellt
  let versatz2 = 3600_000;
  const h2 = erzeugeEreignisse({ support, aktivitaetPollMs: 30, modus: "poll", pollMs: 80, entprellMs: 40, aktivitaetJetzt: () => Date.now() + versatz2 });
  h2.richteAuf(d, { aufgabenOrdner: "05_aufgaben" });
  const st2 = await h2.warte({}); await pause(150);
  versatz2 = 0;
  const e3 = A.schreibeEreignis(support, d, { art: "pflege", text: "nach dem Zurückstellen" });
  let a2 = st2.aktuell; const l2 = [];
  for (const ende = Date.now() + 1200; Date.now() < ende;) { const r = await h2.warte({ seit: a2, epoche: st2.epoche, warteMs: 150 }); a2 = r.aktuell; l2.push(...r.ereignisse.filter((x) => x.typ === "aktivitaet")); }
  assert.deepEqual(l2.map((x) => x.id), [e3.id], "die Marke ist mit der Uhr zurückgesprungen: der Eintrag wird gemeldet");
  h2.beende();
});

test("Wiederherstellen: eine zurückgenommene Ablage kommt aus dem Papierkorb zurück (Platz frei, Kopie unverändert); belegt → nichts wird überschrieben; danach ist Rückgängig wieder möglich", async () => {
  const { rufe, ablage, d, support, kennung } = aufbau();
  const rel = "00_inbox/2026-10-31_zurueck.md", inhalt = "# Zurück\n";
  const e = ablage(rel, inhalt);
  assert.equal((await rufe("POST", "/api/aktivitaet/wiederherstellen", { id: e.id })).j.art, "nicht-zurueck", "nur Zurückgenommenes");
  await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: e.id });
  let l = (await rufe("GET", "/api/aktivitaet")).j.ereignisse.find((x) => x.id === e.id);
  assert.equal(l.wiederherstellenMoeglich, true); assert.equal(l.rueckgaengigMoeglich, false);
  // belegt: der Nutzer hat inzwischen etwas Eigenes an diese Stelle gelegt
  schreibe(d, rel, "# Meins\n");
  let r = await rufe("POST", "/api/aktivitaet/wiederherstellen", { id: e.id });
  assert.equal(r.status, 409); assert.equal(r.j.art, "belegt"); assert.equal(readFileSync(join(d, rel), "utf8"), "# Meins\n");
  rmSync(join(d, rel));
  r = await rufe("POST", "/api/aktivitaet/wiederherstellen", { id: e.id });
  assert.equal(r.status, 200, JSON.stringify(r.j)); assert.deepEqual([r.j.art, r.j.pfad], ["wiederhergestellt", rel]);
  assert.equal(readFileSync(join(d, rel), "utf8"), inhalt);
  l = (await rufe("GET", "/api/aktivitaet")).j.ereignisse;
  assert.equal(l.find((x) => x.id === e.id).zurueckgenommen, null); assert.match(l[0].text, /^Wiederhergestellt/);
  // ein zweites Rückgängig klappt wieder (die Datei gilt ab der Wiederherstellung als „neu“)
  assert.equal((await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: e.id })).status, 200);
  // Kopie verändert oder weg → kein Wiederherstellen
  const kopie = join(support, "aktivitaet", "papierkorb", kennung, `${e.id}-2026-10-31_zurueck.md`);
  writeFileSync(kopie, "manipuliert");
  assert.equal((await rufe("POST", "/api/aktivitaet/wiederherstellen", { id: e.id })).j.art, "kopie-veraendert");
  rmSync(kopie);
  assert.equal((await rufe("POST", "/api/aktivitaet/wiederherstellen", { id: e.id })).j.art, "keine-kopie");
  assert.equal((await rufe("GET", "/api/aktivitaet")).j.ereignisse.find((x) => x.id === e.id).wiederherstellenMoeglich, false);
});

test("Wiederherstellen: ein gefälschter Eintrag kann keine Datei an einen anderen Ort legen (nur die Ordner der Ablagen)", async () => {
  const { rufe, d, support, kennung } = aufbau();
  mkdirSync(join(support, "aktivitaet", "papierkorb", kennung), { recursive: true });
  writeFileSync(join(support, "aktivitaet", "papierkorb", kennung, "a_forgxx_abcdef-x.md"), "# X\n");
  rohZeile(support, d, { id: "a_forgxx_abcdef", art: "ablage-notiz", pfade: ["09_wiki/x.md"], rueckgaengig: { art: "ablage-entfernen", pfad: "09_wiki/x.md", hash: sha("# X\n") } });
  const merke = A.aendereZustand(support, kennung, (s) => { s.zurueck["a_forgxx_abcdef"] = new Date().toISOString(); });
  assert.ok(merke.zurueck["a_forgxx_abcdef"]);
  const r = await rufe("POST", "/api/aktivitaet/wiederherstellen", { id: "a_forgxx_abcdef" });
  assert.equal(r.status, 409); assert.equal(r.j.art, "unzulaessig");
  assert.equal(existsSync(join(d, "09_wiki/x.md")), false);
});

test("k2: eine offene Zusammenführung wird über Git selbst erkannt (auch in einem verknüpften Arbeitsbaum, wo MERGE_HEAD nicht unter .git/ liegt)", async () => {
  const hauptRepo = repo("akt-wt-haupt-");
  const wt = join(tmp("akt-wt-"), "arbeitsbaum");
  g(hauptRepo, "worktree", "add", "-q", "-b", "zweig", wt);
  schreibe(wt, "brain.config.json", "{}\n"); schreibe(wt, "00_inbox/.gitkeep", "");
  const support = tmp("akt-wt-support-");
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "WT", pfad: wt }], aktiv: wt }));
  const h = erzeugeHandler({ vault: wt, vaultOptionen: { support }, ereignisse: { aktivitaetPollMs: 0, modus: "poll" } });
  const rufe = aufruf(h);
  const inhalt = "# N\n"; schreibe(wt, "00_inbox/n.md", inhalt);
  const e = A.schreibeEreignis(support, wt, { art: "ablage-notiz", text: "x", pfade: ["00_inbox/n.md"], rueckgaengig: { art: "ablage-entfernen", pfad: "00_inbox/n.md", hash: sha(inhalt) } });
  const gitDir = g(wt, "rev-parse", "--git-dir").trim();
  assert.ok(gitDir.includes("worktrees"), "verknüpfter Arbeitsbaum: der Git-Ordner liegt anderswo");
  writeFileSync(join(gitDir.startsWith("/") ? gitDir : join(wt, gitDir), "MERGE_HEAD"), "0".repeat(40) + "\n");
  const r = await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: e.id });
  assert.equal(r.status, 409); assert.equal(r.j.art, "beschaeftigt");
  assert.ok(existsSync(join(wt, "00_inbox/n.md")));
  h.ereignisse.beende();
});
