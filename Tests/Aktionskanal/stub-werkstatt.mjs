#!/usr/bin/env node
// Attrappe für Werkstatt + Oberfläche (nur für scripts/teste-aktionskanal.sh): spricht das Brücken-Protokoll, startet ohne
// Vault-Argument und liefert eine Seite, die den Aktionskanal der App (window.webkit.messageHandlers.aktion) durchspielt und
// die Antworten in STUB_LOG protokolliert. So lässt sich die Swift-Seite prüfen, ohne dass Backend und Oberfläche fertig sind.
import { appendFileSync, writeFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
const LOG = process.env.STUB_LOG;
const SUPPORT = process.env.BRAIN_APP_SUPPORT;
const rep = (o) => appendFileSync(LOG, JSON.stringify(o) + "\n");
rep({ start: { argv: process.argv.slice(2), brainVault: process.env.BRAIN_VAULT ?? null, support: SUPPORT ?? null } });
const SEITE = `<!doctype html><html><head><meta charset="utf-8"><title>Stub</title></head><body>stub<script>
const K = window.webkit.messageHandlers.brain, A = window.webkit.messageHandlers.aktion;
const api = async (m, p, d) => { const r = await K.postMessage({ methode: m, pfad: p, daten: d ?? null }); return JSON.parse(r.body); };
const meld = (o) => api("POST", "/api/stub", o);
window.studio = { bereit: false, befehl: (n) => meld({ befehl: n }), vorSchliessen: async () => ({ ok: true }) };
(async () => {
  const e = {};
  try {
    e.titel = JSON.stringify(await A.postMessage({ aktion: "titel", wert: "Stub Vault" }));
    e.ungueltig = await A.postMessage({ aktion: "loeschen" }).then(() => "angenommen", (x) => "abgewiesen:" + x);
    e.ohneWert = await A.postMessage({ aktion: "extern" }).then(() => "angenommen", (x) => "abgewiesen:" + x);
    e.ansicht = JSON.stringify(await A.postMessage({ aktion: "ansicht" }));
    await meld({ schreibeVaults: true });
    e.gewechselt = JSON.stringify(await A.postMessage({ aktion: "vault-gewechselt" }));
    await meld({ ergebnis: e });
    const dlg = A.postMessage({ aktion: "ordner-waehlen", wert: { titel: "Stub-Dialog", vorschlag: "~/Brain" } });
    await new Promise((r) => setTimeout(r, 800));
    const zweiter = await A.postMessage({ aktion: "ordner-waehlen" });
    await meld({ ergebnis: { zweiterDialog: String(zweiter), typ: typeof zweiter } });
    window.studio.bereit = true;
    await dlg;
  } catch (x) { await meld({ fehler: String(x) }).catch(() => {}); }
})();
</script></body></html>`;
const b64 = (s) => Buffer.from(s).toString("base64");
const sende = (o) => process.stdout.write(JSON.stringify(o) + "\n");
process.stdout.write(JSON.stringify({ bereit: true, version: "stub", vaultId: "stub" }) + "\n");
const rl = createInterface({ input: process.stdin });
rl.on("line", (z) => {
  const a = JSON.parse(z);
  const body = a.body ? JSON.parse(Buffer.from(a.body, "base64").toString()) : null;
  if (a.pfad === "/" || a.pfad === "/index.html") return sende({ id: a.id, status: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body: b64(SEITE) });
  if (a.pfad === "/api/stub") {
    if (body?.schreibeVaults) {
      // Wie das Backend: vaults.json auf einen anderen aktiven Vault stellen
      const neu = process.env.STUB_NEUER_VAULT;
      writeFileSync(`${SUPPORT}/vaults.json`, JSON.stringify({ vaults: [{ name: "Zweiter Vault", pfad: neu }], aktiv: neu }));
    } else rep(body);
    return sende({ id: a.id, status: 200, headers: { "Content-Type": "application/json" }, body: b64("{}") });
  }
  sende({ id: a.id, status: 404, headers: { "Content-Type": "application/json" }, body: b64('{"fehler":"nicht gefunden"}') });
});
rl.on("close", () => process.exit(0));
