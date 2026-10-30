// status.mjs — „brain status [--json]“: Gesamtzustand in einem Blick, für die Menüleiste der Brain-App
// (App-Spec §5.3/§10) und für Menschen. Schreibt nur abgeleitete Caches (git-ignoriert, z. B.
// .logs/pflege-bericht.json), nie Wissen; 0 Tokens. Zustand: problem (✕) > hinweis (⚠) > ok (✓).
// Hinweis: zahlen.zuTun enthält die Vorschläge bereits (so rechnet auch die App damit).
import { statSync } from "node:fs";
import { configFehler, kernVersion } from "./pfade.mjs";
import { aktuellerBericht } from "./pflege.mjs";
import { anzahlVorschlaege } from "./vorschlaege.mjs";
import { leseAutomatik } from "./einstellungen.mjs";
import { leseLetzter } from "./tageslauf/protokoll.mjs";
import { sichtbare } from "./rueckfragen.mjs";
import { umstellungHinweis } from "./umstellung/hinweis.mjs";
import { zaehle as zaehleAufgaben } from "./aufgaben.mjs";

const SYMBOL = { ok: "✓", hinweis: "⚠", problem: "✕" };

export function bewerte({ fehler, berichtFehlt, zuTun, vorschlaege }) {
  if (fehler) return "problem";
  if (berichtFehlt || zuTun > 0 || vorschlaege > 0) return "hinweis";
  return "ok";
}

export async function brainStatus(vault, { jetzt = Date.now(), support } = {}) {
  const meldungen = [];
  let fehler = false, berichtFehlt = false;
  const version = kernVersion();
  let istOrdner = false;
  try { istOrdner = statSync(vault).isDirectory(); } catch { /* fehlt */ }
  if (!istOrdner) {
    fehler = true;
    meldungen.push("Der Vault-Ordner wurde nicht gefunden.");
  }
  if (configFehler(vault)) {
    fehler = true;
    meldungen.push("Die Einstellungsdatei brain.config.json ist beschädigt — sag „repariere meine Kortex-Einstellungen“.");
  }
  let vorschlaege = 0, konflikte = 0, abgelaufen = 0, zuTun = 0;
  try { vorschlaege = anzahlVorschlaege(vault); } catch { /* ohne Vorschlagsordner: 0 */ }
  try {
    const b = await aktuellerBericht(vault, { jetzt });
    const zahl = (s) => b.posten.find((p) => p.schluessel === s)?.anzahl ?? 0;
    konflikte = zahl("konflikte");
    abgelaufen = zahl("abgelaufen");
    zuTun = b.zuTun ?? 0;
  } catch {
    berichtFehlt = true;
    meldungen.push("Der Pflegebericht konnte gerade nicht erstellt werden.");
  }
  let rueckfragen = 0, tageslauf = null;
  try {
    const s = sichtbare(vault, { jetzt, nutzung: new Map() });
    rueckfragen = s.fragen.length + s.wartend;
    const l = leseLetzter(vault);
    tageslauf = { schalter: leseAutomatik(vault).werte.tageslauf, modus: l?.modus ?? null, status: l?.status ?? null, zeit: l?.zeit ?? null,
      letzterErfolg: l?.letzterErfolg ?? null, autostufe: l?.autostufe ?? "normal", lernmodus: l?.lernmodus === true, fehlerquote: l?.fehlerquote ?? null, zahlen: l?.zahlen ?? null };
  } catch { /* Status bleibt ohne Tageslauf-Block */ }
  // P7c: Vault aus der Kit-Zeit (alter Werkzeug-Ordner liegt noch im Vault, Phase A nicht durch) → Menüleiste bietet „Vault umstellen …“ an
  let umstellung = { altlasten: false, phase: null };
  try { umstellung = umstellungHinweis(vault, support ? { support } : {}); } catch { /* ohne Hinweis */ }
  // Aufgaben (aufgaben.mjs): offene und überfällige für die Menüleiste; ohne Aufgaben-Ordner 0/0
  let aufgaben = { offen: 0, ueberfaellig: 0 };
  try { aufgaben = zaehleAufgaben(vault); } catch { /* bleibt 0 */ }
  return {
    version, quellVault: false,   // Feld bleibt für die App (Status-Modell); den Entwickler-Vault gibt es im Kern-Umzug nicht mehr
    zustand: bewerte({ fehler, berichtFehlt, zuTun, vorschlaege }),
    meldungen, zahlen: { vorschlaege, konflikte, abgelaufen, zuTun, rueckfragen }, tageslauf, umstellung, aufgaben,
  };
}

export function statusText(s) {
  const z = s.zahlen;
  return [
    `${SYMBOL[s.zustand] || "?"} Kortex ${s.version}`,
    `Vorschläge: ${z.vorschlaege} · Konflikte: ${z.konflikte} · abgelaufen: ${z.abgelaufen} · zu tun: ${z.zuTun}`,
    ...(s.tageslauf && s.tageslauf.schalter !== "aus"
      ? [`Tageslauf: ${s.tageslauf.schalter} · zuletzt ${s.tageslauf.zeit ? s.tageslauf.zeit.slice(0, 10) : "noch nie"}${s.tageslauf.status ? ` (${s.tageslauf.status})` : ""} · Rückfragen offen: ${z.rueckfragen ?? 0} · Autostufe ${s.tageslauf.autostufe}${s.tageslauf.lernmodus ? " (Lernmodus)" : ""}`]
      : []),
    ...(s.aufgaben && s.aufgaben.offen > 0 ? [`Aufgaben: ${s.aufgaben.offen} offen${s.aufgaben.ueberfaellig > 0 ? ` · ${s.aufgaben.ueberfaellig} überfällig` : ""}`] : []),
    ...s.meldungen,
  ].join("\n");
}
