// Konflikt-Ansicht: dieselbe Notiz wurde auf zwei Geräten geändert. Liste der betroffenen Einträge links, rechts beide Fassungen nebeneinander (Zeilen-Vergleich,
// gleiche Zeilen eingeklappt), vier Wege je Notiz (diese · andere · beide · selbst zusammenführen) und optional ein Vorschlag der KI. Sonderfälle: auf einem Gerät
// gelöscht, auf dem anderen geändert · dieselbe Aufgaben-Karte in zwei Spalten. Abschluss mit einem Klick (⌘↩): Entscheidungen festhalten, abgleichen, Erfolg, Rückgängig.
// Die Daten und das Festhalten liefert der Kern über die Werkstatt (api.gitKonflikt…, kern/abgleich-konflikt.mjs). Kein innerHTML: alles über h() und textContent.
import { h, toast, vorMinuten } from "./hilfen.js";
import { knopf as baueKnopf, setzeLaedt, textbereich, wenigBewegung } from "./bausteine.js";
import { symbol } from "./symbole.js";
import { gitGesperrt, ausgangUnklar } from "./api.js";
import { TK, konfliktLabel, ANDERES_GERAET, DIESER_MAC } from "./texte-konflikt.js";

const istText = (it) => it.typ === "text" || it.typ === "umbenannt";
const nameVon = (p) => String(p || "").split("/").pop().replace(/\.[^.]+$/, "");

const MAX_ZEILEN = 4000; // darüber wird nicht Zeile für Zeile verglichen (Rechenzeit): die Fassungen sind nur wählbar
const zeichen = (name, groesse = 14) => { const s = symbol(name, groesse); s.setAttribute("aria-hidden", "true"); return s; };
const kbd = (t) => h("kbd", { klasse: "k-kbd", text: t });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const symFuer = (name) => (/iphone|ipad|handy|phone|android|telefon/i.test(name || "") ? "telefon" : "laptop");

