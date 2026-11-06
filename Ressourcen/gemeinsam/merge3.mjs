// gemeinsam/merge3.mjs — Drei-Wege-Zusammenführung für Text (Basis · meine Fassung · die Fassung auf der Platte), Zeile für Zeile.
// Gebraucht, wenn eine offene Notiz von außen geändert wird (KI, Abgleich, anderes Programm), während im Studio getippt wurde:
// Treffen sich die Änderungen nicht, entsteht EIN Text ohne Rückfrage; überschneiden sie sich, bekommt die Oberfläche die Konfliktblöcke zum Wählen.
// Rein und ohne Abhängigkeiten. Byte-Treue: Das Zeilenende gehört zur Zeile ("abc\n", "abc\r\n"; die letzte Zeile ohne Umbruch hat keines) und der Text wird mit "" wieder
// zusammengesetzt. Dadurch zählt „fehlt der Schlussumbruch“ als Änderung der letzten Zeile wie jede andere (und nicht als zusätzliche leere Zeile), CRLF-Dateien bleiben CRLF,
// gemischte Zeilenenden bleiben gemischt.

// Obergrenze für die Tabelle der längsten gemeinsamen Teilfolge (Zeilen × Zeilen). Darüber wird der mittlere Teil nicht Zeile für Zeile
// verglichen, sondern als ein Block behandelt (Rechenzeit und Speicher bleiben begrenzt; nichts geht verloren, die Oberfläche lässt wählen).
const MAX_TABELLE = 6_000_000;

const zeilen = (t) => String(t ?? "").match(/[^\n]*\n|[^\n]+$/g) || [];
const gleich = (a, b) => a.length === b.length && a.every((z, i) => z === b[i]);

// Für jede Zeile von `a` die Nummer der gleichen Zeile in `b` (längste gemeinsame Teilfolge) oder -1.
function zuordnung(a, b, bevorzugeB = false) {
  const n = a.length, m = b.length, aus = new Int32Array(n).fill(-1);
  let von = 0;
  while (von < n && von < m && a[von] === b[von]) { aus[von] = von; von++; }
  let bis = 0;
  while (bis < n - von && bis < m - von && a[n - 1 - bis] === b[m - 1 - bis]) { aus[n - 1 - bis] = m - 1 - bis; bis++; }
  const nn = n - von - bis, mm = m - von - bis;
  if (nn <= 0 || mm <= 0 || nn * mm > MAX_TABELLE) return aus;
  const breite = mm + 1, L = new Uint32Array((nn + 1) * breite);
  for (let i = nn - 1; i >= 0; i--) {
    for (let j = mm - 1; j >= 0; j--) {
      L[i * breite + j] = a[von + i] === b[von + j] ? L[(i + 1) * breite + j + 1] + 1 : Math.max(L[(i + 1) * breite + j], L[i * breite + j + 1]);
    }
  }
  let i = 0, j = 0;
  while (i < nn && j < mm) {
    if (a[von + i] === b[von + j]) { aus[von + i] = von + j; i++; j++; }
    else if (bevorzugeB ? L[(i + 1) * breite + j] > L[i * breite + j + 1] : L[(i + 1) * breite + j] >= L[i * breite + j + 1]) i++;
    else j++;
  }
  return aus;
}

// Dieselbe Zuordnung von hinten gelesen: bei mehreren gleich guten Zuordnungen (gleiche Zeilen in Folge) die andere Wahl. Beide zusammen zeigen, wo die Basis
// offenlässt, welche Zeile geändert wurde — dort entscheidet nicht der Zufall, sondern es gibt einen Konflikt (wie bei Git).
function zuordnungRueck(a, b, bevorzugeB = false) {
  const zu = zuordnung([...a].reverse(), [...b].reverse(), bevorzugeB);
  const n = a.length, m = b.length, aus = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) { const j = zu[n - 1 - i]; if (j >= 0) aus[i] = m - 1 - j; }
  return aus;
}

