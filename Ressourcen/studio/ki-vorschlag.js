// Bausteine für KI-Vorschläge, die jede Funktion wiederverwendet (K1 Zusammenfassen, K2 Text-Aktionen, K3 Posteingang). Docs: docs/plaene/ki-runde.md.
//   · kiStatus(bereit)            → was die Knöpfe tun: sichtbar? gesperrt (mit Grund)? welches Konto? Einwilligung da?
//   · oeffneEinwilligung({…})     → der Dialog „KI-Vorschläge für … einschalten?“ (Opt-in je Vault; schreibt nur die Werkstatt, fail-closed)
//   · wasWirdGesendet({…})        → ausklappbarer Block „Was wird gesendet?“: vorab die Liste, nach dem Start das Datenpaket genau so, wie es an die KI geht
//   · kontingentZeile({…})        → eine ruhige Zeile mit Mini-Balken und Satz zum Kontingent (80 % gelb, 100 % mit Rücksetzzeit)
//   · starteVorschlag({…})        → Start + Long-Poll + Abbrechen; liefert { fertig: Promise, abbrechen }
// Alle KI-Texte werden als Text gesetzt (textContent), nie als HTML. Kein natives Feld, nur Design-Tokens (hell/dunkel über studio.css).
import { h, dialog, toast } from "./hilfen.js";
import { knopf as baueKnopf } from "./bausteine.js";
import { symbol } from "./symbole.js";
import { kontingentStand, kontingentKompakt, kontoAnsicht, miniBalken } from "./kontingent.js";
import { TKO } from "./texte-kontingent.js";
import { TV } from "./texte-ki-vorschlag.js";

// ---------- Status aus GET /api/ki/vorschlag/bereit ----------
// → { sichtbar, gesperrt: null | "nicht-vertraut" | "kein-claude" | "konten-defekt", konto: {id,name,abo}|null, einwilligung: bool }
// Ohne Claude-Konto mit Stufe „lesen“ oder höher in diesem Vault: nicht sichtbar (kein Knopf, kein Hinweis auf gesperrte Konten).
export function kiStatus(bereit) {
  if (!bereit || typeof bereit !== "object") return { sichtbar: false, gesperrt: null, konto: null, einwilligung: false };
  const erlaubte = (bereit.konten || []).filter((k) => k && k.erlaubt);
  const ein = bereit.einwilligung && bereit.einwilligung.an ? bereit.einwilligung : null;
  const konto = (ein && erlaubte.find((k) => k.id === ein.konto)) || erlaubte.find((k) => k.id === bereit.aktiv) || erlaubte[0] || null;
  const gesperrt = bereit.kontenDefekt ? "konten-defekt" : !bereit.vertraut ? "nicht-vertraut" : !bereit.claude ? "kein-claude" : null;
  return { sichtbar: !!konto, gesperrt, konto, einwilligung: !!(ein && konto && ein.konto === konto.id) };
}

