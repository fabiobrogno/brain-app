// werkstatt/anmelden.mjs — die Routen „Anmelden im Fenster“ (Paket E3): start → Kennung, Stand abfragen, Code senden, abbrechen.
// Die Arbeit macht gemeinsam/anmeldung.mjs (Kindprozess, Umgebung, Fristen); hier sitzen Regeln, Konten und Aufräumen:
//  - nur bekannte Programme (claude, codex) und nur bekannte Konten (Kennung aus der Liste) oder ein NEUES Konto mit Namen;
//  - ein NEUES Konto legt `konten.legeKontoAn` (E4: POST /api/ki/konto-neu) gleich unter seinem ENDGÜLTIGEN Namen an, als „ausstehend“. Die Anmeldung läuft immer mit genau diesem Pfad
//    (Claude Code legt sie vermutlich unter einem vom Pfad abhängigen Namen im Schlüsselbund ab — nie umbenennen). Erst die bestätigte Anmeldung ruft `konten.kontoFertig` (POST /api/ki/konto-fertig),
//    Abbruch, Frist und Fehler rufen `konten.kontoAbbruch` (räumt Ordner und Eintrag weg);
//  - höchstens eine laufende Anmeldung je Konto, höchstens 4 gleichzeitig, höchstens 8 Starts je Minute;
//  - Antworten enthalten nur feste Felder (Phase, Adresse, Gerätecode, Restzeit, Grund, Konto); nie Ausgabe des Programms, nie Pfade.
import { statSync } from "node:fs";
import { HttpFehler, falte } from "../gemeinsam/basis.mjs";
import { findeProgramm as sucheProgramm } from "../gemeinsam/ki.mjs";
import { starteAnmeldung, PROGRAMME } from "../gemeinsam/anmeldung.mjs";

const NAECHSTE_MIN = 8, GLEICHZEITIG = 4, NACHLAUF_MS = 5 * 60_000;

