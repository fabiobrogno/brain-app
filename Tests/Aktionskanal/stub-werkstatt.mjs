#!/usr/bin/env node
// Attrappe für Werkstatt + Oberfläche (nur für scripts/teste-aktionskanal.sh): spricht das Brücken-Protokoll, startet ohne
// Vault-Argument und liefert eine Seite, die den Aktionskanal der App (window.webkit.messageHandlers.aktion) durchspielt und
// die Antworten in STUB_LOG protokolliert. So lässt sich die Swift-Seite prüfen, ohne dass Backend und Oberfläche fertig sind.
// Umgebung: STUB_LOG (Ergebnisdatei), STUB_MODUS (leer | mit-vault | ohne-cli), STUB_NEUER_VAULT (Ziel des Vault-Wechsels),
// STUB_VAULT (der erste Vault, dessen Kit „verschwindet“), BRAIN_APP_SUPPORT (Support-Ordner mit Freigabe-Datei und App-Log).
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
    // Ohne Vertrauen öffnet die Übersicht nicht (Studio-v2-Spec §8); dann gibt das Backend frei und meldet es der App.
    e.ansichtOhneVertrauen = JSON.stringify(await A.postMessage({ aktion: "ansicht" }));
    await meld({ gewaehreVertrauen: true });
    e.vertrauenGeaendert = JSON.stringify(await A.postMessage({ aktion: "vertrauen-geaendert" }));
    await pause(2000); // die App liest Erlaubnis und Status im Hintergrund neu
    e.ansicht = JSON.stringify(await A.postMessage({ aktion: "ansicht" }));
    if (modus === "leer") {
      // Aktion „fehler“ (Review SW-7): je Fensterleben höchstens 20 Zeilen im Log, danach einmal „gedrosselt“, der Rest wird verworfen.
      const antworten = [];
      for (let i = 1; i <= 25; i++) antworten.push(await A.postMessage({ aktion: "fehler", wert: { text: "Probefehler " + i, ort: "stub.js:" + i + ":1" } }));
      e.fehlerAngenommen = antworten.filter((a) => a && a.ok === true).length;
      e.fehlerGedrosselt = antworten.filter((a) => a && a.ok === false && a.grund === "gedrosselt").length;
    }
    if (modus === "mit-vault") {
      // Die Übersicht öffnen und warten, bis ihre Kit-Seite geladen ist (sonst stört der Start der Kit-Brücke, die vorher ebenfalls die
      // Prüfung fragt, die gestellten Prüffehler unten).
      const oeffneUebersicht = async () => {
        const vorher = await zaehle(" fenster-bereit uebersicht");
        const antwort = JSON.stringify(await A.postMessage({ aktion: "ansicht" }));
        return { antwort, bereit: JSON.parse(antwort).ok === true && (await warte(" fenster-bereit uebersicht", vorher + 1, 30000)) };
      };
      // 1) Die Übersicht ist offen (e.ansicht). Das Backend nimmt die Freigabe zurück und meldet es: Die Übersicht schließt (Review SW-2).
      e.bereitEins = await warte(" fenster-bereit uebersicht", 1, 30000);
      const zuEntzug = await zaehle(" uebersicht-geschlossen kit-nicht-erlaubt");
      await meld({ entziehVertrauen: true });
      e.entzugAntwort = JSON.stringify(await A.postMessage({ aktion: "vertrauen-geaendert" }));
      e.schliesstBeiEntzug = await warte(" uebersicht-geschlossen kit-nicht-erlaubt", zuEntzug + 1);
      e.ansichtNachEntzug = JSON.stringify(await A.postMessage({ aktion: "ansicht" }));
      // 2) Wieder freigeben, Übersicht öffnen. Ein Abgleich löscht das Kit (.tools/brain.mjs): Die Übersicht schließt auch dann.
      await meld({ gewaehreVertrauen: true });
      await A.postMessage({ aktion: "vertrauen-geaendert" });
      const zwei = await oeffneUebersicht();
      e.ansichtZwei = zwei.antwort; e.bereitZwei = zwei.bereit;
      await meld({ kitWeg: true });
      await A.postMessage({ aktion: "vertrauen-geaendert" });
      e.schliesstOhneKit = await warte(" uebersicht-geschlossen kein-kit");
      await meld({ kitDa: true });
      // 3) Technischer Prüffehler beim ersten Versuch (Review SW-5): Die Übersicht bleibt offen, nach 10 s wird noch einmal geprüft.
      const drei = await oeffneUebersicht();
      e.ansichtDrei = drei.antwort; e.bereitDrei = drei.bereit;
      const statusVor = await zaehle(" status (ok|hinweis|problem)$");
      await meld({ pruefFehler: 1 });
      await A.postMessage({ aktion: "vertrauen-geaendert" });
      e.fehlerAngezeigt = await warte(" status kit-pruefung-fehlgeschlagen unerwartete-ausgabe$");
      e.wiederholungGeplant = await warte(" kit-pruefung-wiederholung in 10s$");
      e.wiederholungOk = await warte(" status (ok|hinweis|problem)$", statusVor + 1); // die Wiederholung findet das Vertrauen intakt
      // 4) Auch die Wiederholung scheitert: erst jetzt schließt die Übersicht.
      await meld({ pruefFehler: 2 });
      await A.postMessage({ aktion: "vertrauen-geaendert" });
      e.schliesstNachWiederholung = await warte(" uebersicht-geschlossen pruefung-fehlgeschlagen");
      // 5) Für den Vault-Wechsel: die Übersicht noch einmal öffnen (der Prüffehler ist aufgebraucht).
      await pause(1500);
      const vier = await oeffneUebersicht();
      e.ansichtVier = vier.antwort; e.bereitVier = vier.bereit;
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

// „Kit weg“: das Kit des ersten Vaults (.tools/brain.mjs) verschwindet wie nach einem Abgleich, der es gelöscht hat; „Kit da“ stellt es her.
const KIT = `${VAULT}/.tools/brain.mjs`, KIT_SICHERUNG = `${SUPPORT}/stub-brain.mjs.sicherung`;

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
    if (body?.gewaehreVertrauen) {
      // Wie das Backend nach „Vertrauen erlauben“: die Attrappen-CLI (vertrauen-pruefen.mjs) liest diese Datei
      writeFileSync(`${SUPPORT}/stub-vertrauen`, "ja");
    } else if (body?.entziehVertrauen) {
      // Wie das Backend nach „Vertrauen entziehen“ (oder einem Abgleich, der Kit-Code geändert hat): die Freigabe gilt nicht mehr
      rmSync(`${SUPPORT}/stub-vertrauen`, { force: true });
    } else if (body?.kitWeg) {
      if (!existsSync(KIT_SICHERUNG)) copyFileSync(KIT, KIT_SICHERUNG);
      rmSync(KIT, { force: true });
    } else if (body?.kitDa) {
      copyFileSync(KIT_SICHERUNG, KIT);
    } else if (body?.pruefFehler) {
      // Die nächsten n Aufrufe der Attrappen-CLI scheitern technisch (kein JSON, Exit 3)
      writeFileSync(`${SUPPORT}/stub-pruef-fehler`, String(body.pruefFehler));
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
