#!/usr/bin/env node
// Attrappe für Werkstatt + Oberfläche (nur für scripts/teste-aktionskanal.sh): spricht das Brücken-Protokoll, startet ohne
// Vault-Argument und liefert eine Seite, die den Aktionskanal der App (window.webkit.messageHandlers.aktion) durchspielt und
// die Antworten in STUB_LOG protokolliert. So lässt sich die Swift-Seite prüfen, ohne dass Backend und Oberfläche fertig sind.
// Umgebung: STUB_LOG (Ergebnisdatei), STUB_MODUS (leer | mit-vault | ohne-kern), STUB_NEUER_VAULT (Ziel des Vault-Wechsels),
// STUB_VAULT (der erste Vault, dessen brain.config.json „verschwindet“), BRAIN_APP_SUPPORT (Support-Ordner mit App-Log).
// Kern-Umzug P4: Die App ruft den gebündelten Kern ohne Vertrauensprüfung; es gibt keine Freigabe-Attrappe mehr.
import { appendFileSync, writeFileSync, readFileSync, rmSync, copyFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
const LOG = process.env.STUB_LOG;
const SUPPORT = process.env.BRAIN_APP_SUPPORT;
const MODUS = process.env.STUB_MODUS ?? "";
const VAULT = process.env.STUB_VAULT ?? "";
const APPLOG = `${SUPPORT}/logs/app.log`;
const rep = (o) => appendFileSync(LOG, JSON.stringify(o) + "\n");
rep({ start: { argv: process.argv.slice(2), brainVault: process.env.BRAIN_VAULT ?? null, support: SUPPORT ?? null } });
const SEITE = `<!doctype html><html><head><meta charset="utf-8"><title>Stub</title></head><body>stub<script>
const K = window.webkit.messageHandlers.brain, A = window.webkit.messageHandlers.aktion;
const api = async (m, p, d) => { const r = await K.postMessage({ methode: m, pfad: p, daten: d ?? null }); return JSON.parse(r.body); };
const meld = (o) => api("POST", "/api/stub", o);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// Das App-Log ist der Beleg: warten, bis eine Zeile (Muster) mindestens so oft vorkommt — statt auf gut Glück zu schlafen.
const zaehle = async (muster) => (await meld({ zaehleLog: muster })).anzahl;
const warte = async (muster, mindestens = 1, frist = 25000) => (await meld({ warteAufLog: { muster, mindestens, frist } })).gefunden;
window.studio = { bereit: false, befehl: (n) => meld({ befehl: n }), vorSchliessen: async () => ({ ok: true }) };
(async () => {
  const e = {};
  try {
    const modus = (await meld({ modus: true })).modus;
    e.titel = JSON.stringify(await A.postMessage({ aktion: "titel", wert: "Stub Vault" }));
    e.ungueltig = await A.postMessage({ aktion: "loeschen" }).then(() => "angenommen", (x) => "abgewiesen:" + x);
    e.ohneWert = await A.postMessage({ aktion: "extern" }).then(() => "angenommen", (x) => "abgewiesen:" + x);
    // Das Backend meldet Vertrauensänderungen (Hooks/Git) an die App; für den Kern ändert das nichts.
    e.vertrauenGeaendert = JSON.stringify(await A.postMessage({ aktion: "vertrauen-geaendert" }));
    await pause(2000); // die App liest den Status im Hintergrund neu
    e.ansicht = JSON.stringify(await A.postMessage({ aktion: "ansicht" }));
    if (modus === "leer") {
      // Aktion „fehler“ (Review SW-7): je Fensterleben höchstens 20 Zeilen im Log, danach einmal „gedrosselt“, der Rest wird verworfen.
      const antworten = [];
      for (let i = 1; i <= 25; i++) antworten.push(await A.postMessage({ aktion: "fehler", wert: { text: "Probefehler " + i, ort: "stub.js:" + i + ":1" } }));
      e.fehlerAngenommen = antworten.filter((a) => a && a.ok === true).length;
      e.fehlerGedrosselt = antworten.filter((a) => a && a.ok === false && a.grund === "gedrosselt").length;
    }
    if (modus === "mit-vault") {
      // Die Übersicht öffnen und warten, bis ihre Seite (vom gebündelten Kern, über bin/kern) geladen ist.
      const oeffneUebersicht = async () => {
        const vorher = await zaehle(" fenster-bereit uebersicht");
        const antwort = JSON.stringify(await A.postMessage({ aktion: "ansicht" }));
        return { antwort, bereit: JSON.parse(antwort).ok === true && (await warte(" fenster-bereit uebersicht", vorher + 1, 30000)) };
      };
      // 1) Die Übersicht ist offen (e.ansicht), ohne dass der Vault je „freigegeben“ wurde.
      e.bereitEins = await warte(" fenster-bereit uebersicht", 1, 30000);
      // 2) Ein Abgleich löscht brain.config.json: der Ordner ist kein Brain mehr, die Übersicht schließt (Review SW-2).
      await meld({ kitWeg: true });
      await A.postMessage({ aktion: "vertrauen-geaendert" });
      e.schliesstOhneKonfig = await warte(" uebersicht-geschlossen kein-brain");
      e.ansichtOhneKonfig = JSON.stringify(await A.postMessage({ aktion: "ansicht" }));
      // 3) Wieder da: die Übersicht öffnet erneut und bleibt offen, bis der Vault wechselt.
      await meld({ kitDa: true });
      await A.postMessage({ aktion: "vertrauen-geaendert" });
      const zwei = await oeffneUebersicht();
      e.ansichtZwei = zwei.antwort; e.bereitZwei = zwei.bereit;
    }
    await meld({ schreibeVaults: true });
    e.gewechselt = JSON.stringify(await A.postMessage({ aktion: "vault-gewechselt" }));
    await meld({ ergebnis: e });
    const dlg = A.postMessage({ aktion: "ordner-waehlen", wert: { titel: "Stub-Dialog", vorschlag: "~/Brain" } });
    await pause(800);
    const zweiter = await A.postMessage({ aktion: "ordner-waehlen" });
    await meld({ ergebnis: { zweiterDialog: String(zweiter), typ: typeof zweiter } });
    window.studio.bereit = true;
    await dlg;
  } catch (x) { await meld({ fehler: String(x) }).catch(() => {}); }
})();
</script></body></html>`;
const b64 = (s) => Buffer.from(s).toString("base64");
const sende = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const antwort = (id, wert) => sende({ id, status: 200, headers: { "Content-Type": "application/json" }, body: b64(JSON.stringify(wert)) });
process.stdout.write(JSON.stringify({ bereit: true, version: "stub", vaultId: "stub" }) + "\n");

const appLog = () => { try { return readFileSync(APPLOG, "utf8"); } catch { return ""; } };
const anzahl = (muster) => (appLog().match(new RegExp(muster, "gm")) || []).length;

// „Kit weg“: die brain.config.json des ersten Vaults verschwindet wie nach einem Abgleich, der sie gelöscht hat; „Kit da“ stellt sie her.
const KIT = `${VAULT}/brain.config.json`, KIT_SICHERUNG = `${SUPPORT}/stub-brain.config.sicherung`;

const rl = createInterface({ input: process.stdin });
rl.on("line", (z) => {
  const a = JSON.parse(z);
  const body = a.body ? JSON.parse(Buffer.from(a.body, "base64").toString()) : null;
  if (a.pfad === "/" || a.pfad === "/index.html") return sende({ id: a.id, status: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body: b64(SEITE) });
  if (a.pfad === "/api/stub") {
    if (body?.modus) return antwort(a.id, { modus: MODUS });
    if (body?.zaehleLog) return antwort(a.id, { anzahl: anzahl(body.zaehleLog) });
    if (body?.warteAufLog) {
      const { muster, mindestens = 1, frist = 25000 } = body.warteAufLog;
      const bis = Date.now() + frist;
      const pruefe = () => {
        if (anzahl(muster) >= mindestens) return antwort(a.id, { gefunden: true });
        if (Date.now() > bis) return antwort(a.id, { gefunden: false });
        setTimeout(pruefe, 100);
      };
      return pruefe();
    }
    if (body?.kitWeg) {
      if (!existsSync(KIT_SICHERUNG)) copyFileSync(KIT, KIT_SICHERUNG);
      rmSync(KIT, { force: true });
    } else if (body?.kitDa) {
      copyFileSync(KIT_SICHERUNG, KIT);
    } else if (body?.schreibeVaults) {
      // Wie das Backend: vaults.json auf einen anderen aktiven Vault stellen
      const neu = process.env.STUB_NEUER_VAULT;
      writeFileSync(`${SUPPORT}/vaults.json`, JSON.stringify({ vaults: [{ name: "Zweiter Vault", pfad: neu }], aktiv: neu }));
    } else rep(body);
    return antwort(a.id, {});
  }
  sende({ id: a.id, status: 404, headers: { "Content-Type": "application/json" }, body: b64('{"fehler":"nicht gefunden"}') });
});
rl.on("close", () => process.exit(0));
