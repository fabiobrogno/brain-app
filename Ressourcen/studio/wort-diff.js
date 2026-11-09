// Wort-Diff (rein, ohne DOM): vergleicht zwei Texte auf Wortebene und liefert Teile { t: "gleich" | "weg" | "neu", s }.
// Byte-treu: „gleich“ + „weg“ ergeben genau den alten Text, „gleich“ + „neu“ genau den neuen (CRLF, Umlaute, Emojis, Leerraum bleiben unverändert);
// geprüft wird das in Tests/Node/wort-diff.test.mjs. Die Zerlegung schneidet nie mitten durch ein Zeichen (Surrogatpaare, kombinierende Zeichen, Emoji-Folgen mit ZWJ).
// Grenzen: sehr große Texte (Zellen der Tabelle > 4 Mio.) fallen auf „alles ersetzt“ zurück, statt den Rechner zu beschäftigen.

// Ein Zeilenende (CRLF zusammen) · Leerraum ohne Zeilenende · ein Wort (Buchstaben, Ziffern, _, kombinierende Zeichen) · sonst ein Zeichen samt seiner Anhängsel (Variation, Hautton, ZWJ-Folge)
const ANHANG = "[\\p{M}\\uFE0F\\u{1F3FB}-\\u{1F3FF}\\u{E0020}-\\u{E007F}]";
const TOKEN = new RegExp(`\\r\\n|[\\r\\n]|[^\\S\\r\\n]+|[\\p{L}\\p{N}_][\\p{L}\\p{N}\\p{M}_]*|[^\\s\\p{M}]${ANHANG}*(?:\\u200D[^\\s]${ANHANG}*)*|[\\s\\S]`, "gu");

export function zerlege(text) {
  const s = String(text ?? "");
  const teile = s.match(TOKEN) || [];
  if (teile.join("") !== s) return [...s]; // Sicherheitsnetz: nie Text verlieren; dann zeichenweise
  return teile;
}

const MAX_ZELLEN = 4_000_000;

// → [{ t, s }] mit zusammengefassten Nachbarn; Änderungen stehen als erst „weg“, dann „neu“
export function wortDiff(alt, neu) {
  const a = zerlege(alt), b = zerlege(neu);
  let von = 0;
  while (von < a.length && von < b.length && a[von] === b[von]) von++;
  let ea = a.length, eb = b.length;
  while (ea > von && eb > von && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const kopf = a.slice(0, von), fuss = a.slice(ea);
  const ma = a.slice(von, ea), mb = b.slice(von, eb);
  let mitte;
  if (!ma.length && !mb.length) mitte = [];
  else if (!ma.length) mitte = [["neu", mb.join("")]];
  else if (!mb.length) mitte = [["weg", ma.join("")]];
  else if (ma.length * mb.length > MAX_ZELLEN) mitte = [["weg", ma.join("")], ["neu", mb.join("")]];
  else mitte = lcsOps(ma, mb);
  const roh = [];
  if (kopf.length) roh.push(["gleich", kopf.join("")]);
  roh.push(...mitte);
  if (fuss.length) roh.push(["gleich", fuss.join("")]);
  return glaette(roh).map(([t, s]) => ({ t, s }));
}

// Längste gemeinsame Teilfolge (Tabelle der Längen von hinten, dann Vorwärtsgang)
function lcsOps(a, b) {
  const n = a.length, m = b.length, w = m + 1;
  const L = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i * w + j] = a[i] === b[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push(["gleich", a[i]]); i++; j++; }
    else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) { ops.push(["weg", a[i]]); i++; }
    else { ops.push(["neu", b[j]]); j++; }
  }
  while (i < n) ops.push(["weg", a[i++]]);
  while (j < m) ops.push(["neu", b[j++]]);
  return ops;
}

// Nachbarn gleicher Art zusammenfassen; zwischen zwei Änderungen nur Leerraum „gleich“ → in beide Seiten übernehmen (sonst zerfällt „a b c“ → „x y z“ in Schnipsel);
// innerhalb einer Änderung zuerst alles „weg“, dann alles „neu“
function glaette(ops) {
  let teile = [];
  for (const [t, s] of ops) { const l = teile[teile.length - 1]; if (l && l[0] === t) l[1] += s; else teile.push([t, s]); }
  const aenderung = (t) => t === "weg" || t === "neu";
  let aenderungen = true;
  while (aenderungen) {
    aenderungen = false;
    for (let i = 1; i < teile.length - 1; i++) {
      if (teile[i][0] === "gleich" && /^\s*$/.test(teile[i][1]) && teile[i].length === 2 && aenderung(teile[i - 1][0]) && aenderung(teile[i + 1][0]) && teile[i][1].length <= 2) {
        teile.splice(i, 1, ["weg", teile[i][1]], ["neu", teile[i][1]]); aenderungen = true; break;
      }
    }
    const neu = [];
    for (const [t, s] of teile) { const l = neu[neu.length - 1]; if (l && l[0] === t) l[1] += s; else neu.push([t, s]); }
    teile = neu;
  }
  // Blöcke aus weg/neu in feste Reihenfolge: erst weg, dann neu
  const aus = [];
  for (let i = 0; i < teile.length;) {
    if (!aenderung(teile[i][0])) { aus.push(teile[i]); i++; continue; }
    let weg = "", neuS = "";
    while (i < teile.length && aenderung(teile[i][0])) { if (teile[i][0] === "weg") weg += teile[i][1]; else neuS += teile[i][1]; i++; }
    if (weg) aus.push(["weg", weg]);
    if (neuS) aus.push(["neu", neuS]);
  }
  return aus;
}

export const textAlt = (teile) => teile.filter((x) => x.t !== "neu").map((x) => x.s).join("");
export const textNeu = (teile) => teile.filter((x) => x.t !== "weg").map((x) => x.s).join("");
export const hatAenderung = (teile) => teile.some((x) => x.t !== "gleich");

// Nur für die Anzeige: beide Seiten vor dem Vergleich NFC-normalisiert, damit „é“ (zusammengesetzt) und „é“ (e + Akzent) nicht als Änderung erscheinen.
// Übernommen wird immer der Text der KI, nie diese Anzeige.
export const wortDiffAnzeige = (alt, neu) => wortDiff(String(alt ?? "").normalize("NFC"), String(neu ?? "").normalize("NFC"));
