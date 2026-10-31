// ERZEUGT von scripts/erzeuge-tastenkuerzel.mjs aus Ressourcen/gemeinsam/tastenkuerzel-logik.mjs — nicht von Hand ändern.
// Tastenkürzel (Paket P10): die reine Logik — Schreibweise, Anzeige, Tastendruck → Kürzel, Konflikte, reservierte Kürzel, wirksame Belegung.
// Ohne DOM und ohne Zustand (läuft auch in Node: Tests/Node/tastenkuerzel.test.mjs und die Werkstatt prüft damit ihre Eingaben). Das Register der Befehle
// (Ressourcen/gemeinsam/tastenkuerzel-register.json, im Studio als tastenkuerzel-register.js) wird immer als Parameter übergeben.
// Schreibweise (gespeichert in <Support>/tastenkuerzel.json): „Ctrl+Alt+Shift+Cmd+Taste“ in genau dieser Reihenfolge, Taste = A–Z, 0–9, Satzzeichen oder ein Name aus
// register.tasten (Space, Return, Left …). Die Konfliktprüfung folgt dem Ablauf von Orca (src/shared/keybindings @9bccd67, MIT, Lovecast Inc.): ein belegtes Kürzel
// meldet, zu welchem Befehl es schon gehört; wer es trotzdem nimmt, behält beide Zuordnungen, die geänderte hat Vorrang.

export const UMSCHALTER = [["Ctrl", "⌃"], ["Alt", "⌥"], ["Shift", "⇧"], ["Cmd", "⌘"]];
const ANZEIGE_TASTE = { Space: "Leertaste", Return: "Return", Tab: "Tab", Left: "←", Right: "→", Up: "↑", Down: "↓", Home: "Pos1", End: "Ende", PageUp: "Bild ↑", PageDown: "Bild ↓", Delete: "Entf" };
const CODE_ZU_TASTE = {
  Space: "Space", Enter: "Return", NumpadEnter: "Return", Tab: "Tab", ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down",
  Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Delete: "Delete",
  Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Minus: "-", Equal: "=", Backquote: "`",
  NumpadDecimal: ".", NumpadDivide: "/", NumpadSubtract: "-", NumpadComma: ",",
};
const REIHE = ["Ctrl", "Alt", "Shift", "Cmd"];

export const tastenMenge = (register) => new Set(register.tasten);

// "Shift+Cmd+M" → { Ctrl, Alt, Shift, Cmd: bool, taste } oder null (nicht in der festen Schreibweise)
export function zerlege(text, register) {
  if (typeof text !== "string" || !text || text.length > 40) return null;
  const teile = text.split("+");
  // „Cmd++“ gibt es nicht: das Pluszeichen ist keine erlaubte Taste, und ein leeres Teil am Ende wäre eines
  const taste = teile.pop();
  if (!taste || !tastenMenge(register).has(taste)) return null;
  const k = { Ctrl: false, Alt: false, Shift: false, Cmd: false, taste };
  let letzter = -1;
  for (const t of teile) {
    const i = REIHE.indexOf(t);
    if (i < 0 || i <= letzter) return null; // unbekannt, doppelt oder in falscher Reihenfolge
    k[t] = true; letzter = i;
  }
  return k;
}
export const formatiere = (k) => [...REIHE.filter((u) => k[u]), k.taste].join("+");
// Gleiche Schreibweise zurückgeben, wenn text genau so gültig ist; sonst null
export const normalisiere = (text, register) => { const k = zerlege(text, register); return k ? formatiere(k) : null; };

// Ein Kürzel muss ⌃ oder ⌘ enthalten: ⌥ und ⇧ allein erzeugen beim Tippen selbst Zeichen und würden das Schreiben stören.
export const brauchtUmschalter = (k) => !(k.Ctrl || k.Cmd);

export function anzeigeTeile(text, register) {
  const k = zerlege(text, register);
  if (!k) return [];
  return [...UMSCHALTER.filter(([n]) => k[n]).map(([, z]) => z), ANZEIGE_TASTE[k.taste] || k.taste];
}
export const anzeigeText = (text, register) => anzeigeTeile(text, register).join("");