// ---------- Kontingent-Zeile ----------
// Ruhig und immer gleich hoch (eine Zeile): Mini-Balken + Satz. ab 80 % ein Satz in Gelb, bei 100 % mit Rücksetzzeit. `voll` sagt, ob der Knopf aus sein soll.
export function kontingentZeile({ api, konto, abo = null, beiAenderung = null, name = "kontingent" } = {}) { // name: Wert von data-kiv (mehrere Zeilen auf einer Seite lassen sich so getrennt ansprechen)
  const kt = kontingentStand(api);
  const el = h("div", { klasse: "kiv-kt", "data-kiv": name });
  const ergebnis = { knoten: el, voll: false, stufe: "grau", zeichne };
  function zeichne() {
    if (!konto) { el.replaceChildren(); return; }
    const jetzt = kt.jetzt(), e = kt.eintrag(konto), k = kontoAnsicht(e, jetzt);
    const proz = Math.max(k.session?.prozent || 0, k.weekly?.prozent || 0);
    ergebnis.voll = !!k.voll;
    ergebnis.stufe = k.voll ? "voll" : k.hatWerte && proz >= 80 ? "fast" : "grau";
    const satz = k.voll ? TV.kontingent.voll(TKO.wiederAb(k.wiederAb, jetzt)) : ergebnis.stufe === "fast" ? TV.kontingent.fastVoll : abo === "api" ? TV.kontingent.zaehltApi : TV.kontingent.zaehlt;
    el.dataset.stufe = ergebnis.stufe;
    el.replaceChildren(...[
      k.hatWerte ? miniBalken(e, jetzt) : null,
      h("span", { klasse: "kiv-kt-text", "data-kiv": `${name}-text`, text: !kt.state.daten || k.hatWerte ? satz : TV.kontingent.ohneWert })].filter(Boolean)); // ohne Wert: nur der ehrliche Satz, kein Sperren; kein null als Text
    beiAenderung?.(ergebnis);
  }
  const ab = kt.abonniere(() => zeichne());
  ergebnis.stopp = () => ab(); // wer die Zeile ersetzt oder wegwirft, meldet sie ab (nie beim bloßen Abhängen: eine zugeklappte Karte hält sie trotzdem aktuell)
  zeichne();
  kt.holen().catch(() => {});
  return ergebnis;
}

// ---------- „Was wird gesendet?“ ----------
// gesendet: der Text, der auf stdin der KI ging (JSON); ohne ihn: die Liste vorab (funktionen = Schlüssel aus TV.gesendet). Anzeige gekürzt, „Kopieren“ übernimmt alles.
const MAX_ANZEIGE = 4000;
export function wasWirdGesendet({ gesendet = null, funktionen = [], ausgenommen = 0, offen = false, beiUmschalten = null } = {}) {
  let schoen = null;
  if (typeof gesendet === "string") { try { schoen = JSON.stringify(JSON.parse(gesendet), null, 2); } catch { schoen = gesendet; } }
  const wurzel = h("div", { klasse: "kiv-gesendet", "data-kiv": "gesendet" });
  let auf = offen;
  const koerper = h("div", { klasse: "kiv-gesendet-koerper", id: `kiv-g-${Math.random().toString(36).slice(2, 8)}`, hidden: !auf });
  const umschalter = h("button", { type: "button", klasse: "kiv-gesendet-knopf", "data-aktion": "kiv-gesendet", "aria-expanded": String(auf), "aria-controls": koerper.id, aufClick: () => {
    auf = !auf; umschalter.setAttribute("aria-expanded", String(auf)); koerper.hidden = !auf; beiUmschalten?.(auf);
  } }, h("span", { text: TV.gesendetBlock.knopf }), h("span", { klasse: "kiv-pfeil", "aria-hidden": "true" }, symbol("chevron-unten", 12)));
  if (schoen !== null) {
    const kurz = schoen.length > MAX_ANZEIGE ? schoen.slice(0, MAX_ANZEIGE) : schoen;
    koerper.append(
      h("p", { klasse: "kiv-leise", text: TV.gesendetBlock.jetzt }),
      h("pre", { klasse: "kiv-paket", "data-kiv": "paket", tabindex: "0", text: kurz }),
      schoen.length > MAX_ANZEIGE ? h("p", { klasse: "kiv-leise", text: TV.gesendetBlock.gekuerzt(schoen.length) }) : null,
      ausgenommen > 0 ? h("p", { klasse: "kiv-leise", "data-kiv": "ausgenommen", text: TV.gesendetBlock.ausgenommen(ausgenommen) }) : null,
      baueKnopf({ text: TV.gesendetBlock.kopieren, groesse: "s", symbol: "kopieren", aktion: "kiv-kopieren", aufKlick: async () => {
        try { await navigator.clipboard.writeText(schoen); toast(TV.gesendetBlock.kopiert, { ms: 1800 }); } catch { toast(TV.gesendetBlock.kopierFehler, { fehler: true }); }
      } }));
  } else {
    koerper.append(h("p", { klasse: "kiv-leise", text: TV.gesendetBlock.vorab }), h("ul", { klasse: "kiv-liste" }, funktionen.filter((f) => TV.gesendet[f]).map((f) => h("li", {}, h("b", { text: TV.gesendet[f].titel }), " – ", TV.gesendet[f].text))));
  }
  wurzel.append(umschalter, koerper);
  return wurzel;
}

