// electron/kuerzel.mjs — Tastenkürzel der Electron-Hülle (Paket W2b): Schreibweise des Registers → Electron-Accelerator, und die globalen Kürzel (Befehle mit `global: true`).
// Reine Logik OHNE `import "electron"`: `globalShortcut` kommt über den Parameter, die Schreibweise und Prüfung aus gemeinsam/tastenkuerzel-logik.mjs (`logik`, dieselbe Datei wie im Studio
// und in der Werkstatt). Ablauf und Antworten wie GlobaleKuerzel.swift / KuerzelSteuerung.pruefeGlobal: ein Kürzel, das nicht geht, kommt als Text zurück, das bisherige bleibt angemeldet.
// Unter Windows und Linux gilt Strg statt ⌘ (wie das Studio: ausEreignis mit mac:false bildet Strg auf Cmd ab): „Cmd“ und „Ctrl“ werden beide zu Strg.

const TASTEN = { Space: "Space", Return: "Return", Tab: "Tab", Left: "Left", Right: "Right", Up: "Up", Down: "Down", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Delete: "Delete" };

export const TEXT = Object.freeze({
  unbekannt: "Dieses Kürzel gibt es nicht.",
  taste: "Diese Taste lässt sich nicht als Kürzel verwenden.",
  belegt: "Dieses Kürzel ist schon von einem anderen Programm belegt.",
  wayland: "Unter Wayland lassen sich globale Kürzel nicht anmelden. Lege in den Einstellungen deines Desktops ein Kürzel an, das Kortex startet.",
  system: (grund) => `Dieses Kürzel nutzt das System bereits („${grund}“). Wähle ein anderes.`,
  fehler: "Das Kürzel ließ sich nicht anmelden.",
});

/** „Shift+Cmd+M“ → Accelerator von Electron („Shift+Ctrl+M“ unter Windows/Linux, „Shift+Command+M“ am Mac); null, wenn die Schreibweise nicht stimmt. */
export function acceleratorVon(text, { register, logik, plattform = process.platform }) {
  const k = logik.zerlege(text, register);
  if (!k) return null;
  if (plattform !== "darwin" && k.Ctrl && k.Cmd) return null; // Strg und ⌘ fallen dort zusammen: zwei Texte, ein Accelerator
  const teile = [];
  if (plattform === "darwin") { if (k.Ctrl) teile.push("Control"); if (k.Alt) teile.push("Alt"); if (k.Shift) teile.push("Shift"); if (k.Cmd) teile.push("Command"); }
  else { if (k.Ctrl || k.Cmd) teile.push("Ctrl"); if (k.Alt) teile.push("Alt"); if (k.Shift) teile.push("Shift"); }
  teile.push(TASTEN[k.taste] ?? k.taste);
  return teile.join("+");
}

const ANZEIGE = { Space: "Leertaste", Return: "Eingabe", Left: "←", Right: "→", Up: "↑", Down: "↓", Home: "Pos1", End: "Ende", PageUp: "Bild ↑", PageDown: "Bild ↓", Delete: "Entf" };
/** Wie das Kürzel im Fenster steht: am Mac die Zeichen (⌃⌥Leertaste), unter Windows/Linux Wörter („Strg+Alt+Leertaste“). */
export function anzeigeText(text, { register, logik, plattform = process.platform }) {
  const k = text ? logik.zerlege(text, register) : null;
  if (!k) return "";
  if (plattform === "darwin") return logik.anzeigeText(text, register);
  return [...(k.Ctrl || k.Cmd ? ["Strg"] : []), ...(k.Alt ? ["Alt"] : []), ...(k.Shift ? ["Umschalt"] : []), ANZEIGE[k.taste] ?? k.taste].join("+");
}

/** Das Kürzel, das im Menü steht: nur wenn der Befehl es hat und kein anderer Befehl Vorrang hat (ein Kürzel gehört im Menü einem Eintrag; wie KuerzelSteuerung.menueKuerzel). */
export function menueAccelerator(id, { register, logik, belegung, gewinner, plattform }) {
  const text = belegung[id] ?? null;
  if (!text || gewinner.get(text) !== id) return null;
  return acceleratorVon(text, { register, logik, plattform });
}

/**
 * Die globalen Kürzel. abh: { register, logik, globalShortcut: { register(acc, fn) → boolean, unregister(acc), isRegistered(acc) }, plattform?, wayland?: boolean, aktiv?: boolean, protokoll?(zeile) }
 * `aktiv: false` (Vorschau, Testlauf): nie ein Kürzel beim System anmelden, `pruefeGlobal` antwortet {ok:true} (wie die App im Testlauf).
 */
