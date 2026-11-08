// Texte für Tabellen, Formatieren und Einfügen im Editor (Runde 3b). Deutsch, Du-Form; App „Kortex“, Datenordner „Vault“.
export const TF3 = {
  tabelle: {
    einfuegen: "Tabelle einfügen", einfuegenText: "Fügt eine Tabelle mit drei Spalten an der Cursorstelle ein.",
    zelle: (z, s) => `Zeile ${z}, Spalte ${s}`, kopfzelle: (s) => `Kopfzeile, Spalte ${s}`,
    zeileOben: "Zeile darüber einfügen", zeileUnten: "Zeile darunter einfügen", zeileLoeschen: "Zeile löschen",
    spalteLinks: "Spalte links einfügen", spalteRechts: "Spalte rechts einfügen", spalteLoeschen: "Spalte löschen",
    links: "Linksbündig", mitte: "Zentriert", rechts: "Rechtsbündig", ohne: "Ausrichtung entfernen",
    quelltext: "Als Text bearbeiten", loeschen: "Tabelle löschen", zeileHinzu: "Zeile hinzufügen", ausrichtung: "Ausrichtung",
    beschriftung: "Tabelle",
  },
  format: {
    fett: "Fett", kursiv: "Kursiv", code: "Code", durchgestrichen: "Durchgestrichen", link: "Link",
    ueberschrift: (n) => `Überschrift ${n}`, listePunkt: "Aufzählung", listeNummer: "Nummerierte Liste", listeAufgabe: "Aufgabenliste",
    leiste: "Textformat", leisteEinstellung: "Format-Leiste", leisteEinstellungText: "Zeigt über markiertem Text eine kleine Leiste für Fett, Kursiv, Link, Überschrift und Liste.",
    einfuegenText: "Als reinen Text einfügen",
  },
};
