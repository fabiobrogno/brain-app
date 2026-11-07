// electron/menue.mjs — das App-Menü der Electron-Hülle (Paket W2b). Aufbau und Texte wie das Hauptmenü der Mac-App (BrainApp.swift: Ablage, Darstellung, Gehe zu, Fenster), auf Deutsch.
// Die Kürzel stehen NICHT hier: jeder Eintrag, der einen Studio-Befehl auslöst, nennt nur dessen Menü-Namen (`menue` im Register, StudioBefehl.rawValue); das Kürzel kommt aus dem Register
// plus eigener Belegung (tastenkuerzel.json), unter Windows/Linux mit Strg statt ⌘. Die festen Einträge (Beenden, Kortex einrichten …, Studio) nehmen ihr Kürzel aus den `reserviert`-Einträgen
// des Registers (Cmd+Q, Cmd+E, Alt+Cmd+1 …). Reine Logik OHNE `import "electron"`: `aktion` bekommt { befehl } | { fest } beim Klick.
// Die Kürzel der Studio-Befehle gelten im Studio selbst (Tastendruck in der Seite); das Menü zeigt sie nur an (registerAccelerator: false), damit ein Druck nie doppelt wirkt; die festen Einträge (Beenden, Schließen, Einrichten, Studio, Erfassen) kennt das Studio nicht: dort meldet das Menü das Kürzel selbst an und ein Befehl ohne offenen Vault
// nicht am Studio vorbei ausgelöst wird. Am Mac (nur für die Entwicklung) gilt der Accelerator wie bei jedem Programm.
import { acceleratorVon, menueAccelerator } from "./kuerzel.mjs";

// Der Aufbau: [Titel, [Eintrag …]]; Eintrag = [Text, Menü-Name des Studio-Befehls] | [Text, { fest }] | "-"
const STRUKTUR = [
  ["Ablage", [
    ["Neue Notiz", "neu"], ["Neue Notiz aus Vorlage …", "vorlage"], ["Heute (Tagesnotiz)", "heute"], ["Schnell merken", "merken"], ["Aufgabe erfassen …", "aufgabe-erfassen"],
    ["Schnell erfassen …", { fest: "erfassen", kuerzelId: "schnell-erfassen" }], "-",
    ["Vault öffnen …", "vault-oeffnen"], ["Vault wechseln …", "vault-wechseln"], "-",
    ["Einstellungen …", "einstellungen"], ["Kortex einrichten …", { fest: "einrichten", grund: "Kortex einrichten" }], ["Nach Updates suchen …", { fest: "updates" }], "-",
    ["Fenster schließen", { fest: "schliessen", grund: "Fenster schließen" }], ["Beenden", { fest: "beenden", grund: "Kortex beenden" }],
  ]],
  ["Darstellung", [
    ["Eigenschaften ein-/ausblenden", "infospalte"], ["Verlauf ein-/ausblenden", "verlauf"], "-", ["Hell/Dunkel umschalten", "hell-dunkel"], "-",
    ["Vergrößern", { rolle: "zoomIn" }], ["Verkleinern", { rolle: "zoomOut" }], ["Originalgröße", { rolle: "resetZoom" }], "-", ["Vollbild", { rolle: "togglefullscreen" }],
  ]],
  ["Gehe zu", [
    ["Posteingang", "posteingang"], ["Alle Notizen", "alle"], ["Wissen", "wissen"], ["Aufgaben", "aufgaben"], "-",
    ["Zurück", "zurueck"], ["Vor", "vor"], "-", ["Befehlspalette", "palette"],
  ]],
  ["Fenster", [
    ["Studio", { fest: "studio", grund: "Studio öffnen" }], "-", ["Minimieren", { rolle: "minimize" }],
  ]],
];

/** Namen (Menü-Namen des Registers), die das Menü auslöst — für den Test, dass jeder im Register steht. */
export const MENUE_BEFEHLE = STRUKTUR.flatMap(([, eintraege]) => eintraege.filter((e) => e !== "-" && typeof e[1] === "string").map((e) => e[1]));

/**
 * → Vorlage für Menu.buildFromTemplate. abh: { register, logik, belegung ({id: text|null}), plattform?, entwickler?, updates? (gibt es Updates in dieser Ausführung), aktion({befehl}|{fest}) }
 * Ids der Einträge: `befehl-<name>` bzw. `fest-<name>` (Tests und Aktualisierung finden sie so).
 */
export function baueMenueVorlage({ register, logik, belegung, plattform = process.platform, entwickler = false, updates = true, aktion }) {
  const gewinner = logik.nachschlagen(register, ueberschriebenAus(register, belegung));
  const ctx = { register, logik, belegung, gewinner, plattform };
  const zeigeNur = plattform !== "darwin" ? { registerAccelerator: false } : {};
  const reserviert = (grund) => register.reserviert?.find((r) => r.grund === grund)?.kuerzel ?? null;

  function eintrag([text, was]) {
    if (typeof was === "string") {
      const b = register.befehle.find((x) => x.menue === was);
      const acc = b ? menueAccelerator(b.id, ctx) : null;
      return { id: `befehl-${was}`, label: text, ...(acc ? { accelerator: acc, ...zeigeNur } : {}), click: () => aktion({ befehl: was }) };
    }
    if (was.rolle) return { id: `rolle-${was.rolle}`, label: text, role: was.rolle };
    let acc = null;
    if (was.kuerzelId) acc = menueAccelerator(was.kuerzelId, ctx);
    else if (was.grund && reserviert(was.grund)) acc = acceleratorVon(reserviert(was.grund), { register, logik, plattform });
    // „Nach Updates suchen …“ wie in der Mac-App (Sparkle): in der Entwicklung und in der Vorschau ausgegraut
    const aus = was.fest === "updates" && !updates ? { enabled: false } : {};
    return { id: `fest-${was.fest}`, label: text, ...(acc ? { accelerator: acc, ...(was.kuerzelId ? zeigeNur : {}) } : {}), ...aus, click: () => aktion({ fest: was.fest }) };
  }

  const menues = STRUKTUR.map(([titel, eintraege]) => ({
    id: `menue-${titel.toLowerCase().replace(/\s+/g, "-")}`, label: titel,
    submenu: [...eintraege.map((e) => (e === "-" ? { type: "separator" } : eintrag(e))),
      ...(titel === "Darstellung" && entwickler ? [{ type: "separator" }, { id: "rolle-toggleDevTools", label: "Entwicklerwerkzeuge", role: "toggleDevTools" }] : [])],
  }));
  // Am Mac (nur Entwicklung) braucht das Menü das Standard-Menü der App und „Bearbeiten“ (Kopieren/Einsetzen); unter Windows/Linux gehören Strg+C/V/Z dem Editor.
  if (plattform === "darwin") return [{ role: "appMenu" }, { role: "editMenu" }, ...menues];
  return menues;
}

// Die eigene Belegung ist nur die Abweichung vom Standard; `nachschlagen` rechnet mit der Abweichung. Aus der fertigen Belegung wird sie hier zurückgewonnen.
function ueberschriebenAus(register, belegung) {
  const o = {};
  for (const b of register.befehle) if ((belegung[b.id] ?? null) !== (b.standard ?? null)) o[b.id] = belegung[b.id] ?? null;
  return o;
}
