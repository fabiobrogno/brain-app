// Werkstatt-Routen des Aktivitätsprotokolls (P8a): GET /api/aktivitaet (seit, art, limit, vault=alle, nur=ungelesen), POST …/gelesen, POST …/rueckgaengig (nur unverändert,
// git-sicher mit ausgeschalteten Hooks, sonst Papierkorb) und das Ereignis „aktivitaet“ auf dem Live-Strom (/api/ereignisse). Nur Wegwerf-Ordner.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync, chmodSync } from "node:fs";
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
  assert.equal(r.j.art, "entfernt"); assert.equal(r.j.papierkorb, false); assert.match(r.j.commit, /^[0-9a-f]{40}$/);
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