// ---------------------------------------------------------------- Zeit
const MONATE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
export function zeitText(iso) {
  const min = iso ? vorMinuten(iso) : null;
  if (min === null) return null;
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min`;
  if (min < 24 * 60) return `vor ${Math.floor(min / 60)} Std`;
  const d = new Date(iso);
  return `${d.getDate()}. ${MONATE[d.getMonth()]}`;
}
const uhrzeit = (iso) => { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : null; };

// ---------------------------------------------------------------- Zeilen-Vergleich (rein, exportiert für Tests)
const zeilenVon = (t) => String(t ?? "").replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
// Längste gemeinsame Teilfolge → Abschnitte: { t: "same", z: [...] } oder { t: "block", mac: [...], anderes: [...], wahl: null, eigen: "" }
export function zeilenAbschnitte(a, b) {
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const segs = []; let i = 0, j = 0, blk = null, bi = 0;
  const zu = () => { if (blk) { blk.bi = bi++; segs.push(blk); blk = null; } };
  const neu = () => (blk = blk || { t: "block", mac: [], anderes: [], wahl: null, eigen: "" });
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      zu(); const l = segs[segs.length - 1];
      if (l && l.t === "same") l.z.push(a[i]); else segs.push({ t: "same", z: [a[i]] });
      i++; j++;
    } else if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) neu().anderes.push(b[j++]);
    else neu().mac.push(a[i++]);
  }
  zu();
  return segs;
}
function parseZeile(s) {
  let m;
  if ((m = s.match(/^(#{1,6}) (.*)$/))) return { k: m[1].length <= 2 ? "h" : "p", t: m[2] };
  if ((m = s.match(/^\s*[-*] \[( |x|X)\] (.*)$/))) return { k: "todo", done: m[1] !== " ", t: m[2] };
  if ((m = s.match(/^\s*[-*] (.*)$/))) return { k: "li", t: m[1] };
  return { k: "p", t: s };
}
// Welche Wörter unterscheiden sich? → { ma, mb: Mengen der Wortnummern, aehnlich }
function wortUnterschied(a, b) {
  const A = a.split(/\s+/).filter(Boolean), B = b.split(/\s+/).filter(Boolean);
  const L = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ma = new Set(A.map((_, i) => i)), mb = new Set(B.map((_, i) => i));
  let i = 0, j = 0;
  while (i < A.length && j < B.length) { if (A[i] === B[j]) { ma.delete(i); mb.delete(j); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++; }
  return { ma, mb, aehnlich: L[0][0] / Math.max(A.length, B.length, 1) };
}
function markiert(text, set) {
  if (!set || !set.size) return [text];
  // Wörter und Leerraum trennen; aufeinanderfolgende markierte Wörter bilden EINE Markierung (der Leerraum dazwischen gehört hinein), Leerraum am Rand bleibt draußen
  const teile = text.split(/(\s+)/).filter(Boolean), aus = [];
  let i = 0, lauf = null;
  const schliesse = () => { lauf = null; };
  for (let k = 0; k < teile.length; k++) {
    const p = teile[k];
    if (/^\s+$/.test(p)) {
      const naechsteMarkiert = k + 1 < teile.length && set.has(i);
      if (lauf && naechsteMarkiert) lauf.textContent += p; else { schliesse(); aus.push(p); }
      continue;
    }
    if (set.has(i++)) { if (!lauf) { lauf = h("mark", { klasse: "w" }); aus.push(lauf); } lauf.textContent += p; }
    else { schliesse(); aus.push(p); }
  }
  return aus;
}
function zeileEl(p, set, boxD) {
  const t = markiert(p.t, set);
  if (p.k === "h") return h("span", { klasse: "zl h" }, ...t);
  if (p.k === "todo") return h("span", { klasse: "zl li" }, h("span", { klasse: "kbox" + (p.done ? " an" : "") + (boxD ? " d" : "") }, p.done ? zeichen("haken", 12) : null), h("span", { klasse: p.done ? "erl" : "" }, ...t));
  if (p.k === "li") return h("span", { klasse: "zl li" }, h("span", { klasse: "pt" }), h("span", null, ...t));
  return h("span", { klasse: "zl" }, ...t);
}
// Nebeneinander stellen: Zeilen derselben Position, die sich ähneln, werden Wort für Wort verglichen
function zeilenPaare(s) {
  const rows = [], m = Math.max(s.mac.length, s.anderes.length);
  for (let i = 0; i < m; i++) {
    const a = s.mac[i], b = s.anderes[i];
    if (a != null && b != null) {
      const pa = parseZeile(a), pb = parseZeile(b), w = wortUnterschied(pa.t, pb.t);
      if (w.aehnlich >= 0.3) { rows.push({ l: pa, r: pb, ml: w.ma, mr: w.mb, boxD: pa.done !== pb.done }); continue; }
    }
    if (a != null) rows.push({ l: parseZeile(a) });
    if (b != null) rows.push({ r: parseZeile(b) });
  }
  return rows;
}

// ---------------------------------------------------------------- Ansicht
// ctx: { api, daten, aufgabenOrdner, beiSchliessen(), beiFertig({ geloest }), beiStandNeu(err), host }
export function zeigeKonflikt(host, ctx) {
  const { api, daten } = ctx;
  const G = daten.geraet || null;
  const gName = G || "dem anderen Gerät", gKurz = G || ANDERES_GERAET.toLowerCase();
  const von = G ? `von ${G}` : "vom anderen Gerät", auf = G ? `auf ${G}` : "auf dem anderen Gerät";
  // Gerät, von dem die andere Fassung DIESER Datei stammt (kann je Datei verschieden sein)
  const gDatei = (it) => it.andere.geraet || G;
  const vonDatei = (it) => (gDatei(it) ? `von ${gDatei(it)}` : "vom anderen Gerät"), aufDatei = (it) => (gDatei(it) ? `auf ${gDatei(it)}` : "auf dem anderen Gerät"), nameDatei = (it) => gDatei(it) || "dem anderen Gerät";
  const items = (daten.dateien || []).map((d) => {
    const it = { ...d, id: d.pfad, entscheidung: null, text: null, modus: "vergleich", kiStand: "aus", viaKI: false, ki: null };
    if ((d.typ === "text" || d.typ === "umbenannt") && d.meine.text != null && d.andere.text != null) {
      const za = zeilenVon(d.meine.text), zb = zeilenVon(d.andere.text);
      if (za.length <= MAX_ZEILEN && zb.length <= MAX_ZEILEN) it.segs = zeilenAbschnitte(za, zb);
    }
    it.nurWahl = (d.typ === "text" || d.typ === "umbenannt") && !it.segs;
    return it;
  });
  const KS = { phase: "liste", sel: 0, auf: {}, weiter: null, ki: { verfuegbar: false, konto: null, name: "", stufe: "lesen" }, snap: null, laeuft: false, zerstoert: false };
  const wurzel = h("div", { klasse: "konflikt", id: "konflikt", "data-phase": "liste", "data-konflikt": "" });
  host.replaceChildren(wurzel);

  const nurAnsehen = !!daten.fremd; // die offene Zusammenführung hat Kortex nicht begonnen: nur ansehen
  const bloecke = (it) => (it.segs || []).filter((s) => s.t === "block");
  const alleGeloest = () => items.length > 0 && items.every((i) => i.entscheidung);
  const akt = () => items[KS.sel];
  const seiteName = (it, k) => (k === "meine" ? DIESER_MAC : it.andere.geraet || G || ANDERES_GERAET);
  const spaltenName = (id) => TK.spalte[id] || id || "–";
  const fmtFaellig = (iso) => { if (!iso) return null; const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(iso); return m ? `${Number(m[3])}. ${MONATE[Number(m[2]) - 1]}` : iso; };

  // ---------- Kopf, Fassungen ----------
  const kopfZelle = (it, k, cls, marke) => {
    const s = it[k], name = seiteName(it, k);
    const z = zeitText(s.zeit);
    const wasText = s.vorhanden ? (it.typ === "geloescht" ? TK.fassung.geaendert : TK.fassung.gespeichert) : TK.fassung.geloescht;
    return h("div", { klasse: "k-dk " + cls, "data-seite": k }, zeichen(symFuer(name), 14), h("b", { text: name }), h("i", { text: z ? `${z} ${wasText}` : TK.fassung.unbekannt }), marke || null);
  };
  const badge = (text, art) => h("span", { klasse: "k-badge" + (art ? " " + art : ""), text });
  function vergleichText(it) {
    const kinder = [kopfZelle(it, "meine", "l", badge(TK.fassung.deine, "marke")), kopfZelle(it, "andere", "r")];
    it.segs.forEach((s, si) => {
      if (s.t === "same") {
        const g = gleiche(it, si), zeile = (z) => [h("div", { klasse: "k-c l" }, zeileEl(parseZeile(z))), h("div", { klasse: "k-c" }, zeileEl(parseZeile(z)))];
        g.kopf.forEach((z) => kinder.push(...zeile(z)));
        if (g.n) kinder.push(h("div", { klasse: "k-ausg" }, baueKnopf({ text: TK.fassung.gleiche(g.n), variante: "leise", groesse: "s", symbol: "chevron-unten", daten: { "data-aus": String(si) }, aufKlick: () => { KS.auf[it.id + ":" + si] = true; zeichneDetail(); } })));
        g.ende.forEach((z) => kinder.push(...zeile(z)));
        return;
      }
      const paare = zeilenPaare(s);
      paare.forEach((r, ri) => {
        const ex = (ri === 0 ? " erste" : "") + (ri === paare.length - 1 ? " letzte" : "");
        kinder.push(r.l ? h("div", { klasse: "k-c l an" + ex }, zeileEl(r.l, r.ml, r.boxD)) : h("div", { klasse: "k-c l gap" + ex }));
        kinder.push(r.r ? h("div", { klasse: "k-c an" + ex }, zeileEl(r.r, r.mr, r.boxD)) : h("div", { klasse: "k-c gap" + ex }));
      });
    });
    return [h("div", { klasse: "k-diff", "data-vergleich": "text" }, ...kinder),
      h("div", { klasse: "k-legende" }, h("span", null, h("i"), TK.fassung.legUnterschied), h("span", null, h("i", { klasse: "w" }), TK.fassung.legWort), h("span", null, h("i", { klasse: "g" }), TK.fassung.legLuecke))];
  }
  function gleiche(it, si) {
    const s = it.segs[si], n = s.z.length, vorn = si > 0 ? 1 : 0, hinten = si < it.segs.length - 1 ? 1 : 0;
    if (KS.auf[it.id + ":" + si] || n <= vorn + hinten + 1) return { kopf: s.z, n: 0, ende: [] };
    return { kopf: s.z.slice(0, vorn), n: n - vorn - hinten, ende: s.z.slice(n - hinten) };
  }
  function ohneZeilenVergleich(it) { // Text zu groß oder kein Text: nur nebeneinander nennen
    const seite = (k) => {
      const s = it[k];
      return h("div", { klasse: "k-fassung" }, kopfZelle(it, k, "", k === "meine" ? badge(TK.fassung.deine, "marke") : null),
        h("div", { klasse: "k-weg" }, h("p", { text: s.gross ? TK.fassung.gross : TK.fassung.keinText })));
    };
    return [h("div", { klasse: "k-zwei" }, seite("meine"), seite("andere"))];
  }
  function vergleichGeloescht(it) {
    const hat = it.wer === "andere" ? "meine" : "andere", weg = it.wer === "andere" ? "andere" : "meine";
    const meineZeilen = zeilenVon(hat === "meine" ? it.meine.text : it.andere.text), neu = new Set(it.neueZeilen || []);
    const text = h("div", { klasse: "k-fl" }, ...meineZeilen.map((z) => h("div", { klasse: "k-zl" + (neu.has(z) ? " neu" : "") }, zeileEl(parseZeile(z)))));
    const wegKarte = () => h("div", { klasse: "k-weg" }, h("span", { klasse: "kreis" }, zeichen("papierkorb", 20)),
      h("b", { text: weg === "andere" ? TK.fassung.wegAnderswoTitel(gName) : TK.fassung.wegHierTitel }),
      h("p", { text: weg === "andere" ? TK.fassung.wegAnderswoText(gName) : TK.fassung.wegHierText(gName) }));
    const spalte = (k) => (k === hat
      ? h("div", { klasse: "k-fassung" }, kopfZelle(it, k, "", badge(TK.fassung.geaendertMarke, "marke")), text)
      : h("div", { klasse: "k-fassung" }, kopfZelle(it, k, "", badge(TK.fassung.geloeschtMarke, "warn")), wegKarte()));
    return [h("div", { klasse: "k-zwei", "data-vergleich": "geloescht" }, spalte("meine"), spalte("andere")),
      neu.size ? h("div", { klasse: "k-legende" }, h("span", null, h("i"), TK.fassung.legNeu)) : null];
  }
  function vergleichKarte(it) {
    const k = it.karte, an = (f) => (k.meine[f] !== k.andere[f] ? " an" : "");
    const sp = (id) => h("span", { klasse: "k-sp", "data-spalte": id }, h("span", { klasse: "k-punkt " + id }), spaltenName(id));
    const spalte = (seite) => {
      const s = k[seite];
      return h("div", { klasse: "k-fassung" }, kopfZelle(it, seite, "", seite === "meine" ? badge(TK.fassung.deine, "marke") : null),
        h("div", { klasse: "k-kv" },
          h("div", { klasse: "k-kz" + an("spalte") }, h("span", { klasse: "l", text: TK.fassung.spalteLabel }), h("span", { klasse: "v" }, k.vorher ? h("span", { klasse: "k-vor", text: spaltenName(k.vorher) }) : null, k.vorher ? zeichen("pfeil", 12) : null, sp(s.spalte))),
          h("div", { klasse: "k-kz" + an("faellig") }, h("span", { klasse: "l", text: TK.fassung.faelligLabel }), h("span", { klasse: "v" }, zeichen("kalender", 14), h("span", { text: fmtFaellig(s.faellig) || "–" }))),
          h("div", { klasse: "k-kz" }, h("span", { klasse: "l", text: TK.fassung.notizLabel }), h("span", { klasse: "v" }, zeichen("notiz", 14), h("span", { text: it.titel })))));
    };
    return [h("div", { klasse: "k-zwei", "data-vergleich": "karte" }, spalte("meine"), spalte("andere")),
      h("div", { klasse: "k-legende" }, h("span", null, h("i"), TK.fassung.legUnterschied), h("span", { text: k.vorher ? TK.fassung.karteHinweis(spaltenName(k.vorher)) : TK.fassung.karteOhneVorher }))];
  }
  const vergleich = (it) => (it.typ === "geloescht" ? vergleichGeloescht(it) : it.typ === "board" ? vergleichKarte(it) : it.segs ? vergleichText(it) : ohneZeilenVergleich(it));

  // ---------- Selbst zusammenführen ----------
  function ueberschrift(it, si) {
    for (let i = si - 1; i >= 0; i--) { const s = it.segs[i]; if (s.t === "same") for (let j = s.z.length - 1; j >= 0; j--) if (/^#{1,2} /.test(s.z[j])) return s.z[j].replace(/^#+ /, ""); }
    return TK.merge.anfang;
  }
  function ergebnisZeilen(it) {
    const out = [];
    it.segs.forEach((s) => {
      if (s.t === "same") return s.z.forEach((z) => out.push({ z, q: "g" }));
      const w = s.wahl;
      if (!w) return out.push({ offen: true, bi: s.bi });
      const zs = w === "meine" ? s.mac.map((z) => [z, "meine"]) : w === "anderes" ? s.anderes.map((z) => [z, "anderes"]) : w === "beide" ? s.mac.map((z) => [z, "meine"]).concat(s.anderes.map((z) => [z, "anderes"]))
        : (s.eigen || "").split("\n").filter((x) => x.trim()).map((z) => [z, "eigen"]);
      zs.forEach(([z, q]) => out.push({ z, q, bi: s.bi }));
    });
    return out;
  }
  // Zeilenenden der Notiz bleiben erhalten (CRLF bleibt CRLF), auch für selbst geschriebene Zeilen
  const zeilenEnde = (it) => (/\r\n/.test(it.meine.text || "") || (/\r\n/.test(it.andere.text || "") && !/(^|[^\r])\n/.test(it.meine.text || "")) ? "\r\n" : "\n");
  const ergebnisText = (it) => { const eol = zeilenEnde(it); return ergebnisZeilen(it).filter((r) => !r.offen).map((r) => r.z.replace(/\r?\n/g, eol)).join(eol) + (/\n$/.test(it.meine.text || "") ? eol : ""); };
  function ergebnisBox(it) {
    const bl = bloecke(it), n = bl.filter((b) => b.wahl).length;
    const q = { meine: TK.merge.quelleMac, anderes: it.andere.geraet || G || ANDERES_GERAET, eigen: TK.merge.quelleEigen };
    return [h("div", { klasse: "k-erg-kopf" }, zeichen("notiz", 14), h("span", { klasse: "cap", text: TK.merge.ergebnisTitel }), h("span", { klasse: "tnum", text: `${n}/${bl.length}` })),
      h("div", { klasse: "k-erg-liste" }, ...ergebnisZeilen(it).map((r) => (r.offen
        ? h("button", { klasse: "k-er offen", type: "button", "data-spring": String(r.bi), text: TK.merge.abschnittOffen(r.bi + 1), aufClick: () => wurzel.querySelector(`#k-b${r.bi}`)?.scrollIntoView({ block: "center", behavior: wenigBewegung() ? "auto" : "smooth" }) })
        : h("div", { klasse: "k-er q-" + r.q }, zeileEl(parseZeile(r.z)), r.q !== "g" ? h("span", { klasse: "qq", text: q[r.q] }) : null))))];
  }
  function mergeAnsicht(it) {
    const bl = bloecke(it), n = bl.filter((b) => b.wahl).length;
    const setze = (blk, neu) => {
      if (neu === "eigen") { if (blk.wahl !== "eigen") blk.eigen = blk.mac.concat(blk.anderes).join("\n"); blk.wahl = blk.wahl === "eigen" ? null : "eigen"; }
      else blk.wahl = blk.wahl === neu ? null : neu;
      zeichneDetail();
      if (blk.wahl === "eigen") wurzel.querySelector(`[data-eigen="${blk.bi}"] textarea`)?.focus();
    };
    const lk = h("div", { klasse: "k-merge-lk" }, h("div", { klasse: "k-merge-kopf" }, h("b", { text: TK.merge.titel }),
      baueKnopf({ text: TK.merge.alleMac, variante: "leise", groesse: "s", daten: { "data-alle": "meine" }, aufKlick: () => { bl.forEach((x) => (x.wahl = "meine")); zeichneDetail(); } }),
      baueKnopf({ text: TK.merge.alleAndere(von), variante: "leise", groesse: "s", daten: { "data-alle": "anderes" }, aufKlick: () => { bl.forEach((x) => (x.wahl = "anderes")); zeichneDetail(); } })));
    it.segs.forEach((s, si) => {
      if (s.t === "same") {
        const g = gleiche(it, si), z = (a) => a.map((x) => h("div", { text: x.replace(/^#+ /, "").replace(/^\s*[-*] (\[[ xX]\] )?/, "· ") }));
        lk.append(h("div", { klasse: "k-ctx" }, ...z(g.kopf), g.n ? h("em", { text: TK.merge.gleicheZeilen(g.n) }) : null, ...z(g.ende)));
        return;
      }
      const opt = (k, lbl, sym, seite) => h("button", { klasse: "k-opt", type: "button", "data-w": k, "aria-pressed": String(s.wahl === k || s.wahl === "beide"), aufClick: () => setze(s, k) },
        h("span", { klasse: "oh" }, zeichen(sym, 12), lbl, zeichen("haken", 14)),
        ...(s[seite].length ? s[seite].map((z) => h("span", { klasse: "ol" }, zeileEl(parseZeile(z)))) : [h("span", { klasse: "nix", text: TK.merge.nichts })]));
      const stand = { meine: TK.merge.vonMac, anderes: TK.merge.vonAndere(it.andere.geraet || G || ANDERES_GERAET), beide: TK.merge.beide, eigen: TK.merge.eigen }[s.wahl];
      let eigen = null;
      if (s.wahl === "eigen") {
        const tb = textbereich({ wert: s.eigen, minZeilen: 2, maxZeilen: 10, label: TK.merge.eigenLabel(s.bi + 1), beiEingabe: (w) => { s.eigen = w; zeichneErgebnis(); } });
        eigen = h("div", { klasse: "k-eigen", "data-eigen": String(s.bi) }, tb.el);
      }
      lk.append(h("section", { klasse: "k-blk" + (s.wahl ? " fertig" : ""), id: `k-b${s.bi}`, "data-b": String(s.bi) },
        h("div", { klasse: "k-blk-kopf" }, h("b", { text: TK.merge.abschnitt(s.bi + 1) }), h("span", { text: ueberschrift(it, si) }), h("span", { klasse: "z" + (s.wahl ? " ok" : "") }, ...(s.wahl ? [zeichen("haken", 12), stand] : [TK.merge.offen]))),
        eigen || h("div", { klasse: "k-opts" }, opt("meine", DIESER_MAC, symFuer(DIESER_MAC), "mac"), opt("anderes", it.andere.geraet || G || ANDERES_GERAET, symFuer(it.andere.geraet || G), "anderes")),
        h("div", { klasse: "k-blk-akt" },
          baueKnopf({ text: TK.merge.beideUebernehmen, variante: "leise", groesse: "s", symbol: "kopieren", daten: { "data-w": "beide", "aria-pressed": String(s.wahl === "beide") }, aufKlick: () => setze(s, "beide") }),
          baueKnopf({ text: TK.merge.selbstSchreiben, variante: "leise", groesse: "s", symbol: "stift", daten: { "data-w": "eigen", "aria-pressed": String(s.wahl === "eigen") }, aufKlick: () => setze(s, "eigen") }))));
    });
    const erg = h("aside", { klasse: "k-erg", id: "k-erg" }, ...ergebnisBox(it));
    const fuss = h("div", { klasse: "k-merge-fuss" }, h("span", { id: "k-merge-z", text: TK.merge.gewaehlt(n, bl.length) }), h("span", { klasse: "sp" }),
      baueKnopf({ text: TK.merge.zurueck, groesse: "s", nach: [kbd("esc")], daten: { "data-k": "zurueck" }, aufKlick: () => { it.modus = "vergleich"; zeichneDetail(); } }),
      baueKnopf({ text: TK.merge.uebernehmen, variante: "primaer", groesse: "s", nach: [h("span", { klasse: "chip-key", text: "⌘↩" })], disabled: n !== bl.length, daten: { "data-k": "uebernehmen" }, aufKlick: () => mergeUebernehmen(it) }));
    return [h("div", { klasse: "k-merge" }, lk, erg), fuss];
  }
  function zeichneErgebnis() { const it = akt(); const e = wurzel.querySelector("#k-erg"); if (e && it) e.replaceChildren(...ergebnisBox(it)); }
  function mergeUebernehmen(it) {
    if (!istText(it) || bloecke(it).some((b) => !b.wahl)) return;
    it.entscheidung = "zusammen"; it.text = ergebnisText(it); it.viaKI = false; it.modus = "vergleich";
    zeichne(); weiter();
  }
  // Frei bearbeiten (Vorschlag der KI anpassen): ganzer Text in einem Feld
  function freiAnsicht(it) {
    const tb = textbereich({ wert: it.freiText ?? it.text ?? "", minZeilen: 12, maxZeilen: 28, label: TK.merge.freiLabel, beiEingabe: (w) => { it.freiText = w; } });
    const fuss = h("div", { klasse: "k-merge-fuss" }, h("span", { text: TK.merge.freiTitel }), h("span", { klasse: "sp" }),
      baueKnopf({ text: TK.merge.zurueck, groesse: "s", nach: [kbd("esc")], aufKlick: () => { it.modus = "vergleich"; zeichneDetail(); } }),
      baueKnopf({ text: TK.merge.uebernehmen, variante: "primaer", groesse: "s", nach: [h("span", { klasse: "chip-key", text: "⌘↩" })], daten: { "data-k": "uebernehmen" }, aufKlick: () => { it.entscheidung = "zusammen"; it.text = it.freiText ?? it.text ?? ""; it.viaKI = !!it.kiVorschau; it.kiVorschau = false; it.modus = "vergleich"; zeichne(); weiter(); } }));
    setTimeout(() => tb.fokus(), 0);
    return [h("div", { klasse: "k-frei" }, tb.el), fuss];
  }

  // ---------- KI ----------
  const kiKarte = (it) => {
    if (it.kiStand === "aus") return null;
    const k = KS.ki, art = TK.ki.art[it.typ] || TK.ki.art.text;
    const kopf = (titel, akt2) => h("div", { klasse: "k-ki-kopf" }, h("span", { klasse: "k-ki-logo" }, zeichen("funke", 12)), h("b", { text: titel }), h("span", { klasse: "akt" }, ...akt2));
    if (it.kiStand === "denkt") return h("div", { klasse: "k-ki", "data-ki": "denkt" }, kopf(TK.ki.titelDenkt, [baueKnopf({ text: TK.ki.abbrechen, variante: "leise", groesse: "s", daten: { "data-k": "ki-nein" }, aufKlick: () => kiAbbrechen(it) })]),
      h("div", { klasse: "k-ki-denkt" }, h("span", { klasse: "sp" }), h("span", { klasse: "bs-text-schimmer", text: TK.ki.denkt })));
    if (it.kiStand === "fehler") return h("div", { klasse: "k-ki", "data-ki": "fehler" }, kopf(TK.ki.titelFertig(k.name), [baueKnopf({ text: TK.ki.verwerfen, variante: "leise", groesse: "s", aufKlick: () => { it.kiStand = "aus"; zeichneDetail(); } })]), h("div", { klasse: "k-ki-text" }, h("p", { text: it.kiFehler || TK.ki.fehler })));
    const zusammen = it.ki.wahl === "zusammen" && istText(it);
    return h("div", { klasse: "k-ki", "data-ki": "da" }, kopf(TK.ki.titelFertig(k.name), [
      baueKnopf({ text: TK.ki.verwerfen, variante: "leise", groesse: "s", daten: { "data-k": "ki-nein" }, aufKlick: () => { it.kiStand = "aus"; zeichneDetail(); } }),
      // ein zusammengeführter Text der KI wird nie ungesehen übernommen: erst ansehen (und ändern können), dort übernehmen
      zusammen ? baueKnopf({ text: TK.ki.textAnsehen, groesse: "s", symbol: "stift", daten: { "data-k": "ki-anpassen" }, aufKlick: () => { it.freiText = it.ki.text; it.kiStand = "aus"; it.modus = "frei"; it.kiVorschau = true; zeichneDetail(); } })
        : baueKnopf({ text: TK.ki.uebernehmen, groesse: "s", symbol: "haken", daten: { "data-k": "ki-ja" }, aufKlick: () => kiUebernehmen(it) })]),
    h("div", { klasse: "k-ki-text" }, h("p", { text: it.ki.satz }), it.ki.punkte.length ? h("ul", null, ...it.ki.punkte.map(([a, b]) => h("li", null, h("b", { text: a }), h("span", { text: b })))) : null, zusammen ? h("p", { klasse: "k-ki-hinweis", text: TK.ki.textHinweis }) : null),
    h("div", { klasse: "k-ki-fuss" }, zeichen("schild", 12), h("span", { text: TK.ki.fuss(TK.ki.stufe[k.stufe] || k.stufe, art) })));
  };
  const kiFrage = (it) => {
    const kopfZ = it.typ === "geloescht" ? `Die Notiz „${it.pfad}“ wurde auf einem Gerät gelöscht und auf dem anderen weiter geändert.` : it.typ === "board" ? `Die Aufgaben-Karte „${it.pfad}“ wurde auf zwei Geräten verschoben.` : `Die Notiz „${it.pfad}“ wurde auf zwei Geräten gleichzeitig geändert.`;
    return `${kopfZ} Lies die Datei mit brain_lesen: Zwischen den Zeilen mit <<<<<<< und >>>>>>> stehen beide Fassungen (oben: Dieser Mac, unten: ${gKurz}). Vergleiche sie und antworte GENAU in diesem Format, ohne weiteren Text:\n`
      + `EMPFEHLUNG: ${istText(it) ? "dieser | andere | beide | zusammen" : "dieser | andere"}\nBEGRUENDUNG: ein Satz\nPUNKTE:\n- Stichwort: kurzer Satz\n`
      + `${istText(it) ? "Bei zusammen folgt danach eine Zeile TEXT: und darunter der vollständige zusammengeführte Text der Notiz, ohne Quellenangaben und ohne neue Verweise.\n" : ""}`;
  };
  // Der Text der KI muss zu den beiden Fassungen passen: keine Konfliktmarken, Länge zwischen der halben kürzeren und der Summe beider, keine Verweise [[…]], die in keiner Fassung stehen
  function textPlausibel(it, text) {
    if (/^(<{7}|={7}|>{7})/m.test(text)) return false;
    const la = it.meine.text.length, lb = it.andere.text.length, n = text.length;
    if (n < Math.min(la, lb) * 0.5 || n > (la + lb) * 1.1 + 200) return false;
    const links = (t) => new Set((t.match(/\[\[[^\]]+\]\]/g) || []));
    const erlaubt = new Set([...links(it.meine.text), ...links(it.andere.text)]);
    for (const l of links(text)) if (!erlaubt.has(l)) return false;
    return true;
  }
  function kiLesen(it, antwort) {
    const rohe = String(antwort || "");
    const m = /^\s*EMPFEHLUNG:\s*(dieser|andere|beide|zusammen)\b/im.exec(rohe);
    if (!m) return null;
    let wahl = m[1].toLowerCase();
    if (!istText(it) && (wahl === "beide" || wahl === "zusammen")) wahl = "dieser";
    const satz = (/^\s*BEGRUENDUNG:\s*(.+)$/im.exec(rohe) || [])[1]?.trim() || "";
    const punkte = [];
    const pm = /PUNKTE:\s*\n([\s\S]*?)(?:\n\s*TEXT:|$)/i.exec(rohe);
    if (pm) for (const z of pm[1].split("\n")) { const x = /^\s*-\s*([^:]{1,60}):\s*(.+)$/.exec(z); if (x) punkte.push([x[1].trim(), x[2].trim()]); }
    let text = null;
    if (wahl === "zusammen") { const t = /\n\s*TEXT:\s*\n?([\s\S]*)$/i.exec(rohe); text = t ? t[1].replace(/^```\w*\n?|\n?```\s*$/g, "").trimEnd() + "\n" : null; if (!text || !text.trim() || !textPlausibel(it, text)) return null; }
    return { wahl: { dieser: "meine", andere: "andere", beide: "beide", zusammen: "zusammen" }[wahl], text, satz: satz || "—", punkte: punkte.slice(0, 5) };
  }
  async function kiFragen(it) {
    if (!KS.ki.verfuegbar || it.modus === "stand") return;
    if (it.kiStand !== "aus") { kiAbbrechen(it); return; }
    it.kiStand = "denkt"; const lauf = (it.kiLauf = {}); zeichneDetail();
    let id;
    try { ({ id } = await api.frageStart(kiFrage(it), KS.ki.konto)); }
    catch (e) { if (it.kiLauf !== lauf) return; it.kiStand = "fehler"; it.kiFehler = e?.message || TK.ki.fehlerStart; zeichneDetail(); return; }
    lauf.id = id;
    let ab = 0, textAb = 0, epoche = 0, antwort = "", fehler = 0;
    while (it.kiLauf === lauf && !KS.zerstoert) {
      let r;
      try { r = await api.frageStand({ id, ab, text: textAb, epoche }); fehler = 0; }
      catch (e) { if (e?.status === 404 || ++fehler > 3) { if (it.kiLauf === lauf) { it.kiStand = "fehler"; it.kiFehler = TK.ki.fehlerStart; zeichneDetail(); } return; } await warte(400); continue; }
      antwort = r.epoche !== epoche ? r.text : antwort + r.text; epoche = r.epoche; textAb = r.textAb; ab = r.n;
      if (r.fertig) { if (it.kiLauf !== lauf) return; const k = r.ergebnis?.ok === false ? null : kiLesen(it, antwort); if (k) { it.ki = k; it.kiStand = "da"; } else { it.kiStand = "fehler"; it.kiFehler = r.ergebnis?.fehler || TK.ki.fehler; } it.kiLauf = null; zeichneDetail(); return; }
    }
  }
  function kiAbbrechen(it) { const l = it.kiLauf; it.kiLauf = null; it.kiStand = "aus"; if (l?.id) { try { api.frageAbbrechen?.(l.id); } catch { /* egal */ } } zeichneDetail(); }
  function kiUebernehmen(it) {
    const w = it.ki.wahl;
    if (w === "zusammen") return; // nie ungesehen: nur über „Text ansehen“
    it.entscheidung = w;
    it.viaKI = true; it.kiStand = "aus"; it.modus = "vergleich";
    zeichne(); weiter();
  }

  // ---------- Entscheidungen ----------
  const aktionenFuer = (it) => {
    const e = it.entscheidung, a = [];
    if (it.typ === "geloescht") {
      const gelA = it.wer === "andere";
      a.push(["meine", 1, gelA ? TK.aktion.notizBehalten : TK.aktion.geloeschtLassen, gelA ? "notiz" : "papierkorb", e === "meine"], ["andere", 2, gelA ? TK.aktion.loeschenUebernehmen : TK.aktion.notizBehalten, gelA ? "papierkorb" : "notiz", e === "andere"]);
    } else {
      const um = it.typ === "umbenannt";
      a.push(["meine", 1, um ? TK.umbenannt.meine : TK.aktion.meine, symFuer(DIESER_MAC), e === "meine" && !it.viaKI], ["andere", 2, um ? TK.umbenannt.andere : TK.aktion.andere, symFuer(it.andere.geraet || G), e === "andere" && !it.viaKI]);
      if (istText(it) && !it.nurWahl) a.push(["beide", 3, um ? TK.umbenannt.beide : TK.aktion.beide, "kopieren", e === "beide"], ["zusammen", 4, TK.aktion.zusammen, "stift", it.modus === "merge" || (e === "zusammen" && !it.viaKI)]);
    }
    return a;
  };
  function folgeText(it, a) {
    const k = a ?? it.entscheidung;
    if (!k) return null;
    if (it.typ === "geloescht") {
      const gelA = it.wer === "andere", behalten = gelA === (k === "meine");
      return behalten ? TK.folge.notizBleibt : gelA ? TK.folge.loeschenHier : TK.folge.loeschenAnderswo(gName);
    }
    if (it.typ === "board") return k === "meine" ? TK.folge.karteMeine(spaltenName(it.karte.meine.spalte), fmtFaellig(it.karte.meine.faellig), vonDatei(it)) : TK.folge.karteAndere(spaltenName(it.karte.andere.spalte), fmtFaellig(it.karte.andere.faellig));
    if (it.typ === "umbenannt" && k !== "zusammen") return { meine: TK.umbenannt.folgeMeine(nameVon(it.pfad)), andere: TK.umbenannt.folgeAndere(nameVon(it.pfadAndere)), beide: TK.umbenannt.folgeBeide(nameVon(it.pfad), nameVon(it.pfadAndere)) }[k];
    return { meine: TK.folge.meine(vonDatei(it)), andere: TK.folge.andere(vonDatei(it)), beide: TK.folge.beide(vonDatei(it), it.titel, it.andere.geraet || G || gKurz), zusammen: TK.folge.zusammen }[k];
  }
  function ergebnisKurz(it) {
    const e = it.entscheidung;
    if (it.typ === "geloescht") return (it.wer === "andere") === (e === "meine") ? TK.kurz.notizBleibt : TK.kurz.loeschung;
    if (it.typ === "board") return e === "meine" ? TK.kurz.karteBleibt(spaltenName(it.karte.meine.spalte)) : TK.kurz.karteKommt(spaltenName(it.karte.andere.spalte));
    if (it.typ === "umbenannt" && e !== "zusammen") return { meine: TK.umbenannt.kurzMeine, andere: TK.umbenannt.kurzAndere(it.andere.geraet || G || ANDERES_GERAET), beide: TK.umbenannt.kurzBeide }[e];
    return { meine: TK.kurz.meine, andere: TK.kurz.andere(it.andere.geraet || G || ANDERES_GERAET), beide: TK.kurz.beide, zusammen: it.viaKI ? TK.kurz.textKi : TK.kurz.text }[e];
  }
  function waehle(it, a) {
    it.entscheidung = it.entscheidung === a && !it.viaKI ? null : a; it.viaKI = false; it.modus = "vergleich";
    if (it.kiStand === "denkt") kiAbbrechen(it);
    zeichne(); weiter();
  }
  function weiter() {
    const it = akt(); clearTimeout(KS.weiter);
    if (!it || !it.entscheidung) return;
    KS.weiter = setTimeout(() => {
      if (KS.zerstoert || akt() !== it || KS.phase !== "liste") return;
      const n = items.length;
      for (let d = 1; d < n; d++) { const j = (KS.sel + d) % n; if (!items[j].entscheidung) { KS.sel = j; zeichne(); return; } }
      const b = wurzel.querySelector("#k-fertig");
      if (b && !b.disabled) { b.classList.remove("bereit"); void b.offsetWidth; b.classList.add("bereit"); }
    }, wenigBewegung() ? 150 : 520);
  }
  function aktion(it, a) {
    if (nurAnsehen) return;
    if (a === "zusammen") {
      if (!istText(it) || it.nurWahl) return;
      if (it.viaKI && it.text != null) { it.freiText = it.text; it.modus = it.modus === "frei" ? "vergleich" : "frei"; } // der Text der KI: ansehen und ändern
      else it.modus = it.modus === "merge" ? "vergleich" : "merge";
      zeichneDetail(); return;
    }
    if ((a === "beide") && (!istText(it) || it.nurWahl)) return;
    waehle(it, a);
  }

  // ---------- Zeichnen ----------
  const notizAnzahl = () => items.filter((i) => i.typ !== "board").length;
  const label = () => konfliktLabel(notizAnzahl(), items.length - notizAnzahl());
  function liste() {
    const beschr = items.every((i) => i.typ === "geloescht") ? TK.liste.geloescht : items.some((i) => i.typ === "board" || i.typ === "geloescht") ? TK.liste.gemischt : TK.liste.standard;
    return [h("div", { klasse: "k-liste-kopf" }, h("h2", null, TK.liste.titel, h("span", { klasse: "n", text: String(items.length) })), h("p", { text: beschr }),
      nurAnsehen ? h("p", { klasse: "k-fremd", "data-fremd": "", role: "status", text: TK.fremd.text }) : null),
      h("div", { klasse: "k-liste-scroll", role: "listbox", "aria-label": TK.liste.beschriftung }, ...items.map((it, i) => {
        const u = it.typ === "umbenannt" ? TK.umbenannt.listeU(nameVon(it.pfad), nameVon(it.pfadAndere)) : it.typ === "geloescht" ? (it.wer === "andere" ? TK.liste.geloeschtAndere(gName) : TK.liste.geloeschtMac(gName)) : it.typ === "board" ? TK.liste.karte
          : TK.liste.unterschiede(DIESER_MAC, it.andere.geraet || G || gKurz, it.segs ? bloecke(it).length : 1);
        return h("button", { klasse: "k-item", type: "button", role: "option", "data-i": String(i), "data-pfad": it.pfad, "aria-current": String(i === KS.sel), "aria-selected": String(i === KS.sel),
          aufClick: () => { KS.sel = i; clearTimeout(KS.weiter); zeichne(); } },
        h("span", { klasse: "t" }, zeichen(it.typ === "board" ? "aufgaben" : "notiz", 16), h("span", { text: it.titel })),
        h("span", { klasse: "u", text: u }),
        h("span", { klasse: "st" }, it.entscheidung ? h("span", { klasse: "k-badge ok" }, zeichen("haken", 12), ergebnisKurz(it)) : h("span", { klasse: "k-badge warn", text: TK.liste.offen })));
      }))];
  }
  function fuss() {
    const n = items.length, done = items.filter((i) => i.entscheidung).length, rest = n - done;
    return [h("div", { klasse: "k-prog" }, h("div", { klasse: "bars", "aria-hidden": "true" }, ...items.map((i) => h("i", { klasse: i.entscheidung ? "ok" : "" }))), h("span", { "data-fortschritt": "" }, rest ? h("b", { text: `${done} von ${n}` }) : null, rest ? ` gelöst · noch ${rest} offen` : h("b", { text: "Alles gelöst" }))),
      baueKnopf({ text: TK.fuss.spaeter, groesse: "s", titel: TK.fuss.spaeterTitel, nach: [kbd("esc")], aktion: "konflikt-spaeter", aufKlick: () => schliessen() }),
      baueKnopf({ text: TK.fuss.abgleichen, variante: "primaer", nach: [h("span", { klasse: "chip-key", text: "⌘↩" })], disabled: rest > 0 || nurAnsehen, titel: nurAnsehen ? TK.fremd.knopfTitel : undefined, aktion: "konflikt-abgleichen", daten: { id: "k-fertig" }, aufKlick: () => abgleichen() })];
  }
  function kopf(it) {
    const kw = it.typ === "umbenannt" ? TK.umbenannt.marke : it.typ === "geloescht" ? (it.wer === "andere" ? TK.kopf.geloeschtAndere(nameDatei(it)) : TK.kopf.geloeschtMac) : it.typ === "board" ? TK.kopf.karte : TK.kopf.geaendert;
    const erkl = it.typ === "umbenannt" ? TK.umbenannt.erkl(nameVon(it.pfad), nameVon(it.pfadAndere), aufDatei(it)) : it.typ === "geloescht" ? (it.wer === "andere" ? TK.kopf.erklGeloeschtAndere(nameDatei(it)) : TK.kopf.erklGeloeschtMac(nameDatei(it))) : it.typ === "board" ? TK.kopf.erklKarte(nameDatei(it)) : TK.kopf.erklText(uhrzeit(daten.seit), aufDatei(it));
    const ordner = it.pfad.includes("/") ? it.pfad.slice(0, it.pfad.lastIndexOf("/")).replaceAll("/", " / ") : "";
    return h("div", { klasse: "k-kopf" }, h("div", null,
      h("div", { klasse: "k-pfad" }, zeichen("ordner", 12), h("span", { text: ordner || "Vault" })),
      h("h1", null, h("span", { text: it.titel }), h("span", { klasse: "k-badge warn", text: kw })), h("p", { klasse: "k-erkl", text: erkl })),
    KS.ki.verfuegbar && it.modus !== "stand" ? baueKnopf({ text: TK.aktion.ki, groesse: "s", symbol: "funke", titel: TK.aktion.kiTitel, nach: [kbd("K")], klasse: "k-a ki", daten: { "data-a": "ki", "aria-pressed": String(it.kiStand !== "aus" || it.viaKI) }, aufKlick: () => kiFragen(it) }) : null);
  }
  function zeichneDetail() {
    const d = wurzel.querySelector("#k-detail"); if (!d) return;
    const it = akt(), alt = wurzel.querySelector("#k-body"), y = alt ? alt.scrollTop : 0, gleich = alt && alt.dataset.id === it.id + it.modus;
    const folge = h("div", { klasse: "k-folge" + (it.entscheidung ? " fest" : ""), id: "k-folge", "aria-live": "polite" });
    const setzeFolge = (t, sym) => { folge.replaceChildren(...(t ? [zeichen(sym || (it.entscheidung ? "kreis-haken" : "info"), 14), h("span", { text: t })] : [h("span", { text: TK.aktion.waehle(it.typ === "board") })])); };
    setzeFolge(it.entscheidung ? (it.viaKI ? `${TK.folge.kiGeloest} ${it.entscheidung === "zusammen" ? TK.folge.ergebnisSehen : folgeText(it)}` : folgeText(it)) : null);
    const akts = h("div", { klasse: "k-akt", id: "k-akt" }, ...aktionenFuer(it).map(([a, key, text, sym, an]) => {
      const b = baueKnopf({ text, groesse: "s", symbol: sym, nach: [kbd(String(key))], klasse: "k-a", daten: { "data-a": a, "aria-pressed": String(!!an) }, aufKlick: () => aktion(it, a) });
      b.addEventListener("mouseenter", () => setzeFolge(folgeText(it, a), "info"));
      b.addEventListener("mouseleave", () => setzeFolge(it.entscheidung ? (it.viaKI ? `${TK.folge.kiGeloest} ${it.entscheidung === "zusammen" ? TK.folge.ergebnisSehen : folgeText(it)}` : folgeText(it)) : null));
      return b;
    }));
    const body = h("div", { klasse: "k-body", id: "k-body", "data-id": it.id + it.modus }, kiKarte(it), ...(it.modus === "merge" ? mergeAnsicht(it) : it.modus === "frei" ? freiAnsicht(it) : vergleich(it)));
    d.replaceChildren(kopf(it), akts, folge, body);
    if (gleich) body.scrollTop = y;
  }
  function zeichne() {
    if (KS.zerstoert) return;
    wurzel.dataset.phase = KS.phase;
    if (KS.phase === "sync") { wurzel.replaceChildren(syncAnsicht()); }
    else if (KS.phase === "fertig") { wurzel.replaceChildren(fertigAnsicht()); }
    else {
      const y = wurzel.querySelector(".k-liste-scroll")?.scrollTop || 0;
      wurzel.replaceChildren(h("aside", { klasse: "k-liste" }, ...liste()), h("section", { klasse: "k-detail", id: "k-detail" }), h("footer", { klasse: "k-fuss" }, ...fuss()));
      zeichneDetail();
      const s = wurzel.querySelector(".k-liste-scroll"); if (s) s.scrollTop = y;
    }
    ctx.beiZustand?.({ phase: KS.phase, label: KS.phase === "fertig" ? TK.fertig.titel : label(), offen: items.filter((i) => !i.entscheidung).length });
  }

  // ---------- Abgleichen, Erfolg, Rückgängig ----------
  const schritte = () => [TK.sync.s1, TK.sync.s2(G), TK.sync.s3];
  function syncAnsicht() {
    return h("div", { klasse: "k-mitte", "data-konflikt-sync": "" }, h("div", { klasse: "k-kreis" }, h("span", { klasse: "sp" })), h("h2", { text: TK.sync.titel }), h("p", { text: TK.sync.text }),
      h("ul", { klasse: "k-schritte", id: "k-schritte" }, ...schritte().map((t, i) => h("li", { "data-s": String(i + 1), klasse: i === 0 ? "laeuft" : "" }, h("span", { klasse: "st" }), t))));
  }
  const schrittSetzen = (n, zustand) => { const li = wurzel.querySelector(`#k-schritte [data-s="${n}"]`); if (!li) return; li.className = zustand; const st = li.querySelector(".st"); st.replaceChildren(...(zustand === "ok" ? [zeichen("haken", 12)] : [])); };
  function zusammenfassung(it) {
    const e = it.entscheidung;
    if (it.typ === "umbenannt" && e !== "zusammen") return { meine: TK.umbenannt.zusMeine(nameVon(it.pfad)), andere: TK.umbenannt.zusAndere(nameVon(it.pfadAndere)), beide: TK.umbenannt.zusBeide(nameVon(it.pfad), nameVon(it.pfadAndere)) }[e];
    if (it.typ === "geloescht") return (it.wer === "andere") === (e === "meine") ? TK.fertig.zus.notizBleibt : TK.fertig.zus.geloescht;
    if (it.typ === "board") { const s = e === "meine" ? it.karte.meine : it.karte.andere; return TK.fertig.zus.karte(spaltenName(s.spalte), fmtFaellig(s.faellig)); }
    return { meine: TK.fertig.zus.meine, andere: TK.fertig.zus.andere(vonDatei(it)), beide: TK.fertig.zus.beide(vonDatei(it), it.titel, it.andere.geraet || G || gKurz), zusammen: TK.fertig.zus.text(it.segs ? bloecke(it).length : 1, it.viaKI) }[e];
  }
  function fertigAnsicht() {
    const r = KS.ergebnis || {}, online = r.abgleich && r.abgleich.ok;
    const orte = [[symFuer(DIESER_MAC), TK.fertig.orte.mac], [symFuer(G), G || TK.fertig.orte.geraet], ["wolke", TK.fertig.orte.server]];
    return h("div", { klasse: "k-mitte", "data-konflikt-fertig": "" }, h("div", { klasse: "k-kreis ok" }, zeichen("haken", 24)), h("h2", { text: TK.fertig.titel }),
      h("p", { text: online || !r.abgleich ? TK.fertig.text : TK.fertig.nurLokal(r.abgleich.text || "") }),
      h("div", { klasse: "k-orte" }, ...orte.map(([s, t], i) => h("span", null, zeichen(s, 14), t, i < 2 || online || !r.abgleich ? h("span", { klasse: "h" }, zeichen("haken", 12)) : null))),
      h("ul", { klasse: "k-zus" }, ...items.map((it) => h("li", null, zeichen("kreis-haken", 16), h("div", null, h("b", { text: it.titel }), h("span", { text: zusammenfassung(it) }))))),
      h("div", { klasse: "knoepfe" }, baueKnopf({ text: TK.fertig.zurueck, variante: "primaer", nach: [kbd("esc")], aktion: "konflikt-zurueck", aufKlick: () => schliessen() }),
        baueKnopf({ text: TK.fertig.rueckgaengig, aktion: "konflikt-rueckgaengig", aufKlick: () => rueckgaengig() })),
      r.sicherung && r.sicherung.ordner ? h("p", { klasse: "klein", "data-sicherung": "", text: TK.fertig.gesichert(r.sicherung.ordner) }) : null,
      h("p", { klasse: "klein", text: TK.fertig.klein }));
  }
  async function abgleichen() {
    if (!alleGeloest() || KS.phase !== "liste" || KS.laeuft) return;
    clearTimeout(KS.weiter); KS.laeuft = true; KS.phase = "sync"; zeichne();
    const auswahl = items.map((it) => ({ pfad: it.pfad, wahl: it.entscheidung === "zusammen" ? "text" : it.entscheidung, ...(it.entscheidung === "zusammen" ? { text: it.text ?? "" } : {}) }));
    let r;
    try { r = await api.gitKonfliktLoesen(auswahl, { meine: daten.meine, andere: daten.andere }); }
    catch (err) {
      KS.laeuft = false; KS.phase = "liste"; zeichne();
      if (gitGesperrt(err)) toast(TK.fehler.gesperrt, { fehler: true });
      else if (ausgangUnklar(err)) { try { await ctx.beiStandNeu?.(err); } catch (x) { console.error(x); } toast(TK.fehler.loesen, { fehler: true }); }
      else if (err?.status === 409 && err?.daten?.art === "laeuft") toast(TK.fehler.laeuft, { fehler: true });
      else if (err?.status === 409 && err?.daten?.art === "veraltet") { toast(TK.fehler.veraltet, { fehler: true, ms: 8000 }); ctx.beiVeraltet?.(); }
      else toast(err?.message || TK.fehler.loesen, { fehler: true, ms: 9000 });
      return;
    }
    KS.ergebnis = r;
    schrittSetzen(1, "ok"); schrittSetzen(2, "laeuft"); await warte(wenigBewegung() ? 60 : 320);
    schrittSetzen(2, "ok"); schrittSetzen(3, "laeuft"); await warte(wenigBewegung() ? 60 : 320);
    if (r.abgleich && r.abgleich.ok === false) schrittSetzen(3, ""); else schrittSetzen(3, "ok");
    await warte(wenigBewegung() ? 60 : 280);
    KS.laeuft = false; KS.phase = "fertig"; zeichne();
    wurzel.querySelector('[data-aktion="konflikt-zurueck"]')?.focus();
    try { await ctx.beiFertig?.({ ergebnis: r, anzahl: items.length, rueckgaengig: () => rueckgaengig() }); } catch (x) { console.error(x); }
  }
  async function rueckgaengig() {
    if (KS.phase !== "fertig" || KS.laeuft) return;
    KS.laeuft = true;
    try {
      const r = await api.gitKonfliktRueckgaengig();
      KS.laeuft = false;
      KS.phase = "liste"; KS.sel = 0;
      toast(TK.rueck.ok, { ms: 6000 });
      await ctx.beiZurueck?.(r);
      zeichne();
    } catch (err) {
      KS.laeuft = false;
      toast(err?.status === 409 ? (err.message || TK.rueck.nichtMehr) : TK.rueck.fehler, { fehler: true, ms: 9000 });
    }
  }
  function schliessen() { if (KS.laeuft) return; clearTimeout(KS.weiter); ctx.beiSchliessen?.({ phase: KS.phase }); }

  // ---------- Tastatur (nur solange die Ansicht offen ist) ----------
  function taste(e) {
    if (KS.zerstoert || e.defaultPrevented) return;
    const mod = e.metaKey || e.ctrlKey, feld = e.target.closest?.("input, textarea, [contenteditable='true']"), it = akt();
    if (document.querySelector("#dialog-host .schleier, .bs-pop.offen, .menue")) return;
    if (e.key === "Escape") {
      if (feld) feld.blur();
      if (KS.phase === "sync") { e.preventDefault(); return; }
      if (KS.phase === "liste" && it && (it.modus === "merge" || it.modus === "frei")) it.modus = "vergleich", zeichneDetail();
      else if (KS.phase === "liste" && it && it.kiStand !== "aus") kiAbbrechen(it);
      else schliessen();
      e.preventDefault(); return;
    }
    if (KS.phase === "sync") return;
    if (mod && e.key === "Enter") {
      e.preventDefault();
      if (KS.phase !== "liste") return;
      if (it && it.modus === "merge" && bloecke(it).every((b) => b.wahl)) return mergeUebernehmen(it);
      if (alleGeloest()) abgleichen(); else toast(TK.fuss.nochOffen(items.filter((i) => !i.entscheidung).length));
      return;
    }
    if (KS.phase !== "liste" || mod || e.altKey || feld) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); clearTimeout(KS.weiter);
      KS.sel = Math.max(0, Math.min(items.length - 1, KS.sel + (e.key === "ArrowDown" ? 1 : -1))); zeichne();
      wurzel.querySelector(`.k-item[data-i="${KS.sel}"]`)?.scrollIntoView?.({ block: "nearest" });
      return;
    }
    const m = { 1: "meine", 2: "andere", 3: "beide", 4: "zusammen" }[e.key];
    if (m && it) { e.preventDefault(); aktion(it, m); return; }
    if (e.key.toLowerCase() === "k" && it && KS.ki.verfuegbar) { e.preventDefault(); kiFragen(it); }
  }
  document.addEventListener("keydown", taste);

  // ---------- Start ----------
  (async () => {
    try {
      const b = await api.frageBereit();
      const erlaubt = (b?.konten || []).filter((k) => k.erlaubt);
      if (b?.vertraut && b?.claude && !b?.kontenDefekt && erlaubt.length && daten.modus !== "stand") {
        KS.ki = { verfuegbar: true, konto: erlaubt[0].id, name: erlaubt[0].programm === "codex" ? "Codex" : "Claude Code", stufe: erlaubt[0].stufe || "lesen" };
        if (!KS.zerstoert) zeichneDetail();
      }
    } catch { /* ohne KI-Konto bleibt der Knopf aus */ }
  })();
  zeichne();
  if (daten.start?.sel != null) KS.sel = Math.max(0, Math.min(items.length - 1, daten.start.sel));
  return {
    el: wurzel, items, label,
    zerstoere() { KS.zerstoert = true; clearTimeout(KS.weiter); document.removeEventListener("keydown", taste); for (const i of items) if (i.kiLauf) kiAbbrechen(i); wurzel.remove(); },
    istFertig: () => KS.phase === "fertig", laeuft: () => KS.laeuft,
    // vom Aufrufer (nach „Rückgängig“ oder Neuladen): neue Fassungen einlesen, Entscheidungen bleiben
    // Entscheidungen merken samt der Kennung beider Fassungen: nur wo sie noch dieselben sind, gelten sie wieder (sonst wurde die Notiz seitdem geändert)
    entscheidungen: () => Object.fromEntries(items.filter((i) => i.entscheidung).map((i) => [i.pfad, { wahl: i.entscheidung, text: i.text, viaKI: i.viaKI, blobM: i.meine.blob ?? null, blobA: i.andere.blob ?? null }])),
    setzeEntscheidungen(map) { for (const i of items) { const e = map?.[i.pfad]; if (e && e.blobM === (i.meine.blob ?? null) && e.blobA === (i.andere.blob ?? null)) { i.entscheidung = e.wahl; i.text = e.text ?? null; i.viaKI = !!e.viaKI; } } zeichne(); },
    zeichne,
  };
}
