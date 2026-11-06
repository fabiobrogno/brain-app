// Schritt „Sicherung“ der Einrichtung (Paket E2): zwei Wege — „Mit GitHub sichern“ (Gerätecode im Overlay, dann ein privates Repository) und „Nur auf diesem Mac“.
// Der Ablauf der GitHub-Anmeldung ist der vorhandene (POST /api/github/anmelden → Code, Zustand alle 2 s, Abbrechen); neu ist nur die Hülle: dieses Modul kennt den Schritt,
// nicht das Overlay. Der Schritt entfällt ganz, wenn der Vault schon ein Remote hat oder von GitHub geholt wurde (das entscheidet das Overlay).
// Dasselbe Modul liefert die reine Anmeldung für „Von GitHub holen“ (privates Repository: `loginFuerKlon`).
import { h, toast } from "./hilfen.js";
import { api as standardApi, ausgangUnklar } from "./api.js";
import { symbol } from "./symbole.js";
import { markenLogo } from "./marken.js";
import { knopf as baueKnopf, textfeld } from "./bausteine.js";
import { TE } from "./texte-einrichtung.js";

const meldungVon = (e) => {
  if (ausgangUnklar(e)) return typeof e?.message === "string" && e.status === 504 ? e.message : TE.verbindungWeg;
  if ([404, 405, 501].includes(e?.status) && (!e?.message || /^(nicht gefunden|das hat nicht geklappt)\.?$/i.test(String(e.message).trim()))) return TE.nichtDa;
  const m = typeof e?.message === "string" ? e.message.trim() : "";
  return m || TE.vault.fehlerStandard;
};
// Vorschlag für den Repository-Namen (wie RepoName.vorschlag in Swift): klein, Umlaute ausgeschrieben, Unerlaubtes wird „-“.
export function repoVorschlag(name) {
  let s = String(name).toLowerCase();
  for (const [von, nach] of [["ä", "ae"], ["ö", "oe"], ["ü", "ue"], ["ß", "ss"]]) s = s.split(von).join(nach);
  s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  let aus = "";
  for (const z of s) {
    const ok = /[a-z0-9._-]/.test(z);
    const c = ok ? z : "-";
    if (c === "-" && aus.endsWith("-")) continue;
    aus += c;
  }
  aus = aus.replace(/^[-.]+|[-.]+$/g, "");
  if (aus.endsWith(".git")) aus = aus.slice(0, -4).replace(/^[-.]+|[-.]+$/g, "");
  if (aus.length > 100) aus = aus.slice(0, 100).replace(/[-.]+$/g, "");
  return aus && !aus.endsWith(".git") ? aus : "brain";
}
export function repoNameFehler(name) {
  if (!name) return TE.sicherung.repoName.leer;
  if (name.length > 100 || !/^[A-Za-z0-9._-]+$/.test(name) || name === "." || name === ".." || /\.git$/i.test(name)) return TE.sicherung.repoName.ungueltig;
  return null;
}

/**
 * @param {{ api?: object, vaultName: () => string, beiAenderung: () => void, kopiere: (t: string) => Promise<boolean>, oeffneGitHub: (url: string) => boolean }} p
 */