// Taste eines Tastaturereignisses (KeyboardEvent.key/.code) in der festen Schreibweise; null bei reinen Umschalttasten, Esc, Rücktaste und Unbekanntem.
// Buchstaben folgen dem Zeichen auf der Taste (⌘Z auf einer deutschen Tastatur ist das Z, das man sieht), sonst — mit ⌥ ergibt die Taste ein anderes Zeichen — dem Ort der Taste.
// physisch: Ort statt Zeichen (für globale Kürzel: macOS meldet sie nach dem Ort der Taste, nicht nach dem Zeichen).
export function tasteVon(e, { physisch = false } = {}) {
  const c = e.code || "", z = e.key || "";
  let m;
  if ((m = /^Key([A-Z])$/.exec(c))) return !physisch && /^[a-zA-Z]$/.test(z) ? z.toUpperCase() : m[1];
  if ((m = /^(?:Digit|Numpad)([0-9])$/.exec(c))) return m[1];
  if (CODE_ZU_TASTE[c]) return CODE_ZU_TASTE[c];
  if (/^F([1-9]|1[0-9]|20)$/.test(c)) return c;
  if (/^F([1-9]|1[0-9]|20)$/.test(z)) return z;
  if (!c && z.length === 1) { const g = z.toUpperCase(); return /^[A-Z0-9]$/.test(g) ? g : ",./;'[]\\-=`".includes(z) ? z : null; } // Ereignis ohne code (synthetisch)
  return null;
}

// Tastendruck → { Ctrl, Alt, Shift, Cmd, taste|null }. mac: ⌘ = Meta; sonst gilt Strg als ⌘ (die Oberfläche läuft auch im Browser)
export function ausEreignis(e, { mac = true, physisch = false } = {}) {
  return { Ctrl: mac && !!e.ctrlKey, Alt: !!e.altKey, Shift: !!e.shiftKey, Cmd: mac ? !!e.metaKey : !!e.ctrlKey, taste: tasteVon(e, { physisch }) };
}
export const ereignisText = (e, opt) => { const k = ausEreignis(e, opt); return k.taste ? formatiere(k) : null; };

// Was bisher gedrückt ist, für die Anzeige während der Aufnahme: ["⌃", "⌥"] plus die Taste, falls schon eine da ist
export function aufnahmeTeile(e, opt) {
  const k = ausEreignis(e, opt);
  return [...UMSCHALTER.filter(([n]) => k[n]).map(([, z]) => z), ...(k.taste ? [ANZEIGE_TASTE[k.taste] || k.taste] : [])];
}

// ---- Belegung: Register (Standard) + Gespeichertes ({ id: "Cmd+T" | null }; fehlt = Standard, null = ohne Kürzel)
export function wirksam(register, ueberschrieben = {}) {
  const b = {};
  for (const bef of register.befehle) {
    const eigen = Object.hasOwn(ueberschrieben, bef.id) ? ueberschrieben[bef.id] : undefined;
    b[bef.id] = eigen === undefined ? (bef.standard ?? null) : eigen;
  }
  return b;
}
export const istGeaendert = (register, ueberschrieben, id) => {
  const bef = register.befehle.find((x) => x.id === id);
  return !!bef && Object.hasOwn(ueberschrieben, id) && (ueberschrieben[id] ?? null) !== (bef.standard ?? null);
};

// Wer gewinnt, wenn zwei Befehle dasselbe Kürzel haben: ein geänderter vor einem unveränderten, dann die Reihenfolge im Register.
export function reihenfolge(register, ueberschrieben = {}) {
  const geaendert = register.befehle.filter((b) => istGeaendert(register, ueberschrieben, b.id));
  return [...geaendert, ...register.befehle.filter((b) => !geaendert.includes(b))];
}
// Kürzel (Text) → Befehls-id des Gewinners
export function nachschlagen(register, ueberschrieben = {}) {
  const b = wirksam(register, ueberschrieben), m = new Map();
  for (const bef of reihenfolge(register, ueberschrieben)) { const k = b[bef.id]; if (k && !m.has(k)) m.set(k, bef.id); }
  return m;
}

