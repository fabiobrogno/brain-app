// Verlauf-Modus der Notizliste (Commits nach Tagen) und ruhige Diff-Ansicht für den Editorbereich.
// Kein innerHTML mit fremden Daten: alles über h() und textContent.
import { h, dateiName, ohneEndung, ordnerVon, leseLokal, speichereLokal } from "./hilfen.js";
import { knopf as baueKnopf } from "./bausteine.js";
import { symbol } from "./symbole.js";
import { TV } from "./texte-verlauf.js";
import { gitGesperrt } from "./api.js";

const SEITE = 60;
const MAX_SEITE = 200; // so viele Commits liefert /api/git/log höchstens je Aufruf
const MAX_DIFF_ZEILEN = 4000;
const UNGESICHERT = "__ungesichert";

// ---------------------------------------------------------------- Stylesheet (lädt sich selbst, einmalig)
const CSS_URL = new URL("./verlauf.css", import.meta.url).href;
export function ladeVerlaufCss() {
  const da = document.querySelector("link[data-verlauf-css]");
  if (da) return da._bereit || Promise.resolve();
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = CSS_URL;
  l.setAttribute("data-verlauf-css", "");
  l._bereit = new Promise((ok) => { l.onload = ok; l.onerror = ok; setTimeout(ok, 2500); });
  document.head.append(l);
  return l._bereit;
}

// ---------------------------------------------------------------- Zeit und Datum
const TAG_MS = 86400000;
const tagesStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

export function relativeZeit(iso, jetzt = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const min = Math.floor((jetzt - t) / 60000);
  if (min < 1) return TV.zeit.geradeEben;
  if (min < 60) return TV.zeit.min(min);
  const std = Math.floor(min / 60);
  if (std < 24) return TV.zeit.std(std);
  const tage = Math.round((tagesStart(jetzt) - tagesStart(t)) / TAG_MS);
  if (tage <= 1) return TV.zeit.gestern;
  if (tage < 7) return TV.zeit.tage(tage);
  if (tage < 31) return TV.zeit.wochen(Math.floor(tage / 7));
  if (tage < 365) return TV.zeit.monate(Math.max(1, Math.floor(tage / 30)));
  return TV.zeit.jahre(Math.floor(tage / 365));
}

export function tagesTitel(datum) {
  const d = new Date(String(datum) + "T12:00:00");
  if (Number.isNaN(d.getTime())) return String(datum);
  return d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
const volleZeit = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("de-DE", { dateStyle: "full", timeStyle: "short" });
};

// ---------------------------------------------------------------- Daten
const statusBuchstabe = (s) => { const b = String(s || "M")[0].toUpperCase(); return "AMDR".includes(b) ? b : "M"; };
function statusAusCode(code) {
  const c = String(code || "");
  if (c.includes("?") || c.includes("A")) return "A";
  if (c.includes("D")) return "D";
  if (c.includes("R")) return "R";
  return "M";
}
function normCommit(c) {
  const dateien = (c.dateien || []).map((d) => ({ pfad: String(d.pfad), status: statusBuchstabe(d.status) }));
  const zahl = (s) => dateien.filter((d) => d.status === s).length;
  return {
    sha: c.sha,
    kurz: c.kurz || String(c.sha || "").slice(0, 7),
    nachricht: c.nachricht || "",
    zeit: c.zeit || null,
    autor: c.autor || "",
    plus: Number.isFinite(c.plus) ? c.plus : zahl("A"),
    geaendert: Number.isFinite(c.geaendert) ? c.geaendert : zahl("M") + zahl("R"),
    geloescht: zahl("D"),
    dateien,
  };
}
const zaehleCommits = (tage) => (tage || []).reduce((s, t) => s + (t.commits || []).length, 0);

// ---------------------------------------------------------------- kleine Bausteine
const dateiAnzeige = (pfad) => ohneEndung(dateiName(pfad));
// replaceChildren() würde null als Text „null“ einfügen: leere Werte vorher entfernen.
const setze = (el, ...kinder) => el.replaceChildren(...kinder.flat().filter((k) => k !== null && k !== undefined && k !== false));
// Lange Ordnerpfade vorn kürzen: 09_wiki/wissen/agentic-os/tief -> …/agentic-os/tief
function kurzOrdner(o) {
  const teile = o.split("/");
  return teile.length > 2 ? "…/" + teile.slice(-2).join("/") : o;
}
function dateiNamen(pfad, klassen) {
  const o = ordnerVon(pfad);
  return [h("span", { klasse: klassen.name, text: dateiAnzeige(pfad) }), o ? h("span", { klasse: klassen.ordner, title: o, text: kurzOrdner(o) }) : null];
}
function zeichen(name, groesse, klasse) {
  const s = symbol(name, groesse);
  s.setAttribute("aria-hidden", "true");
  if (klasse) s.setAttribute("class", klasse);
  return s;
}