export function erzeugeSicherung({ api = standardApi, vaultName, beiAenderung = () => {}, kopiere, oeffneGitHub } = {}) {
  const Q = {
    sync: "start" /* start | code | abgelaufen | abgelehnt | ok | gesichert | blockiert | nichtVerfuegbar | laedt */, geladen: false, wahl: "github" /* github | lokal */, nurLogin: false,
    code: null, sekunden: 899, ablaufMs: 0, login: null, schonRemote: null, repo: "", repoFertig: null, syncFehler: null, syncText: "", vergeben: null, angelegt: null, lauf: 0,
    busy: null, loginWartet: null /* Promise-Auflösung für „Von GitHub holen“ */,
  };
  const wurzel = h("div", { klasse: "e-koerper e-sicherung", id: "e-sync", "data-bereich": "sicherung" });
  const aenderung = () => { try { beiAenderung(); } catch (e) { console.error(e); } };
  const $ = (s) => wurzel.querySelector(s);
  let codeTimer = null, pollTimer = null;

  // ---------------------------------------------------------------- Zeichnen
  const codeKnoten = (alt) => {
    const z = (Q.code?.code || "").split("");
    return h("div", { klasse: "e-code" + (alt ? " alt" : ""), role: "img", "aria-label": TE.sicherung.codeAria(Q.code?.code || "") },
      z.map((c, i) => (c === "-" ? h("span", { klasse: "strich", text: "–" }) : h("span", { style: `animation-delay:${i * 45}ms`, text: c }))));
  };
  const zeitText = () => `${Math.floor(Q.sekunden / 60)}:${String(Q.sekunden % 60).padStart(2, "0")}`;
  const leiseLink = (text, aktionName, fn) => { const b = h("button", { type: "button", klasse: "e-leise-link", "data-aktion": aktionName, text }); b.addEventListener("click", fn); return h("div", { style: "text-align:center" }, b); };
  function option(id, kinder, gewaehlt) {
    const b = h("div", { klasse: "e-opt e-opt-main", role: "radio", "aria-checked": String(gewaehlt), tabindex: gewaehlt ? "0" : "-1", "data-wahl": id }, ...kinder, h("span", { klasse: "e-rd" }, symbol("haken", 12)));
    const waehle = () => { if (Q.busy || Q.wahl === id) return; Q.wahl = id; Q.syncFehler = null; zeichne(); aenderung(); };
    b.addEventListener("click", waehle);
    b.addEventListener("keydown", (e) => { if (e.key === " " || (e.key === "Enter" && !e.metaKey && !e.ctrlKey)) { e.preventDefault(); waehle(); } if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); Q.wahl = id === "github" ? "lokal" : "github"; zeichne2(); } });
    return b;
  }
  const zeichne2 = () => { zeichne(); aenderung(); wurzel.querySelector(`[data-wahl="${Q.wahl}"]`)?.focus(); };
  const optionen = () => h("div", { klasse: "e-opts", role: "radiogroup", "aria-label": TE.kopf.sicherung.h },
    option("github", [h("span", { klasse: "e-tile" }, markenLogo("github", 20, { dekorativ: true })), h("div", { klasse: "e-tx" }, h("b", null, TE.sicherung.optGithub.t, h("span", { klasse: "e-badge brand e-empf", text: TE.sicherung.optGithub.empfohlen })), h("p", { text: TE.sicherung.optGithub.h }))], Q.wahl === "github"),
    option("lokal", [h("span", { klasse: "e-tile" }, symbol("laptop", 20)), h("div", { klasse: "e-tx" }, h("b", { text: TE.sicherung.optLokal.t }), h("p", { text: TE.sicherung.optLokal.h }))], Q.wahl === "lokal"));
  const hinweis = () => h("div", { klasse: "e-qhint" }, symbol("schild", 14), h("span", { text: TE.sicherung.zugriffHinweis }));
  function zeichne() {
    const k = [];
    const fehler = Q.syncFehler ? h("div", { klasse: "e-meldung schlecht", role: "alert", "data-bereich": "sync-fehler" }, symbol("warnung", 14), h("span", { text: Q.syncFehler })) : null;
    switch (Q.sync) {
      case "laedt":
        k.push(h("div", { klasse: "e-leer" }, h("span", { klasse: "e-lade" }), h("span", { klasse: "e-shimmer", text: TE.sicherung.laedt })));
        break;
      case "code": case "abgelaufen": case "abgelehnt": {
        const alt = Q.sync !== "code";
        const kop = baueKnopf({ text: TE.sicherung.kopieren, groesse: "s", symbol: "kopieren", aktion: "kopieren", disabled: alt, aufKlick: async () => { if (await kopiere(Q.code.code)) toast(TE.sicherung.kopiert); } });
        const gh = baueKnopf({ text: TE.sicherung.githubOeffnen, groesse: "s", aktion: "github-oeffnen", disabled: alt, nach: [symbol("extern", 12)], aufKlick: () => { if (oeffneGitHub(Q.code.url)) toast(TE.sicherung.githubGeoeffnet); else toast(TE.sicherung.adresseUngueltig, { fehler: true }); } });
        const status = h("div", { klasse: "e-code-status", "aria-live": "polite" },
          ...(Q.sync === "code" ? [h("span", { klasse: "e-lade" }), h("span", { klasse: "e-shimmer", text: TE.sicherung.wartet }), h("span", { klasse: "e-zeit e-tnum", id: "zeit", text: zeitText() })]
            : [h("span", { klasse: "e-badge warn" }, symbol("uhr", 12), Q.sync === "abgelaufen" ? TE.sicherung.abgelaufen : TE.sicherung.abgelehnt),
              h("span", { style: "color:var(--text-2)", text: Q.sync === "abgelaufen" ? TE.sicherung.abgelaufenText : TE.sicherung.abgelehntText })]));
        k.push(h("div", { klasse: "e-code-karte" }, h("span", { klasse: "e-cap", text: TE.sicherung.code }), codeKnoten(alt), h("div", { klasse: "e-code-akt" }, kop, gh), status),
          h("ol", { klasse: "e-mini-schritte" }, TE.sicherung.mini.map((t) => h("li", { text: t }))), fehler, leiseLink(TE.sicherung.abbrechen, "abbrechen", brecheAb));
        break;
      }
      case "ok": {
        const konto = h("div", { klasse: "e-konto" }, h("span", { klasse: "e-avatar", text: (Q.login || "GH").slice(0, 2).toUpperCase() }),
          h("div", { klasse: "e-t" }, h("b", { text: Q.login || TE.sicherung.angemeldet }), h("span", null, symbol("kreis-haken", 12), TE.sicherung.angemeldet)),
          baueKnopf({ text: TE.sicherung.anderesKonto, variante: "leise", klasse: "e-xs", aktion: "anderes", aufKlick: () => { Q.sync = "start"; zeichne(); aenderung(); } }));
        if (Q.nurLogin) { k.push(konto); break; }
        if (Q.schonRemote) { k.push(konto, h("div", { klasse: "e-meldung gut" }, symbol("kreis-haken", 14), h("span", { text: TE.sicherung.schonVerbunden(Q.schonRemote) }))); break; }
        k.push(optionen());
        if (Q.wahl === "lokal") { k.push(hinweis()); break; }
        const feld = textfeld({ wert: Q.repo, label: TE.sicherung.repoLabel, klasse: "e-feld-gross e-mono-feld", daten: { "data-feld": "repo" }, beiEingabe: (w) => { Q.repo = w; Q.vergeben = null; Q.syncFehler = null; $("#sync-fehler-ort")?.replaceChildren(); } });
        feld.feld.prepend(h("span", { klasse: "e-pre e-mono", text: `${Q.login || "…"}/` }));
        feld.feld.append(h("span", { klasse: "e-badge" }, symbol("schloss", 12), TE.sicherung.privat));
        k.push(konto, h("div", { klasse: "e-feld" }, h("label", { klasse: "e-label", for: feld.input.id, text: TE.sicherung.repoLabel }), feld.el, h("span", { klasse: "e-hint", text: TE.sicherung.repoHinweis })),
          h("div", { id: "sync-fehler-ort" }, fehler,
            Q.vergeben ? baueKnopf({ text: TE.sicherung.vorhandenNehmen(Q.vergeben), groesse: "s", aktion: "vorhanden-nehmen", aufKlick: async () => { const n = Q.vergeben; Q.syncFehler = null; if (await sichereMit(Q.login, n, false)) beiFertigSchritt?.(); } }) : null),
          h("div", { klasse: "e-schalt-zeile" }, h("div", null, h("b", { text: TE.sicherung.abgleich }), h("span", { text: TE.sicherung.abgleichText }))));
        break;
      }
      case "gesichert":
        k.push(h("div", { klasse: "e-leer" }, h("span", { klasse: "e-kreis" }, symbol("wolke-hoch", 24)), h("b", { text: TE.sicherung.schonGesichert }), h("p", { text: TE.sicherung.schonGesichertText })));
        break;
      case "blockiert":
        k.push(h("div", { klasse: "e-warnkarte" }, symbol("warnung", 16), h("div", null, h("b", { text: TE.sicherung.blockiert }), h("p", { text: Q.syncText })),
          h("div", { klasse: "e-akt" }, baueKnopf({ text: TE.git.nochmal, groesse: "s", aktion: "sync-neu", aufKlick: () => { Q.geladen = false; lade(); } }))));
        break;
      case "nichtVerfuegbar":
        k.push(h("div", { klasse: "e-leer" }, h("span", { klasse: "e-kreis" }, symbol("laptop", 24)), h("b", { text: TE.sicherung.optLokal.t }), h("p", { text: TE.sicherung.nichtVerfuegbar })));
        break;
      default: // „start“: nur Anmelden (Von GitHub holen) oder die Wahl der zwei Wege
        if (Q.nurLogin) {
          k.push(h("div", { klasse: "e-opts" }, h("div", { klasse: "e-opt e-opt-main e-opt-fest" }, h("span", { klasse: "e-tile" }, markenLogo("github", 20, { dekorativ: true })),
            h("div", { klasse: "e-tx" }, h("b", { text: TE.sicherung.anmelden }), h("p", { text: TE.vault.repoPrivat })))), fehler);
          break;
        }
        k.push(optionen(), hinweis(), fehler);
    }
    wurzel.replaceChildren(...k.filter(Boolean));
  }
  let beiFertigSchritt = null; // „Das vorhandene Repository nehmen“ beendet den Schritt: das Overlay hört zu
  zeichne();

  // ---------------------------------------------------------------- Zustand aus der Wirklichkeit: Remote da? GitHub-Konto?
  async function lade({ klonen = false, vault = true } = {}) {
    if (Q.geladen) return;
    Q.geladen = true; Q.sync = "laedt"; zeichne(); aenderung();
    const [konto, bereit] = await Promise.allSettled([api.githubKonto(), vault ? api.sicherungBereit() : Promise.resolve(null)]);
    const kt = konto.status === "fulfilled" ? konto.value : null, br = bereit.status === "fulfilled" ? bereit.value : null;
    Q.login = kt?.login || null;
    Q.repo = Q.repo || repoVorschlag(vaultName() || "vault");
    if (br?.zustand === "gesichert" && !klonen) Q.sync = "gesichert";
    else if (br?.zustand === "blockiert" && !klonen) { Q.sync = "blockiert"; Q.syncText = br.text || TE.sicherung.blockiert; }
    else if (kt && kt.verfuegbar === false) Q.sync = "nichtVerfuegbar";
    else if (kt?.angemeldet) { Q.sync = "ok"; Q.schonRemote = br?.zustand === "gesichert" ? (Q.repoFertig || TE.sicherung.diesenServer) : null; }
    else Q.sync = "start";
    zeichne(); aenderung();
    if (Q.loginWartet && Q.sync === "ok") nachAnmeldung(Q.login);
  }

  // ---------------------------------------------------------------- GitHub-Gerätecode: Code holen, Countdown, Zustand der Werkstatt alle 2 s
  function stoppeCode() { clearInterval(codeTimer); clearTimeout(pollTimer); codeTimer = pollTimer = null; Q.lauf++; }
  async function starteAnmeldung() {
    stoppeCode();
    const lauf = Q.lauf;
    Q.syncFehler = null;
    Q.busy = TE.sicherung.codeHolt; aenderung();
    let r;
    try { r = await api.githubAnmelden(); }
    catch (e) {
      Q.busy = null; Q.sync = "start";
      Q.syncFehler = e?.status === 502 || ausgangUnklar(e) ? TE.sicherung.keinNetz : meldungVon(e);
      zeichne(); aenderung(); return;
    }
    if (lauf !== Q.lauf) return;
    Q.busy = null;
    Q.code = { code: String(r.code), url: String(r.url) };
    const ms = Date.parse(r.ablauf);
    Q.ablaufMs = Number.isFinite(ms) ? ms : Date.now() + 899000;
    Q.sekunden = Math.max(0, Math.round((Q.ablaufMs - Date.now()) / 1000));
    Q.sync = "code";
    zeichne(); aenderung();
    codeTimer = setInterval(() => {
      if (Q.sync !== "code") return clearInterval(codeTimer);
      Q.sekunden = Math.max(0, Math.round((Q.ablaufMs - Date.now()) / 1000));
      const z = $("#zeit"); if (z) z.textContent = zeitText();
      if (Q.sekunden <= 0) { stoppeCode(); Q.sync = "abgelaufen"; zeichne(); aenderung(); }
    }, 1000);
    const frage = async () => {
      if (lauf !== Q.lauf || Q.sync !== "code") return;
      let z = null;
      try { z = await api.githubZustand(); } catch { /* kurz kein Netz: weiter versuchen */ }
      if (lauf !== Q.lauf || Q.sync !== "code") return;
      if (z?.zustand === "fertig") { stoppeCode(); await nachAnmeldung(z.login); return; }
      if (z?.zustand === "abgelaufen") { stoppeCode(); Q.sync = "abgelaufen"; zeichne(); aenderung(); return; }
      if (z?.zustand === "abgelehnt") { stoppeCode(); Q.sync = "abgelehnt"; if (z.grund === "schluesselbund") Q.syncFehler = TE.sicherung.schluesselbund; zeichne(); aenderung(); return; }
      pollTimer = setTimeout(frage, 2000);
    };
    pollTimer = setTimeout(frage, 1500);
  }
  async function nachAnmeldung(login) {
    Q.login = login || Q.login || null;
    Q.sync = "ok"; Q.syncFehler = null;
    let bereit = null; try { bereit = await api.sicherungBereit(); } catch { /* unten */ }
    Q.schonRemote = !Q.nurLogin && bereit?.zustand === "gesichert" ? TE.sicherung.diesenServer : null;
    zeichne(); aenderung();
    toast(TE.sicherung.verbunden);
    if (Q.loginWartet) { const f = Q.loginWartet; Q.loginWartet = null; Q.nurLogin = false; f(true); }
  }
  async function brecheAb() {
    stoppeCode();
    try { await api.githubAbbrechen(); } catch { /* nur das Warten endet */ }
    Q.sync = "start"; Q.syncFehler = null; zeichne(); aenderung();
    if (Q.loginWartet) { const f = Q.loginWartet; Q.loginWartet = null; Q.nurLogin = false; f(false); }
  }
  // Repository anlegen (oder ein vorhandenes nehmen) und den Vault damit verbinden
  async function sichereMit(besitzer, name, neuAnlegen) {
    Q.busy = neuAnlegen ? TE.sicherung.repoLegtAn : TE.sicherung.repoVerbindet; aenderung();
    try {
      let repo = Q.angelegt && Q.angelegt.name === name ? Q.angelegt : null;
      if (neuAnlegen && !repo) { repo = await api.githubRepoAnlegen(name); Q.angelegt = repo; Q.busy = TE.sicherung.repoVerbindet; aenderung(); }
      const b = repo?.besitzer || besitzer;
      await api.sicherungVerbinden(b, repo?.name || name);
      Q.repoFertig = `${b}/${repo?.name || name}`; Q.angelegt = null; Q.syncFehler = null; Q.vergeben = null;
      Q.busy = null; toast(TE.sicherung.gesichertToast); aenderung();
      return true;
    } catch (e) {
      Q.busy = null;
      if (e?.status === 409 && e?.daten?.art === "name") { Q.vergeben = name; Q.syncFehler = TE.sicherung.vergeben(name); }
      else if (e?.status === 409 && e?.daten?.art === "gesichert") { Q.repoFertig = TE.sicherung.diesenServer; Q.syncFehler = null; aenderung(); return true; }
      else if (e?.status === 401 || e?.daten?.art === "anmeldung" || e?.daten?.art === "nicht-angemeldet") { Q.sync = "start"; Q.syncFehler = TE.sicherung.fehlerAnmeldung; }
      else if (e?.status === 502 && e?.daten?.art === "netz") Q.syncFehler = TE.sicherung.keinNetz;
      else Q.syncFehler = meldungVon(e);
      zeichne(); aenderung();
      return false;
    }
  }

  // ---------------------------------------------------------------- Schnittstelle für das Overlay
  /** Hauptknopf: { label, ok, lade, abschluss } — `abschluss` heißt: dieser Druck beendet den Schritt (das Overlay setzt „Einrichtung abschließen“ oder „Weiter“). */
  function primaer() {
    if (Q.sync === "laedt") return { label: TE.weiter, ok: false };
    if (Q.sync === "code") return { label: TE.sicherung.warteKnopf, ok: false, lade: true };
    if (Q.sync === "abgelaufen") return { label: TE.sicherung.abgelaufenKnopf, ok: true };
    if (Q.sync === "abgelehnt") return { label: TE.sicherung.abgelehntKnopf, ok: true };
    if (Q.nurLogin) return Q.sync === "start" ? { label: TE.sicherung.anmelden, ok: true } : Q.sync === "nichtVerfuegbar" ? { label: TE.weiter, ok: false } : { label: TE.weiter, ok: true }; // nicht verfügbar: nichts zu tun, „Zurück“ führt zur Vault-Wahl
    if (Q.sync === "start" && Q.wahl === "github") return { label: TE.sicherung.anmelden, ok: true };
    return { label: TE.weiter, ok: true, abschluss: true };
  }
  /** Der Hauptknopf wurde gedrückt: true = der Schritt ist fertig (weiter); false = es geht in diesem Schritt weiter (Anmeldung läuft, Fehler steht da). */
  async function weiter() {
    const p = primaer();
    if (!p.ok || Q.busy) return false;
    if (Q.sync === "start" && (Q.wahl === "github" || Q.nurLogin)) { await starteAnmeldung(); return false; }
    if (Q.sync === "abgelaufen" || Q.sync === "abgelehnt") { await starteAnmeldung(); return false; }
    if (Q.sync === "ok" && !Q.nurLogin && Q.wahl === "github" && !Q.schonRemote && !Q.repoFertig) {
      const name = Q.repo.trim();
      const f = repoNameFehler(name);
      if (f) { Q.syncFehler = f; zeichne(); return false; }
      return sichereMit(Q.login, name, true);
    }
    return true;
  }
  /** Von GitHub holen scheiterte an der Anmeldung: nur anmelden (ohne Repository), danach löst die Zusage auf. */
  function loginFuerKlon() {
    Q.nurLogin = true;
    return new Promise((fertig) => { Q.loginWartet = fertig; Q.geladen = false; Q.sync = "start"; lade({ klonen: true, vault: false }); });
  }
  const zuruecksetzen = (neuerVault) => { stoppeCode(); Q.geladen = false; Q.sync = "start"; Q.code = null; Q.schonRemote = null; Q.repoFertig = null; Q.angelegt = null; Q.syncFehler = null; Q.vergeben = null; if (neuerVault) Q.repo = ""; Q.nurLogin = false; Q.wahl = "github"; zeichne(); };
  return {
    q: Q, wurzel, lade, primaer, weiter, loginFuerKlon, zuruecksetzen, abbrechenLogin: brecheAb,
    busy: () => Q.busy,
    /** „code“ = die Anmeldung läuft (Kopf: „Mit GitHub verbinden“), sonst die Wahl. */
    ansicht: () => (["code", "abgelaufen", "abgelehnt"].includes(Q.sync) || (Q.nurLogin && Q.sync !== "laedt") ? "login" : "wahl"),
    /** Gewählt „Nur auf diesem Mac“ oder gar nicht möglich: nichts wird verbunden. */
    istLokal: () => Q.wahl === "lokal" || ["nichtVerfuegbar", "blockiert"].includes(Q.sync),
    gesichert: () => !!Q.repoFertig || Q.sync === "gesichert" || !!Q.schonRemote,
    laeuft: () => ["code"].includes(Q.sync),
    abbrechen: () => { if (["code", "abgelaufen", "abgelehnt"].includes(Q.sync)) { stoppeCode(); api.githubAbbrechen().catch(() => {}); Q.sync = "start"; zeichne(); } },
    stoppe() { stoppeCode(); if (Q.sync === "code") api.githubAbbrechen().catch(() => {}); },
    beiFertigSchritt: (f) => { beiFertigSchritt = f; },
  };
}
