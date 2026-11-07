// Vervollständigung beim Tippen von # im Editor (CodeMirror): Vorschläge aus den Tags des Vaults (ctx.tagVorschlaege, tags.js). Eigene Datei, damit editor.js nur eine Zeile braucht.
// Sie erscheint nur, wo ein Tag stehen kann (wie gemeinsam/tags.mjs): nach Zeilenanfang, Leerraum oder ( , ; — nicht in Überschriften („# Titel“), Code in Backticks, Links, im Datei-Kopf
// (dort gilt die Liste „tags:“ ohne #) und nicht in einem Code-Zaun. Am Zeilenanfang erst ab dem ersten Zeichen nach dem #, damit „#“ für eine Überschrift nie ein Menü öffnet.
const AM_ENDE = /(^|[\s(,;])#([\p{L}\p{N}_\/-]*)$/u;

export function tagQuelle(ctx) {
  return (cc) => {
    const doc = cc.state.doc;
    const zeile = doc.lineAt(cc.pos);
    const bis = cc.state.sliceDoc(zeile.from, cc.pos);
    const m = AM_ENDE.exec(bis);
    if (!m) return null;
    const getippt = m[2];
    const vorn = m.index + m[1].length; // Position des #
    if (vorn === 0 && !getippt) return null;
    if (/^ {0,3}#{1,6}[ \t]/.test(zeile.text)) return null; // Überschrift
    const davor = bis.slice(0, vorn);
    if ((davor.match(/`/g) || []).length % 2) return null; // in Code
    if (/\]\([^)]*$/.test(davor) || /\[\[[^\]]*$/.test(davor)) return null; // in Link oder Wikilink
    // Datei-Kopf: steht die Zeile zwischen den beiden ---, gilt die Liste „tags:“ (ohne #)
    if (doc.line(1).text.trim() === "---" && zeile.number > 1) {
      for (let n = 2; n <= zeile.number; n++) { const t = doc.line(n).text.trim(); if (t === "---" || t === "...") { if (n >= zeile.number) return null; break; } if (n === zeile.number) return null; }
    }
    let offen = null;
    for (let n = 1; n < zeile.number; n++) { // Zäune davor
      const f = /^ {0,3}(`{3,}|~{3,})/.exec(doc.line(n).text);
      if (!f) continue;
      if (!offen) offen = { z: f[1][0], l: f[1].length }; else if (f[1][0] === offen.z && f[1].length >= offen.l) offen = null;
    }
    if (offen) return null;
    const liste = ctx.tagVorschlaege(getippt);
    if (!liste.length) return null;
    return {
      from: zeile.from + vorn + 1,
      filter: false,
      options: liste.map((t) => ({ label: t.name, detail: String(t.anzahl), type: "keyword", apply: (view, _c, von, bis2) => {
        view.dispatch({ changes: { from: von, to: bis2, insert: t.name }, selection: { anchor: von + t.name.length }, userEvent: "input.complete" });
      } })),
    };
  };
}