// Roher Text der Versionsverwaltung (fatal:, ssh …) gehört nicht in die Oberfläche: Nutzer sehen einen ruhigen Satz, die Details sind aufklappbar.
export const istRohGit = (t) => /(^|\n)\s*(fatal|error|warning|hint|remote):|permission denied|could not (read|resolve|connect|lock)|unable to |refs\/|\.git\/|exit code|stderr|\bssh:|\brejected\]|\bgit(\.exe)? [a-z-]+ /i.test(String(t || ""));
export function detailsBlock(text) {
  return h("details", { klasse: "roh-details" }, h("summary", { text: TV.roh.details }), h("pre", { klasse: "roh-text", tabindex: "0", text: String(text) }));
}
// Rundes Namenskürzel statt Commit-Knoten: wer hat's gesichert. Farbe stabil aus dem Namen.
const AVATAR_FARBEN = 6;
function avatar(name) {
  const n = String(name || "").trim();
  const teile = n.split(/\s+/).filter(Boolean);
  const kuerzel = n ? ((teile[0][0] || "") + (teile.length > 1 ? teile[teile.length - 1][0] : "")).toUpperCase() : "";
  let q = 0; for (const ch of n) q = (q * 31 + ch.codePointAt(0)) % 997;
  const a = h("span", { klasse: "vl-avatar av" + (q % AVATAR_FARBEN), "aria-hidden": "true" });
  if (kuerzel) a.textContent = kuerzel; else a.append(zeichen("person", 14));
  return a;
}
const lokalerTag = (d) => d.toLocaleDateString("sv-SE");
function tagesLabel(datum) {
  const jetzt = new Date();
  if (datum === lokalerTag(jetzt)) return TV.heute;
  const gestern = new Date(jetzt); gestern.setDate(gestern.getDate() - 1);
  return datum === lokalerTag(gestern) ? TV.gestern : "";
}

// Pro Host lebt höchstens eine Instanz: ein erneuter Aufruf räumt die vorige ab (Listener, späte Antworten).
const LISTEN = new WeakMap();
const DIFFS = new WeakMap();

