// tageslauf/stufe.mjs — Schritt 5 (Regeln, Spec §5.2-Tabelle + §6.3 Autostufe). Reine Funktion, keine Ein-/Ausgabe.
// e = { art, herkunft, zitatGeprueft, zitatStuetzt, passtZurSeite, dauerhaft, gedeckt?, ziel: { seite, kritisch } | null,
//       abgleich: { urteil } | null, heikel, autostufe }
// Grundsatz „lieber eine Lücke als ein Fehler": 🟢 (uebernehmen/stand) nur, wenn JEDE Bedingung ausdrücklich erfüllt ist
// (=== true / === false / bekannter Wert). Fehlt oder ist etwas unbekannt, wird es nie 🟢.
// Reihenfolge der Regeln = Vorrang: Art → Beleg → Beleg passt → Zielseite → KI-Antwort vollständig → schon drin → kurzlebig →
// Seite passt → kritisch → Widerspruch/unklar → web → heikel → Autostufe.
// Autostufe „eng": nur herkunft tool wird übernommen, alles andere wartet.
// Autostufe „aus": hier 🟡 autostufe-aus. Der Tageslauf selbst rechnet bei „aus“ (auch im Lernmodus) mit autostufe „normal“ und macht erst NACH dem Richter aus dessen „übernehmen“ die
// markierte Rückfrage (tageslauf.mjs#pruefeVorschlag) — so prüft der Mensch das Urteil, das später automatisch wirken würde. Der „aus“-Zweig bleibt für direkte Aufrufer dieser reinen Funktion.
// zitatStuetzt: Antwort des Abgleichs („Stützt das Zitat die Aussage vollständig?"), auch für art stand nötig (Aufrufer liefert es).
// Dreiwertig wie passtZurSeite/dauerhaft: nur ein ausdrückliches false (in einer gültigen Antwort) ergibt ⚪ beleg-passt-nicht; unbekannt
// (kaputte, leere, unvollständige Antwort) ergibt ⏸ ki-antwort-unvollstaendig.
// gedeckt (optional): 0-Token-Vorprüfung aussageGedeckt (Zahlen/Daten/Verneinungen der Aussage stehen im Zitat); nur ein echtes
// `false` blockiert. Beides ergibt bei „stützt nicht" ⚪ aussortieren (beleg-passt-nicht), nie eine Rückfrage.
// passtZurSeite / dauerhaft: weitere Antworten desselben Abgleichs (Nachbesserung nach dem Probelauf), dreiwertig: nur ein echtes
// true/false zählt, alles andere (fehlt, null, Text, Zahl) ist „unbekannt".
//  - zitatStuetzt oder passtZurSeite (beide Arten) unbekannt, oder beim Fakt dauerhaft unbekannt → ⏸ ki-antwort-unvollstaendig: die
//    KI-Antwort war kaputt oder unvollständig; der Abgleich merkt sie sich nicht, der nächste Lauf fragt neu. NIE ⚪ kurzlebig / ⏸ seite-passt-nicht
//    aus einer halben Antwort — sonst archiviert eine kaputte Antwort gute Fakten endgültig.
//  - nur ein ausdrückliches dauerhaft === false (nur art fakt) → ⚪ kurzlebig. Für art stand gilt dauerhaft nicht: Stände sind
//    bewusst kurzlebig und ersetzen sich.
//  - nur ein ausdrückliches passtZurSeite === false → ⏸ seite-passt-nicht (die Zielseite war nur ein schwacher Treffer; dient später
//    den „neuen Seiten"). Das gilt VOR allen Rückfragen: kritisch, widerspricht, unklar, web, heikel und Autostufe aus sind nur bei
//    passtZurSeite === true eine Rückfrage — sonst würde ein „übernehmen" des Menschen auf die falsche Seite schreiben.
export function stufe(e) {
  e = e && typeof e === "object" ? e : {};
  const r = (stufe, grund, typ) => (typ ? { stufe, grund, typ } : { stufe, grund });
  if (e.art !== "fakt" && e.art !== "stand") return r("warten", "art-unbekannt");
  if (e.herkunft === "ki") return r("aussortieren", "herkunft-ki");
  if (e.zitatGeprueft !== true || !["du", "tool", "web"].includes(e.herkunft)) return r("aussortieren", "kein-beleg");
  if (e.gedeckt === false || e.zitatStuetzt === false) return r("aussortieren", "beleg-passt-nicht");
  if (!e.ziel?.seite) return r("warten", "keine-seite");
  const bekannt = (w) => w === true || w === false;
  if (!bekannt(e.zitatStuetzt) || !bekannt(e.passtZurSeite) || (e.art === "fakt" && !bekannt(e.dauerhaft))) return r("warten", "ki-antwort-unvollstaendig");
  if (e.art === "fakt" && e.abgleich?.urteil === "schon_drin") return r("aussortieren", "schon-drin");
  if (e.art === "fakt" && e.dauerhaft === false) return r("aussortieren", "kurzlebig");
  if (e.passtZurSeite === false) return r("warten", "seite-passt-nicht");
  // Ab hier steht fest: passtZurSeite === true (und beim Fakt dauerhaft === true) — erst jetzt gibt es Rückfragen.
  if (e.ziel.kritisch !== false) return r("rueckfrage", "kritisch", "heikel");
  if (e.art === "fakt" && e.abgleich?.urteil === "widerspricht") return r("rueckfrage", "widerspricht", "widerspruch");
  if (e.art === "fakt" && e.abgleich?.urteil !== "neu") return r("rueckfrage", "unklar", "heikel");
  if (e.herkunft === "web") return r("rueckfrage", "web", "web");
  if (e.heikel !== false) return r("rueckfrage", "heikel", "heikel");
  if (e.autostufe === "aus") return r("rueckfrage", "autostufe-aus", "heikel");
  if (e.autostufe === "eng" && e.herkunft !== "tool") return r("warten", "autostufe-eng");
  if (e.autostufe !== "normal" && e.autostufe !== "eng") return r("warten", "autostufe-unbekannt");
  return e.art === "stand" ? r("stand", "stand-ersetzen") : r("uebernehmen", "neu");
}
