// Texte, die den Mac erwähnen („Mac“, „Finder“, „Apple“, „macOS“), werden in „Kortex im Browser“ neutral: der Browser läuft auch unter Windows und Linux.
// Die App (macOS) behält ihre Wörter unverändert. `plattformTexte(texte)` gibt in der App dasselbe Objekt zurück; im Browser eine Kopie, in der jede Zeichenkette (auch das Ergebnis
// von Funktionen) die Ersetzungen unten durchläuft. Nur die Schlüssel `id`, `schluessel`, `woerter`, `art` und `sonder` bleiben unberührt (Kennungen und Suchwörter).
const ERSATZ = [
  [/Schlüsselbund dieses Macs/g, "Anmeldedaten-Speicher dieses Rechners"],
  [/\s*\(Datei [^)]*LaunchAgents\)/g, ""],
  [/Befehlszeilen-Werkzeuge von Apple/g, "Befehlszeilen-Werkzeuge"],
  [/Ein Werkzeug von Apple fehlt noch/g, "Ein Werkzeug fehlt noch"],
  [/Werkzeug von Apple/g, "Werkzeug"],
  [/Installationsdialog von Apple/g, "Installationsdialog"],
  [/Apple installiert die Werkzeuge/g, "Die Werkzeuge werden installiert"],
  [/macOS fragt gleich/g, "Das System fragt gleich"],
  [/macOS-Mitteilungen/g, "Systemmitteilungen"],
  [/macOS-Benutzer/g, "Systembenutzer"],
  [/Wie macOS/g, "Wie das System"],
  [/macOS 26 oder neuer/g, "Aktuelle Version des Systems"],
  [/zeigt macOS/g, "zeigt das System"],
  [/Mac-App/g, "App"],
  [/Im Finder/g, "Im Dateimanager"],
  [/im Finder/g, "im Dateimanager"],
  [/(Der|Dieser) Mac\b/g, "$1 Rechner"],
  [/(der|dein|dem|deinem|diesem|den|diesen|dieser) Mac\b/g, "$1 Rechner"],
  [/\bMacs\b/g, "Rechnern"],
  [/\bMac\b/g, "Rechner"],
  [/\bFinder\b/g, "Dateimanager"],
  [/\bmacOS\b/g, "dein System"],
  [/\bApple\b/g, "dem Hersteller"],
];
const UNBERUEHRT = new Set(["id", "schluessel", "woerter", "art", "sonder"]);
export const neutralerText = (s) => ERSATZ.reduce((t, [re, neu]) => t.replace(re, neu), s);
const imBrowser = () => typeof window !== "undefined" && !!window.kortexHuelle && !window.webkit?.messageHandlers?.aktion;

function kopie(x, schluessel) {
  if (typeof x === "string") return UNBERUEHRT.has(schluessel) ? x : neutralerText(x);
  if (typeof x === "function") return (...a) => kopie(x(...a), schluessel);
  if (Array.isArray(x)) return x.map((e) => kopie(e, schluessel));
  if (x && typeof x === "object" && Object.getPrototypeOf(x) === Object.prototype) return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, kopie(v, k)]));
  return x;
}
export const plattformTexte = (texte, { browser = imBrowser() } = {}) => (browser ? kopie(texte) : texte);