// =============================================================================================
//  Verlauf-Liste
// =============================================================================================
export function zeichneVerlauf(host, { api, beiDatei, beiCommitOeffnen, beiGesperrt } = {}) {
  LISTEN.get(host)?.zerstoere();
  // naechste = „vor“-Wert für die nächste Seite, so wie die Werkstatt ihn liefert (fehlt er: der letzte geladene Commit)
  const z = { phase: "laedt", fehler: null, tage: [], ungesichert: [], ende: false, naechste: null, laedtMehr: false, mehrFehler: false };
  const eingeklappt = new Set();   // Tage (Datum), die zu sind
  const offen = new Set();         // Commits (sha), die aufgeklappt sind
  let gewaehlt = null;             // Schlüssel der gewählten Datei
  let aktiv = null;                // Schlüssel der Zeile mit tabindex=0
  let tot = false;
  let nr = 0;

  const wurzel = h("div", { klasse: "vl", role: "tree", "aria-label": TV.liste });
  host.replaceChildren(wurzel);
  const cssBereit = ladeVerlaufCss();

  // ------------------------------------------------ Zeichnen
  function zeichne({ fokusNach } = {}) {
    if (tot) return;
    const hatteFokus = wurzel.contains(document.activeElement);
    const fokusKey = hatteFokus ? document.activeElement.closest?.(".vl-zeile")?.dataset.schluessel : null;
    const teile = [];
    if (z.phase === "laedt") teile.push(skelett());
    else if (z.phase === "keinGit") teile.push(leerBlock("verlauf", TV.keinGit.titel, TV.keinGit.text));
    else if (z.phase === "gesperrt") teile.push(leerBlock("schild", TV.gesperrt.titel, TV.gesperrt.text, { knopf: beiGesperrt ? { name: "vertrauen", text: TV.gesperrt.knopf } : null }));
    else if (z.phase === "fehler") {
      const roh = !!z.fehler && istRohGit(z.fehler);
      teile.push(leerBlock("warnung", TV.fehler.titel, roh ? TV.roh.verlauf : (z.fehler || TV.fehler.text), { nochmal: true, details: roh ? z.fehler : null }));
    }
    else {
      if (z.ungesichert.length) teile.push(h("div", { klasse: "vl-ungesichert" }, commitBlock(ungesichertCommit(), { ungesichert: true })));
      if (!z.tage.length) teile.push(leerBlock("verlauf", TV.leer.titel, TV.leer.text));
      for (const t of z.tage) teile.push(tagBlock(t));
      if (z.tage.length && !z.ende) teile.push(mehrBlock());
    }
    wurzel.replaceChildren(...teile);
    setzeRoving(fokusKey);
    markiere();
    if (fokusNach) fokussiere(wurzel.querySelector(`[data-schluessel="${CSS.escape(fokusNach)}"]`));
    else if (hatteFokus) fokussiere(fokusKey && wurzel.querySelector(`[data-schluessel="${CSS.escape(fokusKey)}"]`) || wurzel.querySelector(".vl-zeile"));
  }

  const ungesichertCommit = () => ({
    sha: null, kurz: "", nachricht: TV.ungesichert, zeit: null, autor: "", plus: 0, geaendert: 0, geloescht: 0,
    dateien: z.ungesichert,
  });

  function skelett() {
    const zeile = (breite) => h("div", { klasse: "vl-sk-zeile" }, h("span", { klasse: "vl-sk-punkt" }), h("div", { klasse: "vl-sk-text" }, h("span", { klasse: "vl-sk-balken", style: `width:${breite}%` }), h("span", { klasse: "vl-sk-balken klein" })));
    return h("div", { klasse: "vl-skelett", "aria-busy": "true", "aria-label": TV.laedt }, h("div", { klasse: "vl-sk-kopf" }), zeile(78), zeile(62), h("div", { klasse: "vl-sk-kopf" }), zeile(70), zeile(84), zeile(55));
  }

  function leerBlock(symbolName, titel, text, { nochmal = false, knopf = null, details = null } = {}) {
    return h("div", { klasse: "vl-leer", role: "status" },
      h("span", { klasse: "vl-leer-zeichen" }, zeichen(symbolName, 20)),
      h("div", { klasse: "vl-leer-titel", text: titel }),
      h("p", { klasse: "vl-leer-text", text }),
      details ? detailsBlock(details) : null,
      nochmal ? baueKnopf({ text: TV.fehler.nochmal, aktion: "nochmal" }) : null,
      knopf ? baueKnopf({ text: knopf.text, aktion: knopf.name }) : null);
  }

  function mehrBlock() {
    return h("div", { klasse: "vl-mehr-zeile" },
      z.mehrFehler ? h("p", { klasse: "vl-mehr-fehler", text: TV.mehrFehler }) : null,
      h("button", { klasse: "vl-mehr", type: "button", "data-aktion": "mehr", disabled: z.laedtMehr, text: z.laedtMehr ? TV.mehrLaedt : (z.mehrFehler ? TV.fehler.nochmal : TV.mehr) }));
  }

  function tagBlock(t) {
    const zu = eingeklappt.has(t.datum);
    const kopf = h("div", { klasse: "vl-zeile vl-tagkopf", role: "treeitem", "aria-level": "1", "aria-expanded": String(!zu), tabindex: "-1", "data-art": "tag", "data-schluessel": "tag:" + t.datum, "data-datum": t.datum },
      h("span", { klasse: "vl-chev" }, zeichen("chevron-unten", 12)),
      h("span", { klasse: "vl-tagtext", text: tagesTitel(t.datum) }),
      tagesLabel(t.datum) ? h("span", { klasse: "vl-tagrel", text: tagesLabel(t.datum) }) : null,
      h("span", { klasse: "vl-tagzahl", text: TV.tagZahl(t.commits.length) }));
    const gruppe = h("div", { klasse: "vl-gruppe vl-commits", role: "group", hidden: zu }, t.commits.map((c) => commitBlock(c)));
    return h("section", { klasse: "vl-tag" }, kopf, gruppe);
  }

  function commitBlock(c, { ungesichert = false } = {}) {
    const key = c.sha || UNGESICHERT;
    const auf = offen.has(key);
    const meta = ungesichert
      ? [h("span", { klasse: "vl-zeit", text: TV.ungesichertMeta(c.dateien.length) })]
      : [
        c.zeit ? h("span", { klasse: "vl-zeit", title: volleZeit(c.zeit), text: relativeZeit(c.zeit) }) : null,
        c.autor ? h("span", { klasse: "vl-autor", title: TV.von(c.autor), text: c.autor }) : null,
        h("span", { klasse: "vl-hash", text: c.kurz }),
        c.plus > 0 ? h("span", { klasse: "vl-plus", title: TV.zaehlerPlus(c.plus), text: "+" + c.plus }) : null,
        c.geaendert > 0 ? h("span", { klasse: "vl-aender", title: TV.zaehlerAender(c.geaendert), text: "~" + c.geaendert }) : null,
        c.geloescht > 0 ? h("span", { klasse: "vl-weg", title: TV.zaehlerWeg(c.geloescht), text: "−" + c.geloescht }) : null,
      ];
    const zeile = h("div", { klasse: "vl-zeile vl-commitzeile" + (ungesichert ? " ungesichert" : ""), role: "treeitem", "aria-level": ungesichert ? "1" : "2", "aria-expanded": String(auf), "aria-label": ungesichert ? `${TV.ungesichert} · ${c.dateien.length}` : undefined, tabindex: "-1", "data-art": "commit", "data-schluessel": "c:" + key, "data-sha": c.sha || "", title: c.nachricht || undefined },
      h("span", { klasse: "vl-knoten" + (ungesichert ? " ungesichert" : "") }, ungesichert ? zeichen("stift", 14) : avatar(c.autor)),
      h("span", { klasse: "vl-text" },
        h("span", { klasse: "vl-nachricht", text: c.nachricht || TV.ohneNachricht }),
        h("span", { klasse: "vl-meta" }, meta)),
      ungesichert ? h("span", { klasse: "vl-zahl", text: String(c.dateien.length) }) : null,
      h("span", { klasse: "vl-pfeil" }, zeichen("chevron-rechts", 14)));
    zeile._d = { commit: c };
    const dateien = h("div", { klasse: "vl-gruppe vl-dateien", role: "group", hidden: !auf });
    if (auf) fuelleDateien(dateien, c);
    return h("div", { klasse: "vl-commit" }, zeile, dateien);
  }

  function fuelleDateien(gruppe, c) {
    gruppe.dataset.gebaut = "1";
    if (!c.dateien.length) { gruppe.replaceChildren(h("p", { klasse: "vl-keine", text: TV.keineDateien })); return; }
    gruppe.replaceChildren(...c.dateien.map((d) => {
      const key = "d:" + (c.sha || UNGESICHERT) + ":" + d.pfad;
      const zeile = h("div", { klasse: "vl-zeile vl-datei" + (d.status === "D" ? " weg" : ""), role: "treeitem", "aria-level": c.sha ? "3" : "2", "aria-selected": String(gewaehlt === key), tabindex: "-1", "data-art": "datei", "data-schluessel": key, "data-pfad": d.pfad, "data-status": d.status, title: d.pfad + " · " + (TV.status[d.status] || "") },
        h("span", { klasse: "vl-marke vs-" + d.status.toLowerCase(), "aria-label": TV.status[d.status], text: TV.statusBuchstabe[d.status] }),
        h("span", { klasse: "vl-dname" }, dateiNamen(d.pfad, { name: "vl-dtitel", ordner: "vl-dordner" })));
      zeile._d = { commit: c, datei: d };
      return zeile;
    }));
  }

  // ------------------------------------------------ Zustand an der Oberfläche
  function markiere() {
    for (const el of wurzel.querySelectorAll(".vl-datei")) el.setAttribute("aria-selected", String(el.dataset.schluessel === gewaehlt));
  }
  function setzeRoving(bevorzugt) {
    const alle = [...wurzel.querySelectorAll(".vl-zeile")];
    const ziel = (bevorzugt && alle.find((e) => e.dataset.schluessel === bevorzugt && !e.closest("[hidden]")))
      || (aktiv && alle.find((e) => e.dataset.schluessel === aktiv && !e.closest("[hidden]")))
      || (gewaehlt && alle.find((e) => e.dataset.schluessel === gewaehlt && !e.closest("[hidden]")))
      || alle[0];
    for (const e of alle) e.setAttribute("tabindex", e === ziel ? "0" : "-1");
    aktiv = ziel?.dataset.schluessel || null;
  }
  function fokussiere(zeile) {
    if (!zeile) return;
    for (const e of wurzel.querySelectorAll('.vl-zeile[tabindex="0"]')) if (e !== zeile) e.setAttribute("tabindex", "-1");
    zeile.setAttribute("tabindex", "0");
    aktiv = zeile.dataset.schluessel;
    zeile.focus({ preventScroll: true });
    zeile.scrollIntoView({ block: "nearest" });
  }
  const sichtbareZeilen = () => [...wurzel.querySelectorAll(".vl-zeile")].filter((e) => !e.closest("[hidden]"));
  function elternZeile(zeile) {
    const art = zeile.dataset.art;
    if (art === "datei") return zeile.closest(".vl-dateien")?.previousElementSibling || null;
    if (art === "commit") return zeile.closest(".vl-commits")?.previousElementSibling || null;
    return null;
  }

  function schalte(zeile, auf) {
    const art = zeile.dataset.art;
    if (art === "datei") return;
    const gruppe = zeile.nextElementSibling;
    const neu = auf === undefined ? zeile.getAttribute("aria-expanded") !== "true" : auf;
    if (String(neu) === zeile.getAttribute("aria-expanded")) return;
    zeile.setAttribute("aria-expanded", String(neu));
    if (art === "commit" && neu && !gruppe.dataset.gebaut) fuelleDateien(gruppe, zeile._d.commit);
    gruppe.hidden = !neu;
    if (neu) { gruppe.classList.remove("vl-ein"); void gruppe.offsetWidth; gruppe.classList.add("vl-ein"); }
    if (art === "tag") { if (neu) eingeklappt.delete(zeile.dataset.datum); else eingeklappt.add(zeile.dataset.datum); }
    else {
      const key = zeile._d.commit.sha || UNGESICHERT;
      if (neu) { offen.add(key); if (zeile._d.commit.sha) beiCommitOeffnen?.(zeile._d.commit); } else offen.delete(key);
    }
  }

  function oeffneDatei(zeile) {
    const { commit, datei } = zeile._d;
    gewaehlt = zeile.dataset.schluessel;
    markiere();
    beiDatei?.({
      sha: commit.sha || null,
      kurz: commit.sha ? commit.kurz : "",
      nachricht: commit.sha ? commit.nachricht : TV.ungesichert,
      zeit: commit.zeit || null,
      pfad: datei.pfad,
      status: datei.status,
    });
  }

  // ------------------------------------------------ Ereignisse
  wurzel.addEventListener("click", (e) => {
    const zeile = e.target.closest?.(".vl-zeile");
    if (zeile && wurzel.contains(zeile)) {
      fokussiere(zeile);
      if (zeile.dataset.art === "datei") oeffneDatei(zeile); else schalte(zeile);
      return;
    }
    const knopf = e.target.closest?.("button[data-aktion]");
    if (!knopf) return;
    if (knopf.dataset.aktion === "nochmal") { if (z.phase === "fehler") aktualisieren(); else ladeMehr(); }
    else if (knopf.dataset.aktion === "mehr") ladeMehr();
    else if (knopf.dataset.aktion === "vertrauen") beiGesperrt?.();
  });

  wurzel.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const zeile = e.target.closest?.(".vl-zeile");
    if (!zeile) return;
    const liste = sichtbareZeilen();
    const i = liste.indexOf(zeile);
    const art = zeile.dataset.art;
    const stand = zeile.getAttribute("aria-expanded");
    switch (e.key) {
      case "ArrowDown": fokussiere(liste[Math.min(i + 1, liste.length - 1)]); break;
      case "ArrowUp": fokussiere(liste[Math.max(i - 1, 0)]); break;
      case "Home": fokussiere(liste[0]); break;
      case "End": fokussiere(liste[liste.length - 1]); break;
      case "ArrowRight":
        if (stand === "false") schalte(zeile, true);
        else if (stand === "true") { const n = liste[i + 1]; if (n && elternZeile(n) === zeile) fokussiere(n); }
        break;
      case "ArrowLeft":
        if (stand === "true") schalte(zeile, false);
        else fokussiere(elternZeile(zeile));
        break;
      case "Enter":
      case " ":
        if (art === "datei") oeffneDatei(zeile); else schalte(zeile);
        break;
      default: return;
    }
    e.preventDefault();
  });

  // ------------------------------------------------ Laden
  function mische(neueTage) {
    for (const t of neueTage || []) {
      const commits = (t.commits || []).map(normCommit);
      const da = z.tage.find((x) => x.datum === t.datum);
      if (da) da.commits.push(...commits.filter((c) => !da.commits.some((v) => v.sha === c.sha)));
      else z.tage.push({ datum: t.datum, commits });
    }
  }
  const letzterCommit = () => { const t = z.tage[z.tage.length - 1]; return t?.commits[t.commits.length - 1] || null; };
  // „weitere“ sagt die Werkstatt selbst; fehlt es (ältere Antwort), entscheidet die Zahl der gelieferten Commits
  const istEnde = (r, anzahl, angefordert) => r?.weitere === false || (r?.weitere !== true && anzahl < angefordert) || anzahl === 0;
  const letzteSha = (tage) => { const t = tage[tage.length - 1]; return t?.commits?.[t.commits.length - 1]?.sha || null; };
  // Holt mindestens `ziel` Commits. Die Werkstatt liefert je Aufruf höchstens 200: der Rest kommt seitenweise nach (vor = naechste).
  async function ladeBis(ziel) {
    const erste = await api.gitLog({ max: Math.min(ziel, MAX_SEITE) });
    const tage = [...(erste?.tage || [])];
    let letzte = erste, anzahl = zaehleCommits(erste?.tage);
    for (let runde = 0; runde < 50 && anzahl < ziel && letzte?.weitere === true; runde++) {
      const vor = letzte.naechste || letzteSha(tage);
      if (!vor) break;
      letzte = await api.gitLog({ max: Math.min(ziel - anzahl, MAX_SEITE), vor });
      tage.push(...(letzte?.tage || []));
      anzahl += zaehleCommits(letzte?.tage);
      if (!zaehleCommits(letzte?.tage)) break;
    }
    return { tage, weitere: letzte?.weitere, naechste: letzte?.naechste ?? null };
  }
  async function aktualisieren() {
    if (tot) return;
    const meine = ++nr;
    const hatDaten = z.phase === "ok";
    if (!hatDaten) { z.phase = "laedt"; zeichne(); }
    await cssBereit;
    const geladen = Math.max(SEITE, z.tage.reduce((s, t) => s + t.commits.length, 0));
    const [log, st] = await Promise.allSettled([
      Promise.resolve().then(() => ladeBis(geladen)),
      Promise.resolve().then(() => api.status?.()),
    ]);
    if (tot || meine !== nr) return;
    const stand = st.status === "fulfilled" ? st.value : null;
    if (stand && stand.repo === false) { z.phase = "keinGit"; z.tage = []; z.ungesichert = []; zeichne(); return; }
    if ((stand && stand.gesperrt === true) || (log.status === "rejected" && gitGesperrt(log.reason))) { z.phase = "gesperrt"; z.tage = []; z.ungesichert = []; zeichne(); return; }
    if (log.status === "rejected") {
      if (hatDaten) return;
      z.phase = "fehler";
      z.fehler = log.reason?.message || null;
      zeichne();
      return;
    }
    z.phase = "ok";
    z.fehler = null;
    z.tage = [];
    mische(log.value?.tage);
    z.naechste = log.value?.naechste ?? null;
    z.ende = istEnde(log.value, zaehleCommits(log.value?.tage), geladen);
    z.laedtMehr = false; z.mehrFehler = false;
    z.ungesichert = (stand?.geaendert || []).map((g) => ({ pfad: String(g.pfad), status: statusAusCode(g.code) }));
    zeichne();
  }

  async function ladeMehr() {
    if (tot || z.laedtMehr || z.ende) return;
    const letzter = letzterCommit();
    if (!letzter) return;
    const meine = nr;
    const hatteFokus = wurzel.contains(document.activeElement) && document.activeElement.matches?.("button[data-aktion]");
    z.laedtMehr = true; z.mehrFehler = false; zeichne();
    try {
      const r = await api.gitLog({ max: SEITE, vor: z.naechste || letzter.sha });
      if (tot) return;
      if (meine !== nr) { z.laedtMehr = false; return; }
      const vorher = letzter.sha;
      mische(r?.tage);
      z.naechste = r?.naechste ?? null;
      z.ende = istEnde(r, zaehleCommits(r?.tage), SEITE);
      z.laedtMehr = false;
      let erster = null;
      let gefunden = false;
      for (const t of z.tage) for (const c of t.commits) { if (gefunden && !erster) erster = c.sha; if (c.sha === vorher) gefunden = true; }
      zeichne({ fokusNach: hatteFokus && erster ? "c:" + erster : undefined });
    } catch (e) {
      if (tot) return;
      z.laedtMehr = false;
      if (gitGesperrt(e)) { z.phase = "gesperrt"; z.tage = []; z.ungesichert = []; } else z.mehrFehler = true;
      zeichne();
    }
  }

  aktualisieren();

  const instanz = {
    aktualisieren,
    zerstoere() {
      tot = true;
      if (LISTEN.get(host) === instanz) LISTEN.delete(host);
      if (wurzel.parentNode === host) host.replaceChildren();
    },
  };
  LISTEN.set(host, instanz);
  return instanz;
}