// Änderungen einer Seite gegenüber der Basis als Liste von Abschnitten { bs, be, z }: die Basiszeilen [bs, be) werden durch die Zeilen z ersetzt.
function abschnitte(B, S, zu) {
  const aus = [];
  let b0 = -1, s0 = -1;
  const schliesse = (i, s1) => { if (i - (b0 + 1) > 0 || s1 - (s0 + 1) > 0) aus.push({ bs: b0 + 1, be: i, z: S.slice(s0 + 1, s1) }); };
  for (let i = 0; i < B.length; i++) {
    if (zu[i] < 0) continue;
    schliesse(i, zu[i]);
    b0 = i; s0 = zu[i];
  }
  schliesse(B.length, S.length);
  return aus;
}
// Wie weit kann ein reines Einfügen oder Löschen in einer Folge gleicher Zeilen hin- und herrutschen (die Basis lässt offen, welche von drei gleichen Zeilen fehlt)?
// Zwei Änderungen, die sich in diesem Spielraum berühren, sind für Git (und hier) ein Konflikt — sonst hinge das Ergebnis vom Zufall der Zuordnung ab.
function spielraum(B, h) {
  let lo = h.bs, hi = h.be;
  const einfuegen = h.bs === h.be && h.z.length > 0, loeschen = h.bs < h.be && h.z.length === 0;
  if (einfuegen) {
    const n = h.z.length;
    for (let u = 0; h.bs - 1 - u >= 0 && B[h.bs - 1 - u] === h.z[(((n - 1 - u) % n) + n) % n]; u++) lo = h.bs - 1 - u;
    for (let d = 0; h.bs + d < B.length && B[h.bs + d] === h.z[d % n]; d++) hi = h.bs + d + 1;
  } else if (loeschen) {
    for (let u = 0; h.bs - 1 - u >= 0 && B[h.bs - 1 - u] === B[h.be - 1 - u]; u++) lo = h.bs - 1 - u;
    for (let d = 0; h.be + d < B.length && B[h.bs + d] === B[h.be + d]; d++) hi = h.be + d + 1;
  }
  return { lo, hi };
}

