// Schutz vor riesigen Absätzen (R4-5). Der Markdown-Parser (@lezer/markdown) liest einen Absatz (Zeilen ohne Leerzeile) immer als Ganzes:
//  · `LinkEnd` läuft für jedes `]` rückwärts durch die Liste aller offenen Klammern, bei [[Wikilinks]] bleiben Leerstellen stehen: quadratisch.
//  · jeder Tastendruck liest den ganzen Absatz neu (der inkrementelle Parser kann nur ganze Blöcke wiederverwenden).
// Eingefügte Logs, Transkripte und Exporte sind oft ein einziger Absatz von hunderten KB: gemessen 487 KB = 4,3 s Öffnen, 270 ms je Taste.
// Darum (1) endet ein Absatz im Parser nach ABSATZ_SCHNITT Zeichen und ein neuer beginnt (nur im Syntaxbaum; der Text bleibt unverändert), und
// (2) ab LANGE_ZEILE Zeichen in EINEM Absatz (eine einzige Riesenzeile lässt sich nicht schneiden) gelten Klammern als gewöhnlicher Text.
// Normale Absätze (bis ein paar tausend Zeichen) sind nie betroffen.
export const ABSATZ_SCHNITT = 8000; // Zeichen; danach beginnt im Syntaxbaum ein neuer Absatz
export const LANGE_ZEILE = 20000;   // Zeichen eines Absatzes, ab denen `[`, `]` und `!` im Absatz keine Links mehr einleiten

export const langeAbsaetze = {
  parseBlock: [{
    name: "AbsatzSchnitt",
    parse: () => false, // beginnt nie selbst einen Block; nur die Grenze unten wirkt
    // Nur echte Absätze: Tabellen (Leaf-Parser mit `rows`) und Link-Definitionen (`elts`) sind ebenfalls Leaf-Blöcke und dürfen nie zerschnitten werden (tabellen.js liest die ganze Tabelle)
    endLeaf: (cx, line, leaf) => leaf.content.length > ABSATZ_SCHNITT && !leaf.parsers.some((p) => p && (Array.isArray(p.rows) || Array.isArray(p.elts))),
  }],
  parseInline: [{
    name: "LangerAbsatz",
    before: "Link",
    parse(cx, next, pos) {
      if ((next === 91 /* [ */ || next === 93 /* ] */ || next === 33 /* ! */) && cx.text.length > LANGE_ZEILE) return pos + 1;
      return -1;
    },
  }],
};