// =============================================================================================
//  Diff-Ansicht
// =============================================================================================
export function parseDiff(text) {
  const zeilen = String(text || "").replace(/\r\n/g, "\n").split("\n");
  if (zeilen[zeilen.length - 1] === "") zeilen.pop();
  const aus = [];
  let alt = 0, neu = 0, imHunk = false, plus = 0, minus = 0, binaer = false;
  for (const zl of zeilen) {
    if (zl.startsWith("@@")) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(zl);
      alt = m ? Number(m[1]) : 0; neu = m ? Number(m[2]) : 0; imHunk = true;
      aus.push({ art: "h", kopf: m ? zl.slice(0, zl.indexOf("@@", 2) + 2) : zl, text: m ? m[3] : "" });
      continue;
    }
    if (!imHunk) {
      if (/^(diff --git|index |--- |\+\+\+ )/.test(zl)) continue;
      if (/^(Binary files|GIT binary patch)/.test(zl)) { binaer = true; continue; }
      aus.push({ art: "k", text: zl });
      continue;
    }
    if (zl[0] === "\\") { aus.push({ art: "k", text: TV.diff.keinUmbruch }); continue; }
    if (zl[0] === "+") { aus.push({ art: "p", neu: neu++, text: zl.slice(1) }); plus++; }
    else if (zl[0] === "-") { aus.push({ art: "m", alt: alt++, text: zl.slice(1) }); minus++; }
    else aus.push({ art: "c", alt: alt++, neu: neu++, text: zl.slice(1) });
  }
  // Geänderte Wörter in 1:1-Paaren (n entfernte Zeilen, direkt danach n neue Zeilen) hervorheben.
  for (let i = 0; i < aus.length;) {
    if (aus[i].art !== "m") { i++; continue; }
    let j = i; while (j < aus.length && aus[j].art === "m") j++;
    let k = j; while (k < aus.length && aus[k].art === "p") k++;
    if (j - i === k - j) for (let q = 0; q < j - i; q++) markiereWorte(aus[i + q], aus[j + q]);
    i = k > j ? k : j;
  }
  return { zeilen: aus, plus, minus, binaer };
}

