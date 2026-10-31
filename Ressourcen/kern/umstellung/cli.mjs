#!/usr/bin/env node
// umstellung/cli.mjs — „kortex umstellung …“ (Pakete P7a und P7b).
//   befund   [--json] [--claude-home <ordner>]…                           nur lesend (P7a)
//   stand    [--json]                                                     nur lesend: Phase, Schritte, Probelauf
//   probelauf [--ja] [--entscheide a=ja,b=nein] [--claude-home <ordner>]… [--json]
//   phase-a  [--ja] [--schritt A1,A4]… [--entscheide …] [--claude-home …]… [--json]
//   zurueck  [--ja] (--schritt A4,… | --alles) [--entscheide …] [--claude-home …]… [--json]
//   phase-b  [--probelauf] [--ja] [--entscheide keineAltenMacs=ja,bewusst=E15+E24] [--claude-home …]… [--json]   Phase B (P7d): ohne --ja Plan und Freigabe-Tor (lesend); --probelauf --ja = Probelauf an
//            einer Kopie; --ja = alten Werkzeug-Ordner archivieren, Einstellungen bereinigen, ein Commit (nur bei offenem Tor und grünem Probelauf)
//   aufraeumen [--was verwaist|archiv|sicherungen|bundles] [--name kit-<Datum>] [--ja] [--json]       Angebote nach der Umstellung (nur lesend ohne --was/--ja); Rückweg „verwaist“: zurueck --schritt V1
//   protokoll [--json]                                                   nur lesend: Ablageort und letzte Zeilen des Protokolls (nie Werte)
//   kopie-loeschen [--ja] [--json]                                       löscht die liegen gebliebene Probekopie dieses Vaults (ohne --ja nur: was liegt da)
// Ohne --ja schreibt keiner dieser Befehle etwas: sie zeigen, was sie täten (probelauf: Plan, phase-a: Plan, zurueck: was sich zurücknehmen lässt). Mit --ja läuft der Schritt;
// phase-a verlangt vorher einen grünen Probelauf für denselben Stand. --entscheide setzt die Entscheidungen des Nutzers (gitSchluessel, verweiseAufloesen, remoteEntfernen,
// remoteBestaetigen, hooksErsetzen, mcpAnders, dienstAnderer; profile=<pfad>+<pfad>; weitereMacs=ja|nein).
// brain.mjs ruft dieses Skript mit dem Vault als erstem Argument auf (auch wenn der Vault für den Kern ungültig ist: das IST dann ein Fund des Befunds).
//   Aufruf:  cli.mjs <vault> <befehl> [Optionen]
// Ausgabe: --json genau eine JSON-Zeile (nie ein Wert), sonst Klartext. Exit 0, auch wenn beim Befund etwas gefunden wurde; 1 Fehler; 2 ohne Vault; 3 Kortex nicht bereit;
// 4 Vorbedingung fehlt (Blocker, Probelauf); 5 es läuft schon etwas; 64 falscher Aufruf.
import { erstelleBefund } from "./befund.mjs";
import { befundText } from "./bericht.mjs";

const [vault, befehl, ...rest] = process.argv.slice(2);
const BEFEHLE = ["befund", "stand", "probelauf", "phase-a", "phase-b", "aufraeumen", "zurueck", "protokoll", "kopie-loeschen"];
if (!BEFEHLE.includes(befehl)) {
  console.error("Nutzung: kortex umstellung befund|stand|probelauf|phase-a|phase-b|aufraeumen|zurueck|protokoll|kopie-loeschen [--ja] [--json] …");
  process.exit(64);
}
if (!vault) { console.error("Kein Vault gefunden. Gib ihn mit --vault <pfad> an, setze BRAIN_VAULT oder wähle in der Kortex-App einen aktiven Vault."); process.exit(2); }
const claudeHomes = [], schritte = [];
let json = false, ja = false, alles = false, entscheide = "", probelaufB = false, was = null, name = null;
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--json") json = true;
  else if (rest[i] === "--claude-home" && rest[i + 1]) claudeHomes.push(rest[++i]);
  else if (befehl !== "befund" && rest[i] === "--ja") ja = true;
  else if (befehl === "phase-b" && rest[i] === "--probelauf") probelaufB = true;
  else if (befehl === "aufraeumen" && rest[i] === "--was" && rest[i + 1]) was = rest[++i];
  else if (befehl === "aufraeumen" && rest[i] === "--name" && rest[i + 1]) name = rest[++i];
  else if ((befehl === "phase-a" || befehl === "zurueck") && rest[i] === "--schritt" && rest[i + 1]) schritte.push(...rest[++i].split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
  else if (befehl === "zurueck" && rest[i] === "--alles") alles = true;
  else if (["probelauf", "phase-a", "phase-b", "zurueck"].includes(befehl) && rest[i] === "--entscheide" && rest[i + 1] !== undefined) entscheide = rest[++i];
  else { console.error(`Unbekannte Option: ${rest[i]}`); process.exit(64); }
}