// ---------- Einwilligung ----------
// bereit: Antwort von GET /api/ki/vorschlag/bereit · vault: Ordnerpfad des offenen Vaults (so, wie das Studio ihn kennt; die Werkstatt vergleicht und lehnt einen anderen ab) · vaultName: Anzeigename
// funktionen: welche Funktionen der Dialog beschreibt · nachher(einwilligung): nach dem Einschalten (z. B. gleich den Lauf starten) · beiAbbruch(): Abbrechen/Esc
export function oeffneEinwilligung({ api, bereit, vault, vaultName, funktionen = ["zusammenfassung"], nachher, beiAbbruch, dialogFn = dialog } = {}) {
  const st = kiStatus(bereit);
  const konto = st.konto;
  const E = TV.einwilligung;
  let erledigt = false;
  const stopps = [];
  const beiSchliessenKt = (kz) => { stopps.push(kz.stopp); };
  const zeile = (sym, titel, text) => h("div", { klasse: "kiv-punkt" }, h("span", { klasse: "kiv-punkt-sym", "aria-hidden": "true" }, symbol(sym, 14)), h("div", {}, h("b", { text: titel }), h("p", { text })));
  const rumpf = [
    h("div", { klasse: "kiv-karte", "data-kiv": "gesendet-liste" }, funktionen.filter((f) => TV.gesendet[f]).map((f) => zeile(TV.gesendet[f].symbol, TV.gesendet[f].titel, TV.gesendet[f].text))),
    h("div", { klasse: "kiv-karte" }, zeile("haken", E.nieTitel, E.nie), zeile("haken", E.gespeichertTitel, E.gespeichert)),
  ];
  let kontoKnoten = null;
  if (konto) {
    const kz = kontingentZeile({ api, konto: konto.id, abo: konto.abo || null });
    const zuKt = beiSchliessenKt(kz);
    kontoKnoten = h("div", { klasse: "kiv-konto", "data-kiv": "konto" }, h("div", { klasse: "kiv-konto-kopf" }, h("b", { text: konto.name }), h("span", { klasse: "kiv-leise", text: E.konto(E.stufeLesen) })), kz.knoten);
    rumpf.push(kontoKnoten);
  }
  rumpf.push(h("p", { klasse: "kiv-leise", text: konto && konto.abo === "api" ? E.kontingentApi : E.kontingent }));
  const ja = baueKnopf({ text: E.einschalten, variante: "primaer", aktion: "kiv-einschalten", disabled: !konto, aufKlick: async () => {
    if (!konto) return;
    try {
      const r = await api.kiVorschlagEinwilligung({ an: true, konto: konto.id, vault });
      erledigt = true; d.schliessen();
      await nachher?.(r);
    } catch (err) {
      toast(err?.daten?.art === "anderer-vault" ? E.anderesFenster : (err?.message || E.fehler), { fehler: true, ms: 8000 });
    }
  } });
  const d = dialogFn({ titel: E.titel(vaultName || ""), satz: konto ? E.satz(konto.name) : "", rumpf: h("div", { klasse: "kiv-rumpf" }, rumpf), breit: true,
    knoepfe: [baueKnopf({ text: E.abbrechen, aktion: "kiv-abbrechen", aufKlick: () => d.schliessen() }), ja], beiSchliessen: () => { stopps.forEach((f) => f()); if (!erledigt) beiAbbruch?.(); } });
  d.box.dataset.dialog = "ki-einwilligung";
  return d;
}