// Wortgenauer Vergleich zweier Zeilen (längste gemeinsame Folge über Wörter, Leerraum und Satzzeichen).
// Ergebnis je Zeile: seg = [[Text, geändert?], …]. Fast alles anders (< 30 % gemeinsam): keine Marken, die Zeilentönung reicht.
const WORTTEILE = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;
function markiereWorte(alt, neu) {
  const a = alt.text, b = neu.text;
  const x = a.match(WORTTEILE) || [], y = b.match(WORTTEILE) || [];
  if (!x.length || !y.length || x.length * y.length > 60000) return;
  const n = x.length, m = y.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const sa = [], sb = [];
  const schiebe = (liste, text, geaendert) => {
    if (!text) return;
    const l = liste[liste.length - 1];
    if (l && l[1] === geaendert) l[0] += text; else liste.push([text, geaendert]);
  };
  let gemeinsam = 0;
  for (let i = 0, j = 0; i < n || j < m;) {
    if (i < n && j < m && x[i] === y[j]) { schiebe(sa, x[i], false); schiebe(sb, y[j], false); gemeinsam += x[i].length; i++; j++; }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { schiebe(sb, y[j], true); j++; }
    else { schiebe(sa, x[i], true); i++; }
  }
  if (!gemeinsam || gemeinsam < 0.3 * Math.max(a.length, b.length)) return;
  // Reiner Leerraum zwischen zwei Marken gehört dazu (ein zusammenhängender Block statt Flickenteppich)
  const verbinde = (liste) => {
    for (let k = 1; k < liste.length - 1; k++) if (!liste[k][1] && /^\s+$/.test(liste[k][0]) && liste[k - 1][1] && liste[k + 1][1]) liste[k][1] = true;
    const aus = [];
    for (const [t, g] of liste) { const l = aus[aus.length - 1]; if (l && l[1] === g) l[0] += t; else aus.push([t, g]); }
    return aus;
  };
  const ra = verbinde(sa), rb = verbinde(sb);
  if (!ra.some((s) => s[1]) && !rb.some((s) => s[1])) return;
  alt.seg = ra; neu.seg = rb;
}