if (befehl === "befund") {
  const befund = erstelleBefund({ vault, claudeHomes });
  console.log(json ? JSON.stringify(befund) : befundText(befund).trimEnd());
} else {
  const { pruefeVault, KeinVaultFehler } = await import("../pfade.mjs");
  const { echteZiele } = await import("./ziele.mjs");
  const { UmstellungsFehler, entscheidungenAusText } = await import("./schrittliste.mjs");
  const ausgabe = (obj, textFn) => console.log(json ? JSON.stringify(obj) : textFn(obj).trimEnd());
  try {
    let v;
    try { v = pruefeVault(vault); } catch (e) { if (e instanceof KeinVaultFehler) throw new UmstellungsFehler("vault-ungueltig", e.message, 2); throw e; }
    const z = echteZiele({ vault: v, claudeHomes: claudeHomes.length ? claudeHomes : null });
    const entscheidungen = entscheidungenAusText(entscheide);
    if (befehl === "stand") {
      const { standPhaseA } = await import("./phase-a.mjs");
      const { standText } = await import("./bericht-schritte.mjs");
      const { standPhaseB } = await import("./phase-b.mjs");
      const { angebote } = await import("./aufraeumen.mjs");
      ausgabe({ ...standPhaseA(z), phaseB: standPhaseB(z), angebote: angebote(z) }, standText);
    } else if (befehl === "protokoll") {
      const { protokollAnsicht } = await import("./kopien.mjs");
      const { protokollText } = await import("./bericht-schritte.mjs");
      ausgabe(protokollAnsicht(z), protokollText);
    } else if (befehl === "kopie-loeschen") {
      const { loescheProbekopien, planKopienLoeschen } = await import("./kopien.mjs");
      const { kopieText } = await import("./bericht-schritte.mjs");
      ausgabe(ja ? { ok: true, ...loescheProbekopien(z) } : { ok: true, plan: true, bestaetigt: false, ...planKopienLoeschen(z) }, kopieText);
    } else if (befehl === "probelauf") {
      const { probelauf } = await import("./probelauf.mjs");
      const { probelaufText } = await import("./bericht-schritte.mjs");
      const r = await probelauf(z, { entscheidungen, bestaetigt: ja });
      ausgabe(r, probelaufText);
      process.exitCode = r.plan || r.ok ? 0 : 1;
    } else if (befehl === "phase-a") {
      const { phaseA } = await import("./phase-a.mjs");
      const { phaseAText } = await import("./bericht-schritte.mjs");
      const r = await phaseA(z, { entscheidungen, schritte: schritte.length ? schritte : null, bestaetigt: ja });
      ausgabe(r, phaseAText);
      process.exitCode = r.ok ? 0 : 1;
    } else if (befehl === "phase-b") {
      const { phaseBText, probelaufBText } = await import("./bericht-schritte.mjs");
      if (probelaufB) {
        const { probelaufB: probe } = await import("./probelauf-b.mjs");
        const r = await probe(z, { entscheidungen, bestaetigt: ja });
        ausgabe(r, probelaufBText);
        process.exitCode = r.plan || r.ok ? 0 : 1;
      } else {
        const { phaseB } = await import("./phase-b.mjs");
        const r = await phaseB(z, { entscheidungen, bestaetigt: ja });
        ausgabe(r, phaseBText);
        process.exitCode = r.ok ? 0 : 1;
      }
    } else if (befehl === "aufraeumen") {
      const { angebote, raeume } = await import("./aufraeumen.mjs");
      const { aufraeumenText } = await import("./bericht-schritte.mjs");
      const r = was ? raeume(z, { was, name, bestaetigt: ja }) : { ok: true, angebote: angebote(z) };
      ausgabe(r, aufraeumenText);
      process.exitCode = r.ok ? 0 : 1;
    } else {
      const { rueckweg } = await import("./rueckweg.mjs");
      const { rueckwegText } = await import("./bericht-schritte.mjs");
      const r = await rueckweg(z, { entscheidungen, schritte: schritte.length ? schritte : null, alles, bestaetigt: ja });
      ausgabe(r, rueckwegText);
    }
  } catch (e) {
    if (e && e.name === "UmstellungsFehler") {
      if (json) console.log(JSON.stringify({ ok: false, fehler: e.code, meldung: e.message })); else console.error(e.message);
      process.exit(e.exit || 1);
    }
    console.error(`Fehler: ${String((e && e.message) || e).split("\n")[0]}`);
    process.exit(1);
  }
}
