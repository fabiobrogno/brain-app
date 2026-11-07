// electron/schliessen.mjs — darf das Studiofenster jetzt schließen? Wie FensterSteuerung.darfSchliessen (Swift): die Seite sichert zuerst (`window.studio.vorSchliessen()` liefert
// {ok:true} oder {ok:false, grund}, selbst höchstens 5 s); meldet sie „nicht gespeichert“ (auch bei Zeitüberschreitung), entscheidet der Nutzer. Eine ältere Seite ohne vorSchliessen: schließen.
// Reine Logik ohne Electron (Test: Tests/Node/electron-huelle.test.mjs).
export const SKRIPT = "(async () => { if (!window.studio || typeof window.studio.vorSchliessen !== 'function') return { nicht: true }; return await window.studio.vorSchliessen(); })()";
export const FRIST_MS = 8000; // länger als die 5 s der Seite, damit deren Antwort gewinnt

/** frage(): Promise<Antwort der Seite>; rueckfrage(grund): Promise<boolean> (true = „Trotzdem schließen“); protokoll(text) → Promise<boolean> */
export async function darfSchliessen({ frage, rueckfrage, protokoll = () => {}, fristMs = FRIST_MS }) {
  let antwort;
  let timer;
  try {
    antwort = await Promise.race([
      Promise.resolve().then(frage),
      new Promise((ok) => { timer = setTimeout(() => ok({ ok: false, grund: "Das Sichern dauert zu lange." }), fristMs); }),
    ]);
  } catch (e) { protokoll(`schliessen-ohne-pruefung ${e?.message || "Fehler"}`); return true; }
  finally { clearTimeout(timer); }
  if (!antwort || typeof antwort !== "object") { protokoll("schliessen-ohne-pruefung unerwartete Antwort"); return true; }
  if (antwort.nicht === true) { protokoll("schliessen-ohne-pruefung vorSchliessen fehlt"); return true; }
  if (antwort.ok === true) return true;
  const trotzdem = await rueckfrage(typeof antwort.grund === "string" && antwort.grund ? antwort.grund : "Das Studio konnte nicht alles sichern.");
  protokoll(`schliessen-nicht-gespeichert ${trotzdem ? "trotzdem" : "abgebrochen"}`);
  return trotzdem;
}