export function zeigeDiff(host, { api, sha, kurz, nachricht, pfad, status, zeit, beiSchliessen, beiWiederherstellen } = {}) {
  DIFFS.get(host)?.zerstoere();
  let tot = false;
  const cssBereit = ladeVerlaufCss();
  const ungesichert = !sha;
  const o = ordnerVon(pfad || "");
  const kannWieder = !ungesichert && status !== "D";
  const stat = h("span", { klasse: "vd-stat" });

  const zurueck = h("button", { klasse: "vd-zurueck", type: "button", "data-aktion": "diff-zu" }, zeichen("pfeil-links", 14), h("span", { text: TV.diff.zurueck }));
  const wieder = kannWieder
    ? baueKnopf({ klasse: "vd-wieder", aktion: "diff-wiederherstellen", kinder: [zeichen("uhr", 14), h("span", { text: TV.diff.wiederherstellen })] })
    : null;
  const koerper = h("div", { klasse: "vd-koerper", tabindex: "0", role: "region", "aria-label": TV.diff.bereich });
  let ansicht = leseDiffAnsicht();
  let geparst = null, gezeigtZeilen = [];
  const umschalter = ansichtUmschalter(ansicht, (a) => { ansicht = a; zeichneKoerper(); });
  umschalter.hidden = true;
  const wurzel = h("div", { klasse: "vd", "data-diff-ansicht": "" },
    h("div", { klasse: "vd-leiste" }, zurueck, h("div", { klasse: "vd-leiste-rechts" }, umschalter, wieder)),
    h("header", { klasse: "vd-kopf" },
      h("h2", { klasse: "vd-titel", title: pfad || undefined },
        h("span", { klasse: "vd-dateiname", text: dateiAnzeige(pfad || "") }),
        o ? h("span", { klasse: "vd-ordner", title: o, text: kurzOrdner(o) }) : null,
        status ? h("span", { klasse: "vd-status vs-" + String(status).toLowerCase(), text: TV.status[status] || "" }) : null),
      h("div", { klasse: "vd-meta" },
        ungesichert
          ? h("span", { klasse: "vd-ungesichert", text: TV.ungesichert })
          : [
            h("span", { klasse: "vd-hash", text: kurz || "" }),
            nachricht ? h("span", { klasse: "vd-nachricht", text: nachricht }) : null,
            zeit ? h("span", { klasse: "vd-zeit", title: volleZeit(zeit), text: relativeZeit(zeit) }) : null,
          ],
        stat)),
    koerper);
  host.replaceChildren(wurzel);

  const schliessen = () => beiSchliessen?.();
  zurueck.addEventListener("click", schliessen);
  wieder?.addEventListener("click", () => beiWiederherstellen?.({ pfad, sha }));
  const taste = (e) => {
    if (e.key !== "Escape" || e.defaultPrevented || tot) return;
    if (document.querySelector("#dialog-host .schleier")) return;
    const a = document.activeElement;
    // Escape gilt, wenn der Fokus im Diff, in der Verlaufsliste oder nirgends Bestimmtes liegt (nicht in Eingabefeldern).
    if (a && a !== document.body && !wurzel.contains(a) && !a.closest?.(".vl-zeile")) return;
    e.preventDefault();
    schliessen();
  };
  document.addEventListener("keydown", taste);

  koerper.replaceChildren(h("div", { klasse: "vd-laedt", role: "status", "aria-busy": "true" }, h("span", { klasse: "vd-sk" }), h("span", { klasse: "vd-sk k" }), h("span", { klasse: "vd-sk" }), h("span", { klasse: "vd-sk m" })));

  (async () => {
    await cssBereit;
    let text;
    try { text = (await api.diff(pfad, sha || undefined))?.diff; }
    catch (e) {
      if (tot) return;
      const roh = !gitGesperrt(e) && e?.message && istRohGit(e.message);
      koerper.replaceChildren(h("div", { klasse: "vd-hinweis fehlertext" }, h("p", { text: gitGesperrt(e) ? TV.diff.gesperrt : (roh ? TV.diff.fehler : (e?.message || TV.diff.fehler)) }), roh ? detailsBlock(e.message) : null));
      return;
    }
    if (tot) return;
    if (!text || !String(text).trim()) { koerper.replaceChildren(h("p", { klasse: "vd-hinweis", text: TV.diff.leer })); return; }
    const d = parseDiff(text);
    if (d.binaer && !d.zeilen.some((x) => x.art !== "k")) { koerper.replaceChildren(h("p", { klasse: "vd-hinweis", text: TV.diff.keinText })); return; }
    const gesamt = d.zeilen.length;
    const gezeigt = d.zeilen.slice(0, MAX_DIFF_ZEILEN);
    setze(stat,
      d.plus ? h("span", { klasse: "vl-plus", title: TV.diff.plusZeilen(d.plus), text: "+" + d.plus }) : null,
      d.minus ? h("span", { klasse: "vl-weg", title: TV.diff.minusZeilen(d.minus), text: "−" + d.minus }) : null);
    geparst = { gesamt }; gezeigtZeilen = gezeigt;
    umschalter.hidden = false;
    zeichneKoerper();
  })();
  function zeichneKoerper() {
    if (!geparst || tot) return;
    setze(koerper,
      geparst.gesamt > MAX_DIFF_ZEILEN ? h("p", { klasse: "vd-gekuerzt", role: "note", text: TV.diff.gekuerzt(geparst.gesamt, MAX_DIFF_ZEILEN) }) : null,
      diffKarte(gezeigtZeilen, ansicht));
  }

  const instanz = {
    zerstoere() {
      tot = true;
      document.removeEventListener("keydown", taste);
      if (DIFFS.get(host) === instanz) DIFFS.delete(host);
      if (wurzel.parentNode === host) host.replaceChildren();
    },
  };
  DIFFS.set(host, instanz);
  return instanz;
}

