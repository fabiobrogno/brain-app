// Texte der Konflikt-Ansicht (Abgleich, wenn dieselbe Notiz auf zwei Geräten geändert wurde). Deutsch, Du-Form, Alltagssprache.
// Das Wort „Konflikt“ steht nur für den Zustand. Nie: merge, ours/theirs, HEAD, Commit, Branch (Test: sichtbare-begriffe.test.mjs).
const mz = (n, eins, viele) => (n === 1 ? eins : viele);

export const ANDERES_GERAET = "Anderes Gerät";
export const DIESER_MAC = "Dieser Mac";

// „Konflikt in 2 Notizen“ / „Konflikt in 2 Notizen und 1 Aufgabe“
export function konfliktLabel(notizen, aufgaben = 0) {
  const n = `${notizen} ${mz(notizen, "Notiz", "Notizen")}`;
  if (!notizen && aufgaben) return `Konflikt in ${aufgaben} ${mz(aufgaben, "Aufgabe", "Aufgaben")}`;
  return aufgaben ? `Konflikt in ${n} und ${aufgaben} ${mz(aufgaben, "Aufgabe", "Aufgaben")}` : `Konflikt in ${n}`;
}

export const TK = {
  banner: {
    ansehen: "Ansehen", spaeter: "Später",
    was: (g) => `${g ? `Du und ${g} habt` : "Zwei Geräte haben"} sie gleichzeitig geändert. Der Abgleich wartet auf dich.`,
    wasGeloescht: "Eine wurde auf einem Gerät gelöscht, die andere dort geändert, wo sie noch da ist. Der Abgleich wartet auf dich.",
    wasKarte: "Dieselbe Aufgaben-Karte wurde auf zwei Geräten verschoben. Der Abgleich wartet auf dich.",
  },
  mitteilung: { titel: "Abgleich wartet.", ansehen: "Fassungen ansehen" },
  pfad: "Abgleich",
  liste: {
    titel: "Abgleich", beschriftung: "Betroffene Einträge",
    standard: "Diese Notizen wurden auf zwei Geräten gleichzeitig geändert.",
    geloescht: "Auf einem Gerät gelöscht, auf dem anderen geändert.",
    gemischt: "Diese Einträge wurden auf zwei Geräten geändert.",
    offen: "Offen",
    unterschiede: (a, b, n) => `${a} und ${b} · ${n} ${mz(n, "Unterschied", "Unterschiede")}`,
    geloeschtAndere: (g) => `Auf ${g} gelöscht, hier geändert`,
    geloeschtMac: (g) => `Hier gelöscht, auf ${g} geändert`,
    karte: "Auf beiden Geräten verschoben",
    aufgabenKarte: "Aufgaben-Karte",
  },
  kopf: {
    geaendert: "Auf beiden Geräten geändert",
    geloeschtAndere: (g) => `Auf ${g} gelöscht`, geloeschtMac: "Hier gelöscht", karte: "Auf beiden Geräten verschoben",
    erklText: (seit, auf) => `Seit dem letzten Abgleich${seit ? ` (${seit})` : ""} wurde diese Notiz hier und ${auf} geändert. Wähle, was bleiben soll. Nichts geht verloren: die andere Fassung bleibt im Verlauf.`,
    erklGeloeschtAndere: (g) => `Du hast diese Notiz geändert, während sie auf ${g} gelöscht wurde. Soll sie bleiben oder verschwinden?`,
    erklGeloeschtMac: (g) => `Du hast diese Notiz gelöscht, während sie auf ${g} weiter geändert wurde. Soll sie bleiben oder verschwinden?`,
    erklKarte: (g) => `Dieselbe Karte wurde hier und auf ${g} in eine andere Spalte gezogen. Es kann nur eine Spalte gelten.`,
  },
  aktion: {
    meine: "Diese behalten", andere: "Andere behalten", beide: "Beide behalten", zusammen: "Selbst zusammenführen",
    notizBehalten: "Notiz behalten", geloeschtLassen: "Gelöscht lassen", loeschenUebernehmen: "Löschung übernehmen",
    ki: "KI fragen", kiTitel: "Die KI vergleicht beide Fassungen und macht einen Vorschlag (K)",
    waehle: (karte) => `Wähle, was mit ${karte ? "dieser Karte" : "dieser Notiz"} passieren soll.`,
    kiHover: "Die KI vergleicht beide Fassungen und macht einen Vorschlag. Geändert wird erst, wenn du übernimmst.",
  },
  folge: {
    notizBleibt: "Die Notiz bleibt, mit allen Änderungen. Die Löschung wird nicht übernommen.",
    loeschenHier: "Die Notiz wird auch hier gelöscht. Sie bleibt im Verlauf und lässt sich von dort zurückholen.",
    loeschenAnderswo: (g) => `Die Notiz wird auch auf ${g} gelöscht. Sie bleibt im Verlauf und lässt sich von dort zurückholen.`,
    meine: (von) => `Deine Fassung bleibt. Die Änderungen ${von} werden nicht übernommen, bleiben aber im Verlauf der Notiz.`,
    andere: (von) => `Die Fassung ${von} ersetzt deine. Deine bleibt im Verlauf der Notiz.`,
    beide: (von, titel, g) => `Deine Fassung bleibt. Die Fassung ${von} wird als Kopie „${titel} (${g})“ daneben abgelegt.`,
    zusammen: "Du wählst Abschnitt für Abschnitt, was in die Notiz kommt.",
    karteMeine: (sp, f, von) => `Die Karte steht in „${sp}“${f ? `, fällig ${f}` : ""}. Die Änderung ${von} wird nicht übernommen.`,
    karteAndere: (sp, f) => `Die Karte steht in „${sp}“${f ? `, fällig ${f}` : ""}. Deine Änderung wird nicht übernommen.`,
    kiGeloest: "Mit der KI gelöst.", ergebnisSehen: "Das Ergebnis siehst du im Abschnitt „Selbst zusammenführen“.",
  },
  kurz: {
    notizBleibt: "Notiz bleibt", loeschung: "Löschung übernommen",
    meine: "Dieser Mac behalten", andere: (g) => `${g} behalten`, beide: "Beide behalten, Kopie", text: "Selbst zusammengeführt", textKi: "Mit KI zusammengeführt",
    karteBleibt: (sp) => `Bleibt in „${sp}“`, karteKommt: (sp) => `Kommt nach „${sp}“`,
  },
  spalte: { offen: "Offen", "in-arbeit": "In Arbeit", warten: "Wartet", erledigt: "Erledigt" },
  fassung: {
    deine: "Deine Fassung", gespeichert: "gespeichert", geaendert: "geändert", geloescht: "gelöscht", unbekannt: "Zeit unbekannt",
    geaendertMarke: "Geändert", geloeschtMarke: "Gelöscht",
    gleiche: (n) => `${n} ${mz(n, "gleiche Zeile", "gleiche Zeilen")} ausgeblendet`,
    legUnterschied: "Unterschied", legWort: "Anderes Wort", legLuecke: "Gibt es hier nicht", legNeu: "Seit dem Löschen dazugekommen",
    weg: (wo) => `${wo} gelöscht`,
    wegHierTitel: "Hier gelöscht", wegAnderswoTitel: (g) => `Auf ${g} gelöscht`,
    wegHierText: (g) => `Auf diesem Mac gibt es sie nicht mehr. Auf ${g} wurde sie danach noch geändert.`,
    wegAnderswoText: () => "Dort gibt es diese Notiz nicht mehr. Hier hast du sie danach noch geändert.",
    keinText: "Dieser Inhalt lässt sich nicht als Text zeigen. Wähle eine der beiden Fassungen.",
    gross: "Diese Notiz ist zu groß für den Vergleich. Wähle eine der beiden Fassungen.",
    spalteLabel: "Spalte", faelligLabel: "Fällig", notizLabel: "Notiz",
    karteHinweis: (vor) => `Die Karte lag vorher in „${vor}“. Beide Geräte haben sie seitdem verschoben.`,
    karteOhneVorher: "Beide Geräte haben die Karte seit dem letzten Abgleich verändert.",
  },
  merge: {
    titel: "Abschnitt für Abschnitt wählen", alleMac: "Alle von diesem Mac", alleAndere: (von) => `Alle ${von}`,
    abschnitt: (n) => `Abschnitt ${n}`, offen: "Noch offen", vonMac: "Von diesem Mac", vonAndere: (g) => `Von ${g}`, beide: "Beide", eigen: "Eigener Text",
    nichts: "Nichts, die Zeile fehlt hier", beideUebernehmen: "Beide übernehmen", selbstSchreiben: "Selbst schreiben",
    ergebnisTitel: "So sieht die Notiz danach aus", gleicheZeilen: (n) => `${n} gleiche Zeilen`, anfang: "Anfang",
    abschnittOffen: (n) => `Abschnitt ${n}: noch offen`, quelleMac: "Mac", quelleEigen: "Eigen",
    gewaehlt: (n, g) => (n === g ? "Alle Abschnitte gewählt." : `${n} von ${g} Abschnitten gewählt.`),
    zurueck: "Zurück zum Vergleich", uebernehmen: "Ergebnis übernehmen",
    eigenLabel: (n) => `Eigener Text für Abschnitt ${n}`,
    freiTitel: "Text bearbeiten", freiLabel: "Zusammengeführter Text",
  },
  ki: {
    titelDenkt: "Die KI liest beide Fassungen", titelFertig: (name) => `Vorschlag von ${name}`,
    denkt: "Vergleicht die Fassungen …", abbrechen: "Abbrechen", verwerfen: "Verwerfen", anpassen: "Selbst anpassen", uebernehmen: "Übernehmen",
    fuss: (stufe, art) => `Darf hier: ${stufe}. Liest nur ${art} und ändert nichts, bis du übernimmst.`,
    art: { text: "diese beiden Fassungen", geloescht: "die Notiz und den Löschvermerk", board: "die beiden Fassungen der Karte" },
    stufe: { lesen: "Lesen", vorschlagen: "Vorschlagen", schreiben: "Schreiben", posteingang: "Posteingang" },
    fehler: "Der Vorschlag war nicht lesbar. Du kannst die Fassungen selbst vergleichen.",
    fehlerStart: "Die KI konnte gerade nicht fragen.",
  },
  fuss: {
    fortschritt: (fertig, n) => (fertig === n ? "Alles gelöst" : `${fertig} von ${n} gelöst · noch ${n - fertig} offen`),
    spaeter: "Später", spaeterTitel: "Später entscheiden (Esc)", abgleichen: "Alles gelöst – jetzt abgleichen",
    nochOffen: (n) => `Noch ${n} offen. Entscheide zuerst alle.`,
  },
  sync: {
    titel: "Wird abgeglichen …", text: "Deine Entscheidungen gelten gleich auf allen Geräten.",
    s1: "Entscheidungen festhalten", s2: (g) => `Mit ${g ? g : "dem anderen Gerät"} abgleichen`, s3: "Online sichern",
  },
  fertig: {
    titel: "Alles abgeglichen", text: "Dein Mac und dein Server haben jetzt dieselben Notizen.",
    orte: { mac: "Dieser Mac", geraet: "Anderes Gerät", server: "Online" },
    zurueck: "Zurück zu den Notizen", rueckgaengig: "Rückgängig",
    klein: "Nicht gewählte Fassungen bleiben im Verlauf der Notiz. Dort kannst du sie jederzeit zurückholen.",
    nurLokal: (t) => `Die Entscheidungen sind festgehalten. ${t}`,
    zus: {
      meine: "Deine Fassung gilt. Die andere liegt im Verlauf.", andere: (von) => `Die Fassung ${von} gilt. Deine liegt im Verlauf.`,
      beide: (von, titel, g) => `Beide Fassungen bleiben, ${von} als Kopie „${titel} (${g})“.`, text: (n, ki) => `${n} ${mz(n, "Abschnitt", "Abschnitte")} ${ki ? "mit der KI " : ""}zusammengeführt.`,
      notizBleibt: "Die Notiz bleibt mit allen Änderungen.", geloescht: "Die Notiz ist überall gelöscht. Sie bleibt im Verlauf.",
      karte: (sp, f) => `Die Karte steht in „${sp}“${f ? `, fällig ${f}` : ""}.`,
    },
    toastTitel: "Abgleich fertig", toastKlein: (n) => `${n} ${mz(n, "Eintrag", "Einträge")} gelöst`,
    mitteilung: (n) => `Abgleich fertig. ${n} ${mz(n, "Eintrag ist", "Einträge sind")} auf Mac und Server gleich.`,
  },
  rueck: {
    ok: "Abgleich zurückgenommen. Deine Entscheidungen sind noch da.", fehler: "Das Zurücknehmen ging nicht.",
    nichtMehr: "Zurücknehmen geht nicht mehr: an diesen Notizen wurde seitdem weitergearbeitet.",
  },
  fehler: {
    laden: "Die Fassungen ließen sich gerade nicht laden.", nochmal: "Noch einmal versuchen", loesen: "Der Abgleich hat nicht geklappt. Deine Entscheidungen sind noch da.",
    keinKonflikt: "Es gibt gerade keinen Konflikt mehr.", gesperrt: "Der Abgleich ist für diesen Vault gesperrt, bis du ihm vertraust.",
    laeuft: "Gerade läuft ein anderer Abgleich. Bitte kurz warten.",
  },
  geloest: "Gelöst",
};
