// Texte für „Frag deinen Vault“ (Deutsch). Die App heißt Kortex, der Datenordner Vault.
const tokens = (n) => `${Math.max(1, Math.round(n / 100) * 100).toLocaleString("de-DE")}`;
const dollar = (d) => (d < 0.01 ? "unter 0,01 $" : `${d.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`);

export const TF = {
  titel: "Frag deinen Vault",
  knopf: "Frag deinen Vault (⌘J)",
  befehl: "Frag deinen Vault",
  schliessen: "Schließen",
  konto: "Konto",
  kontoHinweis: "Mit diesem KI-Konto wird gefragt.",
  modell: "Genauigkeit",
  modelle: { klein: "Schnell", mittel: "Gründlich" },
  modellHinweis: { klein: "Kleines Modell: schnell und sparsam.", mittel: "Mittleres Modell: gründlicher, braucht mehr vom Kontingent." },
  platzhalter: "Was willst du aus deinem Vault wissen?",
  fragen: "Fragen",
  fragenKurz: "⌘↵",
  abbrechen: "Abbrechen",
  neu: "Neue Frage",
  nichtGespeichert: "Nichts wird gespeichert. Frage und Antwort bleiben nur, solange dieses Fenster offen ist.",
  nurLesen: "Die KI darf nur lesen, über Kortex, und nichts ändern.",
  weg: (konto, anbieter) => `Die Frage und gefundene Vault-Auszüge gehen an ${anbieter} über das Konto „${konto}“.`,
  anbieter: "Anthropic",
  deineFrage: "Deine Frage",
  antwort: "Antwort",
  laeuft: "Die KI arbeitet …",
  wartet: "Verbinde mit der KI …",
  laedt: "Lade …",
  sucht: (t) => (t ? `Sucht nach „${t}“ …` : "Sucht im Vault …"),
  liest: (p) => `Liest ${p} …`,
  kontextHolt: "Holt Kontext …",
  schreibt: "Schreibt die Antwort …",
  abgelehnt: "Ein nicht erlaubter Zugriff wurde abgelehnt.",
  wiederholt: "Die KI antwortet gerade langsam, Kortex versucht es noch einmal …",
  quellen: "Quellen",
  quellenHinweis: "Nur Seiten, die es in deinem Vault gibt. Ein Klick öffnet die Seite.",
  quelleArt: { genannt: "genannt", gelesen: "gelesen", gefunden: "gefunden" },
  unbekannt: (n) => (n === 1 ? "Die Antwort nennt eine Seite, die es nicht gibt. Sie ist nicht verlinkt." : `Die Antwort nennt ${n} Seiten, die es nicht gibt. Sie sind nicht verlinkt.`),
  keineQuellen: "Die Antwort nennt keine Seite aus deinem Vault.",
  gekuerzt: "Die Antwort wurde gekürzt.",
  stufen: { gruen: "Belegt", gelb: "Zu prüfen", rot: "Strittig", ohne: "Ohne Befund", grau: "Notiz", unbekannt: "–" },
  verbrauch: {
    titel: "Verbrauch",
    tokens: (n) => `etwa ${tokens(n)} Tokens`,
    abo: (n, name) => `etwa ${tokens(n)} Tokens, zählt zum Kontingent deines Abos${name ? ` (${name})` : ""}`,
    api: (d) => `ca. ${dollar(d)} (Schätzung von Claude Code)`,
    beides: (n, d) => `etwa ${tokens(n)} Tokens, ca. ${dollar(d)} (Schätzung von Claude Code)`,
  },
  abgebrochen: "Abgebrochen.",
  fehlerTitel: "Das hat nicht geklappt",
  fehlerStart: "Die Frage ließ sich nicht starten.",
  fehlerVerbindung: "Die Verbindung zu Kortex ist abgerissen. Die Frage wurde beendet.",
  bereitFehler: "Kortex kann gerade nicht prüfen, welche KI-Konten es gibt.",
  zeit: (ms) => (ms >= 1000 ? `${(ms / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} s` : `${ms} ms`),
  leer: {
    nichtVertraut: { titel: "Dieser Vault ist noch nicht bestätigt", text: "Bis du bestätigt hast, dass dieser Vault von dir kommt, geht keine Frage an eine KI. Das schützt dich vor Anweisungen in fremden Ordnern.", knopf: "Vault prüfen und bestätigen …" },
    keinClaude: { titel: "Claude Code ist nicht installiert", text: "„Frag deinen Vault“ nutzt Claude Code auf diesem Mac. Installiere es (code.claude.com), melde dich an und öffne Kortex danach neu.", knopf: "Noch einmal prüfen" },
    keinKonto: { titel: "Kein KI-Konto darf diesen Vault lesen", text: "Gib dem Konto, mit dem du fragen willst, die Stufe „Lesen“ für diesen Vault. Du findest das unter „KI-Konten“.", knopf: "KI verbinden und freigeben …" },
    nurAndere: { titel: "Hier fragt bisher nur Claude Code", text: "Die erlaubten Konten gehören zu Programmen, die sich nicht auf den Lesezugriff über Kortex beschränken lassen (zum Beispiel Codex). Gib einem Claude-Konto die Stufe „Lesen“.", knopf: "KI verbinden und freigeben …" },
    kontenDefekt: { titel: "Die Liste der KI-Konten ist nicht verfügbar", text: "Öffne Kortex neu, dann legt es die Liste neu an. Bis dahin geht keine Frage an eine KI.", knopf: "Noch einmal prüfen" },
    nurClaude: "Nur Claude Code kann hier fragen. Codex & Co. lassen sich nicht auf den Lesezugriff beschränken.",
  },
};
TF.verbrauchText = (e, abo, kontoName) => {
  if (!e || !e.tokens) return null;
  const n = (e.tokens.eingabe || 0) + (e.tokens.ausgabe || 0) + (e.tokens.cacheSchreiben || 0); // gelesener Cache zählt kaum und bleibt draußen
  const d = typeof e.kosten === "number" ? e.kosten : null;
  if (["pro", "max", "team", "enterprise"].includes(abo)) return TF.verbrauch.abo(n, kontoName);
  if (abo === "api" && d !== null) return TF.verbrauch.api(d);
  if (d !== null) return TF.verbrauch.beides(n, d);
  return n ? TF.verbrauch.tokens(n) : null;
};