export function erzeugeAnmelden({ konten, findeProgramm = (p) => sucheProgramm(p), basisUmgebung = () => process.env, starter = starteAnmeldung, optionen = {}, protokoll = null, jetzt = Date.now } = {}) {
  const laeufe = new Map(); // id → { sitzung, schluessel, programm, neu: {pfad,name}|null, konto: id|null, ergebnis: null|{konto,phase,grund} , beendet: ms|null }
  const aktiv = new Map(); // schluessel → id
  let starts = []; // Zeitpunkte (Drossel)
  const neueId = () => `a_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
  const log = (e) => { try { protokoll?.(e); } catch { /* Beiwerk */ } };

  const ordnerOk = (pfad) => { try { const st = statSync(pfad); return st.isDirectory() && (typeof process.getuid !== "function" || st.uid === process.getuid()) && (st.mode & 0o002) === 0; } catch { return false; } };

  function raeume() { // beendete Läufe nach der Nachlaufzeit vergessen
    for (const [id, l] of laeufe) if (l.beendet && jetzt() - l.beendet > NACHLAUF_MS) laeufe.delete(id);
  }

  function start(e) {
    raeume();
    if (!e || typeof e !== "object") throw new HttpFehler(400, "Die Anfrage war nicht lesbar.");
    if (!PROGRAMME.includes(e.programm)) throw new HttpFehler(400, "Anmelden im Fenster gibt es nur für Claude Code und Codex.", { art: "programm" });
    const hatKonto = e.konto !== undefined && e.konto !== null, hatNeu = e.neu !== undefined && e.neu !== null;
    if (hatKonto === hatNeu) throw new HttpFehler(400, "Nenne entweder ein Konto aus der Liste oder den Namen eines neuen Kontos.", { art: "ziel" });
    const jetztMs = jetzt();
    starts = starts.filter((t) => jetztMs - t < 60_000);
    if (starts.length >= NAECHSTE_MIN) throw new HttpFehler(429, "Das waren zu viele Anmeldungen kurz hintereinander. Warte eine Minute und versuche es noch einmal.", { art: "zu-oft" });
    if (aktiv.size >= GLEICHZEITIG) throw new HttpFehler(429, "Es laufen schon mehrere Anmeldungen. Schließe eine ab oder breche sie ab.", { art: "zu-viele" });

    let schluessel, ordner = null, neu = null, kontoId = null, name = null;
    if (hatKonto) {
      if (typeof e.konto !== "string") throw new HttpFehler(400, "Die Konto-Kennung fehlt.");
      const k = konten.kontoDaten(e.konto) || (typeof konten.ausstehendDaten === "function" ? konten.ausstehendDaten(e.konto) : null); // auch ein noch ausstehendes neues Konto (E4)
      if (!k || k.programm !== e.programm) throw new HttpFehler(404, "Dieses KI-Konto gibt es nicht (mehr). Suche die Konten bitte neu.", { art: "konto" });
      kontoId = e.konto; schluessel = `k:${kontoId}`;
      ordner = k.standard === true ? null : k.ordner;
      if (ordner && !ordnerOk(ordner)) throw new HttpFehler(409, "Der Ordner dieses Kontos fehlt oder gehört dir nicht. Suche die Konten bitte neu.", { art: "ordner", rueckfall: true });
    } else {
      if (typeof e.neu !== "string") throw new HttpFehler(400, "Der Name des neuen Kontos fehlt.");
      name = e.neu; schluessel = `n:${e.programm}:${falte(String(name).trim())}`;
    }
    if (aktiv.has(schluessel)) throw new HttpFehler(409, "Für dieses Konto läuft schon eine Anmeldung.", { art: "laeuft-schon", id: aktiv.get(schluessel) });
    const pfad = findeProgramm(e.programm);
    if (!pfad) throw new HttpFehler(409, e.programm === "claude" ? "Claude Code wurde nicht gefunden." : "Codex wurde nicht gefunden.", { art: "nicht-gefunden", rueckfall: true });

    if (hatNeu) {
      if (typeof konten.kontoFertig !== "function" || typeof konten.kontoAbbruch !== "function") throw new HttpFehler(503, "Ein neues Konto lässt sich in dieser Version noch nicht im Fenster anmelden.", { art: "nicht-verfuegbar", rueckfall: true });
      const r = konten.legeKontoAn({ programm: e.programm, name }); // prüft Name, Doppelte, Ort; legt den Ordner unter dem endgültigen Namen an, Konto „ausstehend“
      const info = r && (r.ausstehend || r.neuesKonto);
      if (!info || typeof info.id !== "string" || typeof info.pfad !== "string") throw new HttpFehler(500, "Das neue Konto ließ sich nicht vorbereiten.");
      neu = { id: info.id, pfad: info.pfad }; ordner = neu.pfad; name = String(name).trim();
    }
    let sitzung;
    try {
      sitzung = starter({ programm: e.programm, programmPfad: pfad, ordner, basisUmgebung: basisUmgebung(), protokoll: (x) => log(x), ...optionen });
    } catch (err) {
      if (neu) { try { konten.kontoAbbruch({ id: neu.id }); } catch { /* Beiwerk */ } }
      throw new HttpFehler(503, "Die Anmeldung ließ sich nicht starten.", { art: "start", rueckfall: true });
    }
    starts.push(jetztMs);
    const id = neueId();
    const lauf = { sitzung, schluessel, programm: e.programm, neu, konto: kontoId, name, ergebnis: null, beendet: null };
    laeufe.set(id, lauf); aktiv.set(schluessel, id);
    sitzung.ende.then((z) => abschluss(id, lauf, z)).catch(() => abschluss(id, lauf, { phase: "error", grund: "programm-fehler", rueckfall: true }));
    return { ok: true, id, ...oeffentlich(lauf) };
  }

  // Nach dem Ende: bei Erfolg das Konto eintragen/veröffentlichen, sonst den neuen Ordner wegräumen.
  function abschluss(id, lauf, z) {
    if (lauf.beendet) return;
    let phase = z.phase, grund = z.grund, rueckfall = z.rueckfall;
    let konto = null;
    try {
      if (phase === "ok") {
        if (lauf.neu) {
          konten.kontoFertig({ id: lauf.neu.id });
          konto = { id: lauf.neu.id, programm: lauf.programm, name: lauf.name };
          lauf.neu = null;
        } else if (lauf.konto) {
          try { konten.anmeldung({ konto: lauf.konto, zustand: "angemeldet" }); } catch { /* der Vermerk ist Beiwerk */ }
          konto = { id: lauf.konto, programm: lauf.programm };
        }
      }
    } catch (err) {
      phase = "error"; grund = "konto-nicht-angelegt"; rueckfall = false; konto = null;
    }
    if (lauf.neu) { try { konten.kontoAbbruch({ id: lauf.neu.id }); } catch { /* Beiwerk */ } lauf.neu = null; } // Abbruch, Frist, Fehler: nichts bleibt liegen
    lauf.ergebnis = { phase, grund: grund || null, rueckfall: !!rueckfall, konto };
    lauf.beendet = jetzt();
    if (aktiv.get(lauf.schluessel) === id) aktiv.delete(lauf.schluessel);
    log({ ereignis: "abschluss", programm: lauf.programm, phase, grund: grund || null });
  }

  function oeffentlich(lauf) {
    const z = lauf.sitzung.zustand();
    const r = lauf.ergebnis;
    return {
      programm: lauf.programm, neu: !!lauf.name && !lauf.konto,
      phase: r ? r.phase : z.phase, url: z.url || null, code: z.code || null,
      codeMoeglich: r ? false : !!z.codeMoeglich,
      verbleibendMs: r ? null : z.verbleibendMs,
      grund: r ? r.grund : (z.grund || null), rueckfall: r ? r.rueckfall : !!z.rueckfall,
      ...(r && r.konto ? { konto: r.konto } : {}),
    };
  }
  const lauf = (id) => {
    raeume();
    const l = typeof id === "string" && laeufe.get(id);
    if (!l) throw new HttpFehler(404, "Diese Anmeldung gibt es nicht (mehr).", { art: "unbekannt" });
    return l;
  };

  return {
    start,
    status: (id) => ({ ok: true, id, ...oeffentlich(lauf(id)) }),
    code(id, text) {
      const l = lauf(id);
      if (l.ergebnis) throw new HttpFehler(409, "Diese Anmeldung ist schon zu Ende.", { art: "zu-ende" });
      const r = l.sitzung.sendeCode(text);
      if (!r.ok) throw new HttpFehler(r.grund === "ungueltig" ? 400 : 409, r.grund === "ungueltig" ? "Dieser Code sieht nicht richtig aus. Kopiere ihn noch einmal vollständig." : "Hier ist gerade kein Code nötig.", { art: r.grund });
      return { ok: true };
    },
    abbrechen(id) {
      const l = lauf(id);
      if (!l.ergebnis) { l.sitzung.abbrechen(); } // schließt den Lauf; `abschluss` räumt auf (Mikrotask) — hier gleich selbst, damit die Antwort stimmt
      if (!l.ergebnis) abschluss(id, l, l.sitzung.zustand());
      return { ok: true, id, ...oeffentlich(l) };
    },
    // Alles Laufende beenden (Werkstatt endet).
    beendeAlle() { for (const [id, l] of laeufe) if (!l.ergebnis) { l.sitzung.abbrechen(); abschluss(id, l, l.sitzung.zustand()); } },
    laufend: () => aktiv.size,
  };
}