export function diffZeile(x) {
  if (x.art === "h") {
    return h("div", { klasse: "vd-z h" },
      h("span", { klasse: "vd-nrs" }, h("span", { klasse: "vd-nr alt" }), h("span", { klasse: "vd-nr neu" }), h("span", { klasse: "vd-vz" })),
      h("span", { klasse: "vd-code" }, h("span", { klasse: "vd-hunk", text: x.kopf }), x.text ? h("span", { klasse: "vd-kontext", text: x.text }) : null));
  }
  if (x.art === "k") {
    return h("div", { klasse: "vd-z k" },
      h("span", { klasse: "vd-nrs" }, h("span", { klasse: "vd-nr alt" }), h("span", { klasse: "vd-nr neu" }), h("span", { klasse: "vd-vz" })),
      h("span", { klasse: "vd-code", text: x.text || " " }));
  }
  return h("div", { klasse: "vd-z " + x.art },
    h("span", { klasse: "vd-nrs" },
      h("span", { klasse: "vd-nr alt", "aria-label": x.alt === undefined ? undefined : TV.diff.alt + " " + (x.alt), text: x.alt === undefined ? "" : String(x.alt) }),
      h("span", { klasse: "vd-nr neu", "aria-label": x.neu === undefined ? undefined : TV.diff.neu + " " + (x.neu), text: x.neu === undefined ? "" : String(x.neu) }),
      h("span", { klasse: "vd-vz", "aria-hidden": "true", text: x.art === "p" ? "+" : x.art === "m" ? "−" : "" })),
    codeSpan(x));
}
function codeSpan(x) {
  return x.seg
    ? h("span", { klasse: "vd-code" }, x.seg.map(([t, g]) => (g ? h("span", { klasse: "vd-w" }, t) : t)))
    : h("span", { klasse: "vd-code", text: x.text === "" ? " " : x.text });
}

