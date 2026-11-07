// electron/tray.mjs — das Menü des Tray-Symbols (Windows Infobereich, Linux AppIndicator; Paket W2b). Aufbau und Texte wie das Menüleisten-Menü der Mac-App (MenueInhalt.swift):
// oben der Zustand (Vault, „Nur ansehen“, Zähler), dann Studio, Schnell erfassen, Abgleichen · Vault · Einstellungen, Einrichtung · Beenden. Reine Logik OHNE `import "electron"`.
// Zähler: offene Rückfragen (Zeile wie RueckfragenText.zaehler; die Werkstatt kennt sie nur mit Kit) und neue Mitteilungen (Zahl „ungelesen“ des Aktivitätsprotokolls, wie die Glocke im Studio).

/** Wie RueckfragenText.zaehler (Swift): nie nur eine Zahl. null = unbekannt (ohne Kit gibt es die Zeile nicht, siehe baueTrayVorlage). */
export function rueckfragenText(anzahl) {
  if (anzahl === null || anzahl === undefined) return "Rückfragen: unbekannt";
  if (anzahl === 0) return "Keine Rückfragen offen";
  return anzahl === 1 ? "1 Rückfrage offen" : `${anzahl} Rückfragen offen`;
}
export function mitteilungenText(anzahl) {
  if (!anzahl) return "Keine neuen Mitteilungen";
  return anzahl === 1 ? "1 neue Mitteilung" : `${anzahl} neue Mitteilungen`;
}
const kurz = (t, max = 56) => { const e = String(t).replace(/\s+/g, " "); return e.length > max ? `${e.slice(0, max - 1)}…` : e; };

/** Tooltip des Symbols: „Kortex“, bei neuen Mitteilungen mit der Zahl. */
export const trayTitel = (z) => (z.ungelesen > 0 ? `Kortex — ${mitteilungenText(z.ungelesen)}` : "Kortex");

/**
 * z: { vaultName: string|null, nurAnsehen: boolean, rueckfragen: number|null, ungelesen: number, erfassenKuerzel?: Accelerator|null, vaultDa: boolean, updates?: boolean (gibt es Updates in dieser Ausführung) }
 * aktion: ({ befehl } | { fest }) → void (Klick). → Vorlage für Menu.buildFromTemplate.
 */
export function baueTrayVorlage(z, aktion) {
  const befehl = (id, label, name, opt = {}) => ({ id, label, click: () => aktion({ befehl: name }), ...opt });
  const fest = (id, label, was, opt = {}) => ({ id, label, click: () => aktion({ fest: was }), ...opt });
  const sep = { type: "separator" };
  const kopf = [];
  if (z.vaultName) kopf.push(befehl("tray-vault", kurz(z.vaultName), "vault-wechseln"));
  if (z.vaultDa && z.nurAnsehen) kopf.push(befehl("tray-nur-ansehen", "Nur ansehen — noch nicht als dein Vault bestätigt", "einstellungen"));
  // Zähler: Mitteilungen immer (mit Vault), Rückfragen nur, wenn die Werkstatt sie kennt (Kit vorhanden)
  if (z.vaultDa) {
    kopf.push(befehl("tray-mitteilungen", mitteilungenText(z.ungelesen), "aktivitaet"));
    if (typeof z.rueckfragen === "number") kopf.push({ id: "tray-rueckfragen", label: rueckfragenText(z.rueckfragen), click: () => aktion({ fest: "studio" }) });
  }
  return [
    ...(kopf.length ? [...kopf, sep] : []),
    fest("tray-studio", "Studio öffnen", "studio"),
    fest("tray-erfassen", "Schnell erfassen …", "erfassen", z.erfassenKuerzel ? { accelerator: z.erfassenKuerzel, registerAccelerator: false } : {}),
    befehl("tray-abgleichen", "Jetzt abgleichen", "sync", { enabled: !!z.vaultDa }),
    sep,
    befehl("tray-vault-wechseln", "Vault wechseln …", "vault-wechseln"),
    befehl("tray-vault-oeffnen", "Ordner als Vault öffnen …", "vault-oeffnen"),
    fest("tray-ordner-zeigen", "Ordner im Dateimanager zeigen", "ordner-zeigen", { enabled: !!z.vaultDa }),
    sep,
    befehl("tray-einstellungen", "Einstellungen …", "einstellungen", { enabled: !!z.vaultDa }),
    fest("tray-einrichten", "Kortex einrichten …", "einrichten"),
    fest("tray-updates", "Nach Updates suchen …", "updates", { enabled: z.updates !== false }),
    sep,
    fest("tray-beenden", "Beenden", "beenden"),
  ];
}

/** Liest den Zustand aus den Antworten der Werkstatt (/api/info, /api/aktivitaet?nur=ungelesen&limit=1, /api/rueckfragen); fehlt eine, bleibt der Wert neutral. */
export function trayZustand({ info, aktivitaet, rueckfragen }, erfassenKuerzel = null) {
  const vaultDa = typeof info?.vault === "string" && info.vault.length > 0;
  return {
    vaultDa,
    vaultName: vaultDa && typeof info.name === "string" ? info.name : null,
    nurAnsehen: vaultDa && info?.vertrauen && info.vertrauen.erlaubt === false,
    ungelesen: Number.isInteger(aktivitaet?.ungelesen) && aktivitaet.ungelesen > 0 ? aktivitaet.ungelesen : 0,
    rueckfragen: rueckfragen?.verfuegbar === true && Number.isInteger(rueckfragen.offen) ? rueckfragen.offen : null,
    erfassenKuerzel,
  };
}
