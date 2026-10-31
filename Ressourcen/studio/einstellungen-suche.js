// Suche der Seite „Einstellungen“ — reine Funktionen ohne Oberfläche (damit sie sich in Node testen lassen).
// Wertung nach Orca (src/renderer/src/components/settings/settings-search.ts @9bccd67, MIT, Lovecast Inc.; hier in Kortex' Register neu geschrieben):
// Je Feld zählt „genau“ > „beginnt mit“ > „enthält“, und die Felder haben Vorrang in dieser Reihenfolge:
//   Bereichsname 900/850/800 · Titel der Einstellung 700/650/600 · Beschreibung 500/450/400 · Stichwörter 300/250/200
// Der höchste Wert gewinnt; Bereiche stehen nach ihrem besten Treffer sortiert. Eigenes: Umlaute und Groß/Klein sind egal („kurzel“ findet „Kürzel“),
// mehrere Wörter müssen alle vorkommen (Wert 150), der Suchtext ist auf 200 Zeichen begrenzt, und aus jedem Treffer wird zurückgerechnet,
// welche Stellen im Titel und in der Beschreibung zu markieren sind.
export const MAX_SUCHE = 200;
export const GEWICHT = {
  bereich: [900, 850, 800],
  titel: [700, 650, 600],
  text: [500, 450, 400],
  woerter: [300, 250, 200],
  abschnitt: [300, 250, 200],
  alle: 150,
};

// Faltet Text für den Vergleich: klein, ohne Akzente/Umlaut-Punkte, ß → ss. karte[i] = Index des Zeichens im Original, aus dem f[i] entstand.
export function falte(text) {
  const s = String(text ?? "");
  let f = "";
  const karte = [];
  for (let i = 0; i < s.length; i++) {
    const z = s[i];
    let g = z.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    if (z === "ß") g = "ss";
    for (const c of g) { f += c; karte.push(i); }
  }
  return { f, karte };
}
export const normalisiere = (text) => falte(text).f;

// Suchtext vorbereiten: auf MAX_SUCHE kürzen, Leerraum zusammenfassen, falten.
export function bereiteVor(roh) {
  const q = String(roh ?? "").slice(0, MAX_SUCHE).replace(/\s+/g, " ").trim();
  const f = normalisiere(q);
  return { roh: q, q: f, woerter: f ? f.split(" ") : [] };
}

// Stufe eines Feldes: 0 genau · 1 beginnt mit · 2 enthält · -1 nichts
function stufe(feld, q) {
  if (!feld || !q) return -1;
  if (feld === q) return 0;
  if (feld.startsWith(q)) return 1;
  return feld.includes(q) ? 2 : -1;
}
const wert = (tabelle, feld, q) => { const s = stufe(feld, q); return s < 0 ? 0 : tabelle[s]; };

// Wertung einer Zeile. bereich/abschnitt: { name/titel }. Ergebnis { wert, felder: { titel, text } } — felder sagen, ob dort etwas zu markieren ist.
export function bewerteZeile(vor, bereich, abschnitt, zeile) {
  if (!vor.q) return { wert: 0 };
  const q = vor.q;
  const titel = normalisiere(zeile.titel), text = normalisiere(zeile.text);
  const woerter = (zeile.woerter || []).map(normalisiere);
  let w = Math.max(
    wert(GEWICHT.bereich, normalisiere(bereich.name), q),
    wert(GEWICHT.titel, titel, q),
    wert(GEWICHT.text, text, q),
    ...woerter.map((k) => wert(GEWICHT.woerter, k, q)),
    wert(GEWICHT.abschnitt, normalisiere(abschnitt?.titel), q),
  );
  if (!w && vor.woerter.length > 1) {
    const heu = [titel, text, normalisiere(bereich.name), normalisiere(abschnitt?.titel), ...woerter].join(" ");
    if (vor.woerter.every((t) => heu.includes(t))) w = GEWICHT.alle;
  }
  return { wert: w };
}