// Welche anderen Befehle haben dieses Kürzel schon? (Namen und ids, in Register-Reihenfolge)
export function konflikte(register, belegung, id, kuerzel) {
  if (!kuerzel) return [];
  return register.befehle.filter((b) => b.id !== id && belegung[b.id] === kuerzel).map((b) => ({ id: b.id, name: b.name }));
}
export const konfliktIds = (register, belegung) => {
  const ids = new Set();
  for (const b of register.befehle) if (b.id && belegung[b.id] && konflikte(register, belegung, b.id, belegung[b.id]).length) ids.add(b.id);
  return ids;
};
// „⌘K gehört schon zu „Befehlspalette“.“ — bei mehreren: „… zu „A“ und „B“.“
export function konfliktText(anzeige, liste) {
  const namen = liste.map((x) => `„${x.name}“`);
  const wer = namen.length <= 1 ? namen[0] : `${namen.slice(0, -1).join(", ")} und ${namen[namen.length - 1]}`;
  return `${anzeige} gehört schon zu ${wer}.`;
}

// Reserviert (von macOS oder von den Standardmenüs besetzt)? → Grund oder null
export const reserviertGrund = (register, kuerzel) => (register.reserviert || []).find((r) => r.kuerzel === kuerzel)?.grund || null;
const reserviertVon = (register, kuerzel) => (register.reserviert || []).find((r) => r.kuerzel === kuerzel)?.von || "macOS";

// Darf dieses Kürzel für diesen Befehl gelten? → { ok: true, kuerzel } | { ok: false, art: "ungueltig"|"umschalter"|"reserviert", text }
export function pruefe(register, kuerzelText) {
  const k = zerlege(kuerzelText, register);
  if (!k) return { ok: false, art: "ungueltig", text: "Diese Taste lässt sich nicht als Kürzel verwenden." };
  const kurz = formatiere(k);
  if (brauchtUmschalter(k)) return { ok: false, art: "umschalter", text: "Bitte mit ⌃ (Control) oder ⌘ (Befehl) kombinieren, sonst stört das Kürzel beim Schreiben." };
  const grund = reserviertGrund(register, kurz);
  if (grund) {
    const a = anzeigeText(kurz, register);
    return { ok: false, art: "reserviert", grund, text: reserviertVon(register, kurz) === "Kortex" ? `${a} ist in Kortex fest vergeben („${grund}“).` : `${a} gehört macOS („${grund}“) und lässt sich nicht belegen.` };
  }
  return { ok: true, kuerzel: kurz };
}

// Das gespeicherte Objekt säubern: nur bekannte ids, gültige Schreibweisen oder null; alles andere fällt weg (nie ein Fehler beim Lesen)
export function saeubere(register, roh) {
  const ids = new Set(register.befehle.map((b) => b.id)), aus = {};
  if (!roh || typeof roh !== "object" || Array.isArray(roh)) return aus;
  for (const [id, w] of Object.entries(roh)) {
    if (!ids.has(id)) continue;
    if (w === null) aus[id] = null;
    else if (typeof w === "string") { const n = normalisiere(w, register); if (n) aus[id] = n; }
  }
  return aus;
}

// Die Abschnitte des Bereichs „Tastenkürzel“ der Einstellungen (eine Zeile je Befehl, nach Gruppen), damit auch die Suche der Seite die Befehle findet.
// Die Zeilen tragen `kuerzelId`; einstellungen-tasten.js baut daraus die Bedienung.
export function abschnitteAusRegister(register) {
  return register.gruppen.map((g) => ({
    id: g.id, titel: g.name, text: g.text,
    zeilen: register.befehle.filter((b) => b.gruppe === g.id).map((b) => ({ id: `kz-${b.id}`, sonder: true, kuerzelId: b.id, titel: b.name, text: b.text, woerter: [...(b.woerter || []), "kürzel", "taste", "tastenkürzel", "shortcut"] })),
  })).filter((a) => a.zeilen.length);
}