// Nebeneinander: links die alte, rechts die neue Fassung. Gelöschte und neue Zeilen eines Blocks stehen paarweise in einer Reihe.
export function seitenReihen(zeilen) {
  const reihen = [];
  for (let i = 0; i < zeilen.length;) {
    const x = zeilen[i];
    if (x.art === "h" || x.art === "k") { reihen.push({ voll: x }); i++; continue; }
    if (x.art === "c") { reihen.push({ alt: x, neu: x }); i++; continue; }
    const ms = []; while (i < zeilen.length && zeilen[i].art === "m") ms.push(zeilen[i++]);
    const ps = []; while (i < zeilen.length && zeilen[i].art === "p") ps.push(zeilen[i++]);
    for (let q = 0; q < Math.max(ms.length, ps.length); q++) reihen.push({ alt: ms[q] || null, neu: ps[q] || null });
  }
  return reihen;
}
export function seitenReihe(r) {
  if (r.voll) return diffZeile(r.voll);
  const seite = (x, wo) => {
    if (!x) return h("div", { klasse: "vd-z platz", "aria-hidden": "true" }, h("span", { klasse: "vd-nrs" }, h("span", { klasse: "vd-nr" }), h("span", { klasse: "vd-vz" })), h("span", { klasse: "vd-code", text: " " }));
    const nr = wo === "alt" ? x.alt : x.neu;
    return h("div", { klasse: "vd-z " + x.art },
      h("span", { klasse: "vd-nrs" },
        h("span", { klasse: "vd-nr", "aria-label": (wo === "alt" ? TV.diff.alt : TV.diff.neu) + " " + nr, text: String(nr) }),
        h("span", { klasse: "vd-vz", "aria-hidden": "true", text: x.art === "p" ? "+" : x.art === "m" ? "−" : "" })),
      codeSpan(x));
  };
  return h("div", { klasse: "vd-paar" }, seite(r.alt, "alt"), seite(r.neu, "neu"));
}
const ANSICHT_SCHLUESSEL = "diff-ansicht";
export const leseDiffAnsicht = () => (leseLokal(ANSICHT_SCHLUESSEL, "zeilen") === "spalten" ? "spalten" : "zeilen");
// Umschalter „Untereinander | Nebeneinander“ (Segmente). beiWahl(ansicht) wird bei jeder Änderung gerufen.
export function ansichtUmschalter(aktuell, beiWahl) {
  const knoepfe = {};
  const setze = (a) => { for (const [k, b] of Object.entries(knoepfe)) b.setAttribute("aria-pressed", String(k === a)); };
  const mach = (name, sym, text) => {
    const b = h("button", { klasse: "seg-knopf", type: "button", "data-ansicht": name, "aria-pressed": String(aktuell === name), title: text }, zeichen(sym, 14), h("span", { text }));
    b.addEventListener("click", () => { setze(name); speichereLokal(ANSICHT_SCHLUESSEL, name); beiWahl(name); });
    knoepfe[name] = b;
    return b;
  };
  return h("div", { klasse: "seg", role: "group", "aria-label": TV.diff.ansicht.gruppe }, mach("zeilen", "ansicht-zeilen", TV.diff.ansicht.zeilen), mach("spalten", "ansicht-spalten", TV.diff.ansicht.spalten));
}
// Der Körper der Diff-Karte in der gewählten Ansicht (Kopfzeilen oben, bei „Nebeneinander“ mit Spaltenköpfen).
export function diffKarte(zeilen, ansicht) {
  if (ansicht === "spalten") {
    return h("div", { klasse: "vd-karte spalten" },
      h("div", { klasse: "vd-spaltenkopf", "aria-hidden": "true" }, h("span", { text: TV.diff.ansicht.davor }), h("span", { text: TV.diff.ansicht.danach })),
      h("div", { klasse: "vd-zeilen", "data-diff": "", "data-ansicht": "spalten" }, seitenReihen(zeilen).map(seitenReihe)));
  }
  return h("div", { klasse: "vd-karte" }, h("div", { klasse: "vd-zeilen", "data-diff": "", "data-ansicht": "zeilen" }, zeilen.map(diffZeile)));
}
