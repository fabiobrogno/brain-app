// suchfalte.js — Wörter falten wie der Suchindex der Werkstatt (gemeinsam/suchindex.mjs falteText): klein, ä→ae ö→oe ü→ue ß→ss, Akzente weg.
// Der Editor markiert damit die Fundstellen nach dem Sprung aus der Suche. Tests/Node/suchindex.test.mjs prüft, dass beide Fassungen dasselbe tun.
const NUR_ASCII = /^[\x00-\x7f]*$/;
const SONDER = { "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss", "æ": "ae", "œ": "oe", "ø": "o", "đ": "d", "ł": "l", "ı": "i" };
const zeichen = new Map();
function ohneAscii(s) {
  return s.replace(/[^\x00-\x7f]/g, (c) => {
    let r = SONDER[c];
    if (r !== undefined) return r;
    r = zeichen.get(c);
    if (r === undefined) { r = c.normalize("NFD").replace(/[̀-ͯ]/g, ""); if (zeichen.size < 5000) zeichen.set(c, r); }
    return r;
  });
}
export function falteText(s) {
  s = String(s);
  if (/[̀-ͯ]/.test(s)) s = s.normalize("NFC");
  s = s.toLowerCase();
  return NUR_ASCII.test(s) ? s : ohneAscii(s);
}
export const WORT = /[\p{L}\p{N}]+/gu;