// Bereiche durchsuchen. → { leer, gesamt, bereiche: [{ id, wert, treffer, zeilen: Set(id) }] } (nur Bereiche mit Treffer, nach Wert absteigend, bei Gleichstand wie im Register)
// Passt der Bereichsname selbst, gelten alle seine Zeilen als Treffer (wie bei Orca: Bereich gefunden = ganzer Bereich).
export function suche(roh, bereiche) {
  const vor = bereiteVor(roh);
  if (!vor.q) return { leer: true, gesamt: 0, bereiche: [], vor };
  const ergebnis = [];
  bereiche.forEach((b, reihenfolge) => {
    const bereichWert = wert(GEWICHT.bereich, normalisiere(b.name), vor.q);
    const zeilen = new Map();
    let best = bereichWert;
    for (const a of b.abschnitte) for (const z of a.zeilen) {
      const r = bewerteZeile(vor, b, a, z);
      const w = Math.max(r.wert, bereichWert);
      if (w > 0) { zeilen.set(z.id, w); best = Math.max(best, w); }
    }
    if (zeilen.size) ergebnis.push({ id: b.id, wert: best, treffer: zeilen.size, zeilen, reihenfolge });
  });
  ergebnis.sort((a, b) => b.wert - a.wert || a.reihenfolge - b.reihenfolge);
  return { leer: false, gesamt: ergebnis.reduce((n, b) => n + b.treffer, 0), bereiche: ergebnis, vor };
}

// Stellen im Originaltext, die zu markieren sind: [[von, bis), …], zusammengefasst und sortiert. Gesucht wird der ganze Suchtext, sonst jedes Wort einzeln.
export function markierungen(text, vor) {
  const { f, karte } = falte(text);
  if (!f || !vor.q) return [];
  const suchen = f.includes(vor.q) ? [vor.q] : vor.woerter.filter((w) => w.length > 0);
  const stellen = [];
  for (const s of suchen) {
    let i = f.indexOf(s);
    while (i >= 0) {
      const von = karte[i], bis = karte[i + s.length - 1] + 1;
      stellen.push([von, bis]);
      i = f.indexOf(s, i + s.length);
    }
  }
  stellen.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const aus = [];
  for (const st of stellen) {
    const letzte = aus[aus.length - 1];
    if (letzte && st[0] <= letzte[1]) letzte[1] = Math.max(letzte[1], st[1]); else aus.push([...st]);
  }
  return aus;
}

// Text in Stücke zerlegen: [{ text, treffer }]
export function zerlege(text, vor) {
  const s = String(text ?? "");
  const stellen = markierungen(s, vor);
  if (!stellen.length) return [{ text: s, treffer: false }];
  const teile = [];
  let pos = 0;
  for (const [von, bis] of stellen) {
    if (von > pos) teile.push({ text: s.slice(pos, von), treffer: false });
    teile.push({ text: s.slice(von, bis), treffer: true });
    pos = bis;
  }
  if (pos < s.length) teile.push({ text: s.slice(pos), treffer: false });
  return teile;
}

// Bearbeitungsabstand (Levenshtein), begrenzt: > max → max + 1
function abstand(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let vor = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const jetzt = [i];
    let kleinste = i;
    for (let j = 1; j <= b.length; j++) {
      jetzt[j] = Math.min(vor[j] + 1, jetzt[j - 1] + 1, vor[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      kleinste = Math.min(kleinste, jetzt[j]);
    }
    if (kleinste > max) return max + 1;
    vor = jetzt;
  }
  return vor[b.length];
}

// Vorschläge bei 0 Treffern: Wörter aus dem Register (Bereichsnamen, Titel, Stichwörter), die der Eingabe ähneln (gleicher Anfang oder höchstens 2 Tippfehler);
// reicht das nicht, die festen Vorschläge. Höchstens 4, ohne Doppelte. Rückgabe in der Schreibweise des Registers.
export function vorschlaege(roh, bereiche, feste = []) {
  const vor = bereiteVor(roh);
  const kandidaten = new Map(); // gefaltet → Originalschreibweise
  const merke = (t) => { for (const w of String(t || "").split(/[\s/,.()„“]+/)) { const g = normalisiere(w); if (g.length >= 4 && !kandidaten.has(g)) kandidaten.set(g, w); } };
  for (const b of bereiche) { merke(b.name); for (const k of b.woerter || []) merke(k); for (const a of b.abschnitte) for (const z of a.zeilen) { merke(z.titel); for (const k of z.woerter || []) merke(k); } }
  const treffer = [];
  for (const w of vor.woerter) {
    if (w.length < 3) continue;
    for (const [g, orig] of kandidaten) {
      const d = abstand(w, g.slice(0, Math.max(w.length, 4)), 2);
      const gleicherAnfang = g.startsWith(w.slice(0, 2)) && abstand(w, g, 3) <= 3;
      if (d <= 1 || (d <= 2 && w.length >= 5) || gleicherAnfang) treffer.push({ orig, d: Math.min(d, abstand(w, g, 3)) });
    }
  }
  treffer.sort((a, b) => a.d - b.d);
  const aus = [];
  for (const t of [...treffer.map((x) => x.orig), ...feste]) if (!aus.some((x) => normalisiere(x) === normalisiere(t))) aus.push(t);
  return aus.slice(0, 4);
}
