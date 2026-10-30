// Live-Aktualisierung (Studio-Seite): hält einen Long-Poll auf GET /api/ereignisse offen und reicht Ereignisse der Werkstatt weiter.
// Die Werkstatt beobachtet den Vault (werkstatt/ereignisse.mjs); hier wird nur zugehört — gezeichnet wird in app.js über die bestehenden Wege.
import { kiKurzname } from "./ki-logos.js";
import { TL } from "./texte-live.js";

const KI_QUELLE = /^ki:/;

// Wartet in einer Schleife auf Ereignisse. beiEreignisse(liste) und beiAlles() (Nummer verpasst, anderer Vault, Dauerfeuer) bekommen die Meldungen;
// Fehler (Werkstatt weg, Fenster zu) führen zu wachsenden Pausen, nie zu einer engen Schleife. neuStarten() beginnt mit einem frischen Stand (Vault-Wechsel).
export function starteLive({ api, beiEreignisse, beiAlles, beiBereit, warteS = 25, pauseMs = [1000, 2000, 5000, 10000] }) {
  let lauf = 0, tot = false;
  const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
  async function schleife(meiner) {
    let seit = null, epoche = null, fehler = 0;
    while (!tot && meiner === lauf) {
      let r;
      try { r = await api.ereignisse(seit, epoche, seit === null ? 0 : warteS); }
      catch (e) {
        if (meiner !== lauf) return;
        if (e?.status === 404 || e?.status === 405) return; // ältere Werkstatt ohne Ereignisse: es bleibt bei den bisherigen Wegen
        if (e?.status === 409) { await pause(2000); continue; } // noch kein Vault geöffnet
        await pause(pauseMs[Math.min(fehler++, pauseMs.length - 1)]);
        continue;
      }
      if (meiner !== lauf) return;
      fehler = 0;
      if (!r || typeof r.aktuell !== "number") { await pause(pauseMs[1]); continue; }
      const erster = seit === null;
      seit = r.aktuell; epoche = r.epoche || null;
      if (erster) { try { beiBereit?.(); } catch { /* egal */ } continue; } // Grundstand gemerkt; ab jetzt wird gewartet
      try {
        if (r.verpasst) beiAlles();
        else if (Array.isArray(r.ereignisse) && r.ereignisse.length) {
          if (r.ereignisse.some((e) => e.typ === "alles")) beiAlles(); else beiEreignisse(r.ereignisse);
        }
      } catch { /* ein Fehler beim Zeichnen darf das Zuhören nie beenden */ }
    }
  }
  const los = () => { lauf++; schleife(lauf); };
  los();
  return { neuStarten: los, stopp: () => { tot = true; lauf++; } };
}

// Ereignisse → was zu tun ist (rein, damit es sich ohne Oberfläche testen lässt):
//   { index, aufgaben, git, info, konten, menue, strukturell (Datei angelegt/entfernt/verschoben, Ordner: der Teil-Index reicht nicht), pfade (zum Hervorheben), ki: [{ quelle, titel }] }
export function planeAus(ereignisse) {
  const p = { index: false, aufgaben: false, git: false, info: false, konten: false, menue: false, strukturell: false, pfade: [], ki: [] };
  for (const e of ereignisse) {
    switch (e.typ) {
      case "aufgabe": p.index = p.aufgaben = p.menue = true; if (e.art !== "geaendert") p.strukturell = true; break;
      case "notiz": case "posteingang": p.index = p.menue = true; if (e.art !== "geaendert") p.strukturell = true; break;
      case "git": p.git = p.menue = true; break;
      case "vertrauen": p.info = p.git = p.aufgaben = p.menue = true; break;
      case "konten": p.konten = true; break;
      default: break;
    }
    if (e.pfad && e.art !== "entfernt" && e.art !== "ordner" && !p.pfade.includes(e.pfad)) p.pfade.push(e.pfad);
    if (e.typ === "aufgabe" && e.art === "angelegt" && KI_QUELLE.test(String(e.quelle || ""))) p.ki.push({ quelle: String(e.quelle), titel: e.titel || TL.aufgabeOhneTitel });
  }
  return p;
}

// Text für den Hinweis „Claude hat eine Aufgabe angelegt: …“ (null = nichts zu melden). Mehrere Aufgaben werden gebündelt.
export function kiHinweis(ki) {
  if (!ki.length) return null;
  const namen = new Set(ki.map((k) => k.quelle));
  const id = ki[0].quelle.slice(3);
  const name = namen.size === 1 ? (kiKurzname(id) || id.replace(/^./, (c) => c.toUpperCase())) : null;
  return TL.aufgabeAngelegt(name, ki.map((k) => k.titel));
}

// Karten, deren Pfad gemeldet wurde, kurz hervorheben (Klasse live-neu, nach 2,5 s wieder weg). wurzel: Element, in dem gesucht wird.
export function hebeHervor(wurzel, pfade) {
  if (!wurzel || !pfade.length) return;
  const el = [];
  for (const p of pfade) for (const k of wurzel.querySelectorAll(`[data-pfad="${CSS.escape(p)}"]`)) if (k.matches("[data-karte], [data-karte-aufgabe]")) el.push(k);
  for (const k of el) { k.classList.remove("live-neu"); void k.offsetWidth; k.classList.add("live-neu"); }
  setTimeout(() => el.forEach((k) => k.classList.remove("live-neu")), 2500);
}