// ---------- Lauf ----------
// eingabe: Rumpf von POST /api/ki/vorschlag/start (funktion, konto, … – die Werkstatt prüft alles selbst). beiStart(start): sobald die Werkstatt die Daten gesammelt hat (start.gesendet = das Paket).
// → { fertig: Promise<{ start, ergebnis }>, abbrechen() }. `fertig` wirft nur, wenn der Start selbst abgelehnt wird (err.message ist ein deutscher Satz der Werkstatt); ein Fehler des Laufs steht in ergebnis (ok:false).
export function starteVorschlag({ api, eingabe, beiStart, wiederholeBeiLaeuft = false } = {}) {
  let id = null, abgebrochen = false, ende = false;
  const abbrechen = async () => {
    abgebrochen = true;
    if (id && !ende) { try { await api.kiVorschlagAbbrechen(id); } catch { /* die Werkstatt beendet den Lauf sonst nach der Frist */ } }
  };
  const fertig = (async () => {
    // Ein eben abgebrochener Lauf braucht ein paar Sekunden zum Beenden: „läuft noch“ wird kurz wiederholt, statt als Fehler zu erscheinen
    let start;
    for (let versuch = 0; ; versuch++) {
      try { start = await api.kiVorschlagStart(eingabe); break; }
      catch (e) { if (!(wiederholeBeiLaeuft && e?.daten?.art === "laeuft" && versuch < 8 && !abgebrochen)) throw e; await new Promise((ok) => setTimeout(ok, 800)); }
    }
    id = start.id;
    try { beiStart?.(start); } catch (e) { console.error(e); }
    if (abgebrochen) await abbrechen();
    let fehlversuche = 0;
    for (;;) {
      let st;
      try { st = await api.kiVorschlagStand(id); fehlversuche = 0; }
      catch (e) {
        if (e?.status === 404) { ende = true; return { start, ergebnis: { ok: false, abgebrochen: true, fehler: TV.lauf.abgebrochen } }; } // Vault gewechselt oder Anfrage verworfen
        if (++fehlversuche >= 4) { ende = true; return { start, ergebnis: { ok: false, fehler: TV.lauf.verbindung } }; }
        await new Promise((ok) => setTimeout(ok, 400 * fehlversuche));
        continue;
      }
      if (st.fertig) { ende = true; return { start, ergebnis: st.ergebnis || { ok: false, fehler: TV.lauf.fehlerAllgemein } }; }
    }
  })();
  return { fertig, abbrechen };
}

// ---------- Stapel („Für alle“, K3) ----------
// Die Werkstatt arbeitet die Einträge nacheinander ab (höchstens 10, eine Anfrage zur Zeit) und führt den Stand; hier wird nur gefragt. eingabe: { funktion, pfade, konto }.
// beiStand(stand): bei jeder Änderung (stand.eintraege = Ergebnisse je Pfad, stand.erledigt/von/aktuell) · → { fertig: Promise<stand>, abbrechen }. `fertig` wirft nur, wenn der Start abgelehnt wird.
export function starteStapel({ api, eingabe, beiStand } = {}) {
  let id = null, abgebrochen = false;
  const abbrechen = async () => { abgebrochen = true; if (id) { try { await api.kiVorschlagAbbrechen(id); } catch { /* die Werkstatt beendet den Stapel sonst nach dem laufenden Eintrag */ } } };
  const fertig = (async () => {
    const start = await api.kiVorschlagStart(eingabe);
    id = start.id;
    if (abgebrochen) await abbrechen();
    let version = -1, fehlversuche = 0;
    for (;;) {
      let st;
      try { st = await api.kiVorschlagStand(id, version); fehlversuche = 0; }
      catch (e) {
        if (e?.status === 404) return { stapel: true, fertig: true, abgebrochen: true, verloren: true, von: start.von, erledigt: 0, eintraege: {}, ausgenommen: 0 }; // Vault gewechselt: alles verworfen
        if (++fehlversuche >= 4) return { stapel: true, fertig: true, abgebrochen: true, verloren: true, gestoppt: TV.lauf.verbindung, von: start.von, erledigt: 0, eintraege: {}, ausgenommen: 0 };
        await new Promise((ok) => setTimeout(ok, 400 * fehlversuche));
        continue;
      }
      version = st.version;
      try { beiStand?.(st); } catch (e) { console.error(e); }
      if (st.fertig) return st;
    }
  })();
  return { fertig, abbrechen };
}