// → { teile, sauber, konflikte, eigene, fremde }
//   teile: Abschnitte in Reihenfolge, jeweils
//     { t: "gleich", z: [Zeilen] }                      in allen drei Fassungen gleich
//     { t: "auto", z: [Zeilen], von: "meine" | "andere" } nur eine Seite hat hier etwas geändert: ihre Fassung gilt
//     { t: "konflikt", basis: [..], meine: [..], andere: [..] }   beide haben dieselbe Stelle verschieden geändert
//   sauber: es gibt keinen Konfliktblock · konflikte: Anzahl · eigene/fremde: Zahl der Abschnitte, die nur von mir bzw. nur von der anderen Seite stammen
// Wie `git merge-file`: Änderungen, die sich überschneiden oder unmittelbar aneinanderstoßen (keine unveränderte Zeile dazwischen), sind ein Konflikt, außer beide haben
// dasselbe getan. Mindestens eine unveränderte Zeile dazwischen genügt (auch eine leere).
export function zusammenfuehren(basis, meine, andere) {
  const B = zeilen(basis), M = zeilen(meine), A = zeilen(andere);
  const teile = [];
  const schiebe = (t) => {
    const l = teile[teile.length - 1];
    if (l && l.t === t.t && t.t !== "konflikt" && l.von === t.von) l.z.push(...t.z);
    else teile.push(t.t === "konflikt" ? t : { ...t, z: [...t.z] });
  };
  // Abschnitte beider Seiten in zwei Zuordnungen: Zuordnung 1 bestimmt den Text, beide zusammen bestimmen, was sich berührt.
  const abschn = (S, seite) => [
    ...abschnitte(B, S, zuordnung(B, S)).map((h) => ({ ...h, seite, v: 1, ...spielraum(B, h) })),
    ...abschnitte(B, S, zuordnungRueck(B, S)).map((h) => ({ ...h, seite, v: 2, ...spielraum(B, h) })),
    ...abschnitte(B, S, zuordnung(B, S, true)).map((h) => ({ ...h, seite, v: 3, ...spielraum(B, h) })),
    ...abschnitte(B, S, zuordnungRueck(B, S, true)).map((h) => ({ ...h, seite, v: 4, ...spielraum(B, h) })),
  ];
  const alle = [...abschn(M, "meine"), ...abschn(A, "andere")].sort((x, y) => x.lo - y.lo || x.hi - y.hi);
  // Gruppen: Änderungen, deren Spielräume sich überschneiden oder berühren
  const gruppen = [];
  for (const h of alle) {
    const g = gruppen[gruppen.length - 1];
    if (g && h.lo <= g.hi) { g.teile.push(h); g.hi = Math.max(g.hi, h.hi); }
    else gruppen.push({ lo: h.lo, hi: h.hi, teile: [h] });
  }
  const anwenden = (g, seite, v) => {
    const aus = []; let p = g.lo;
    for (const h of g.teile.filter((x) => x.seite === seite && x.v === v).sort((x, y) => x.bs - y.bs)) { aus.push(...B.slice(p, h.bs), ...h.z); p = h.be; }
    aus.push(...B.slice(p, g.hi));
    return aus;
  };
  let pos = 0;
  for (const g of gruppen) {
    const beide = g.teile.some((h) => h.seite === "meine") && g.teile.some((h) => h.seite === "andere");
    if (!beide) {
      const seite = g.teile[0].seite;
      for (const h of g.teile.filter((x) => x.v === 1).sort((x, y) => x.bs - y.bs)) {
        if (h.bs > pos) schiebe({ t: "gleich", z: B.slice(pos, h.bs) });
        schiebe({ t: "auto", z: h.z, von: seite });
        pos = h.be;
      }
      continue;
    }
    if (g.lo > pos) schiebe({ t: "gleich", z: B.slice(pos, g.lo) });
    const m = anwenden(g, "meine", 1), a = anwenden(g, "andere", 1);
    // „Beide haben dasselbe getan“ gilt nur, wenn es bei beiden Zuordnungen so ist
    if (gleich(m, a) && [2, 3, 4].every((v) => gleich(anwenden(g, "meine", v), anwenden(g, "andere", v)))) schiebe({ t: "auto", z: m, von: "meine" }); // beide haben dasselbe getan
    else teile.push({ t: "konflikt", basis: B.slice(g.lo, g.hi), meine: m, andere: a });
    pos = g.hi;
  }
  if (pos < B.length) schiebe({ t: "gleich", z: B.slice(pos) });
  const konflikte = teile.filter((t) => t.t === "konflikt").length;
  return {
    teile, konflikte, sauber: konflikte === 0,
    eigene: teile.filter((t) => t.t === "auto" && t.von === "meine").length,
    fremde: teile.filter((t) => t.t === "auto" && t.von === "andere").length,
  };
}

// Text aus den Abschnitten. wahl: je Konfliktblock der Reihe nach "meine" | "andere" | "beide" (meine, dann andere) | { text } (selbst zusammengeführt).
// Ohne Konflikt ist wahl leer.
export function baue(teile, wahl = []) {
  const aus = [];
  let k = 0;
  for (const t of teile) {
    if (t.t !== "konflikt") { aus.push(...t.z); continue; }
    const w = wahl[k++];
    if (w === "meine") aus.push(...t.meine);
    else if (w === "andere") aus.push(...t.andere);
    else if (w === "beide") {
      const m = [...t.meine];
      if (m.length && t.andere.length && !m[m.length - 1].endsWith("\n")) m[m.length - 1] += "\n"; // meine letzte Zeile hatte keinen Umbruch: die andere beginnt auf einer neuen Zeile
      aus.push(...m, ...t.andere);
    }
    else if (w && typeof w === "object" && typeof w.text === "string") aus.push(w.text); // der Text gilt wörtlich (mit seinen Zeilenenden)
    else throw new Error("Für jeden Konfliktblock fehlt eine gültige Wahl.");
  }
  return aus.join("");
}

export const WAHLEN = ["meine", "andere", "beide"];
// Ist `w` eine zulässige Wahl für einen Konfliktblock?
export const istWahl = (w) => WAHLEN.includes(w) || (!!w && typeof w === "object" && !Array.isArray(w) && typeof w.text === "string");