export function erzeugeGlobaleKuerzel(abh) {
  const { register, logik, globalShortcut } = abh;
  const plattform = abh.plattform || process.platform;
  const aktiv = abh.aktiv !== false;
  const protokoll = abh.protokoll || (() => {});
  const aktionen = new Map(); // id → () => void
  const angemeldet = new Map(); // id → { text, acc }
  const befehl = (id) => register.befehle.find((b) => b.id === id) || null;

  // Prüfung wie KuerzelPruefung.pruefe: Schreibweise, ⌃/⌘ nötig, reserviert → Text oder null
  function pruefung(text) {
    const p = logik.pruefe(register, text);
    if (p.ok) return null;
    if (p.art === "reserviert" && !/ist in Kortex fest vergeben/.test(p.text)) return TEXT.system(p.grund);
    return p.text;
  }

  // Meldet ein Kürzel beim System an → null oder Text. Ein eigenes anderes Kürzel mit derselben Taste zählt als belegt.
  function melde(id, text) {
    const acc = acceleratorVon(text, { register, logik, plattform });
    if (!acc) return TEXT.taste;
    for (const [anderes, a] of angemeldet) if (anderes !== id && a.acc === acc) return TEXT.belegt;
    const bisher = angemeldet.get(id);
    if (bisher && bisher.acc === acc) { angemeldet.set(id, { text, acc }); return null; }
    let ok;
    try { ok = globalShortcut.register(acc, () => { try { aktionen.get(id)?.(); } catch { /* ein Fehler der Aktion darf das Kürzel nicht abmelden */ } }); }
    catch { return TEXT.taste; } // ungültiger Accelerator
    if (!ok) return abh.wayland ? TEXT.wayland : TEXT.belegt;
    if (bisher) { try { globalShortcut.unregister(bisher.acc); } catch { /* weg */ } }
    angemeldet.set(id, { text, acc });
    return null;
  }

  function abmelden(id) {
    const a = angemeldet.get(id);
    if (!a) return;
    try { globalShortcut.unregister(a.acc); } catch { /* egal */ }
    angemeldet.delete(id);
  }

  /** Prüft ein Kürzel für einen globalen Befehl und meldet es an (null = abmelden) → null bei Erfolg, sonst der Text für den Nutzer. */
  function setze(id, text) {
    const b = befehl(id);
    if (!b || !b.global || !aktionen.has(id)) return TEXT.unbekannt;
    if (!aktiv) return null;
    if (text === null || text === undefined) { abmelden(id); return null; }
    const f = pruefung(text);
    if (f) return f;
    return melde(id, text);
  }

  return {
    setzeAktion(id, fn) { aktionen.set(id, fn); },
    /** Bringt alle globalen Kürzel auf die Belegung ({id: text|null}) → { id: Text } für jedes, das nicht ging. */
    wendeAn(belegung) {
      const fehler = {};
      for (const b of register.befehle) {
        if (!b.global || !aktionen.has(b.id)) continue;
        const f = setze(b.id, belegung[b.id] ?? null);
        if (f) { fehler[b.id] = f; protokoll(`kuerzel-hinweis ${b.id}`); }
      }
      for (const [id, a] of angemeldet) protokoll(`kuerzel-global ${id} ${a.text}`);
      return fehler;
    },
    /** Antwort auf die Aktion `kuerzel-global`: { ok:true } | { ok:false, text } (wie KuerzelSteuerung.pruefeGlobal) */
    pruefeGlobal(id, text) {
      const nein = (t) => ({ ok: false, text: t });
      const b = befehl(id);
      if (!b || !b.global) return nein(TEXT.unbekannt);
      if (text !== null && text !== undefined && !logik.zerlege(text, register)) return nein(TEXT.taste);
      if (!aktiv) return { ok: true }; // Vorschau oder Testlauf: nichts anmelden
      const f = setze(id, text ?? null);
      if (f) { protokoll(`kuerzel-global abgelehnt ${id}`); return nein(f); }
      protokoll(`kuerzel-global geprueft ${id} ${text ?? "aus"}`);
      return { ok: true };
    },
    angemeldet: () => Object.fromEntries([...angemeldet].map(([id, a]) => [id, a.text])),
    accelerator: (id) => angemeldet.get(id)?.acc ?? null,
    beende() { for (const id of [...angemeldet.keys()]) abmelden(id); },
  };
}
