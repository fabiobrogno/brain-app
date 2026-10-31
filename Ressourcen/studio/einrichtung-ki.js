// Schritt „KI“ des Einrichtungs-Assistenten. Das Verbinden selbst (Wählen · Konto · Stufe · Prüfen · Fertig) ist der gemeinsame Ablauf aus ki-verbinden.js — derselbe wie im Dialog
// der Statusleiste und in den Einstellungen; hier steckt keine eigene Verbindungslogik mehr. Dieses Modul gibt ihm nur den Rahmen des Assistenten: die Fußleiste gehört dem Assistenten
// (fuss: "host": Hauptknopf und Zurück kommen vom Ablauf), die Bühne rechts bekommt ihre kleine Beschreibung (buehne()), und nach dem Verbinden stehen darunter
// „Zusätzlich, wenn du möchtest“ (Hooks bei Claude Code, Prüfung vor dem Speichern, Hintergrunddienst über /api/kern/verdrahten).
import { h } from "./hilfen.js";
import { api } from "./api.js";
import { symbol } from "./symbole.js";
import { kiKatalog, kiLogoName } from "./ki-logos.js";
import { knopf as baueKnopf, umschalter } from "./bausteine.js";
import { erzeugeKiVerbinden } from "./ki-verbinden.js";
import { TE } from "./texte-einrichtung.js";

const meldungVon = (e) => (typeof e?.message === "string" && e.message.trim()) || TE.vault.fehlerStandard;
const name = (id) => kiLogoName(id) || id;

export function erzeugeKi({ vaultPfad, vaultName, beiAenderung, kopiere, melde }) {
  const zusatzEl = h("div", { klasse: "e-zusatz", id: "ki-zusatz", hidden: true });
  const fluss = erzeugeKiVerbinden({ rahmen: "assistent", fuss: "host", lazy: true, vorwahl: false, vaultPfad, vaultName, kopiere, melde,
    beiAenderung: () => { zeichneZusatz(); beiAenderung(); } });
  const z = fluss.z; // z.geladen, z.ki[id].stufe, z.pflege, z.konten … (der Fertig-Schritt und die Bühne lesen es)
  z.zusatz = null; z.zusatzFehler = {}; z.zusatzFrage = null; z.zusatzBusy = null;
  const wurzel = h("div", { klasse: "e-ki-wurzel", id: "ki-koerper" }, fluss.el, zusatzEl);
  let zusatzGeladen = false;
  const gefunden = (id) => z.erkennung[id]?.gefunden === true;
  const gewaehlt = () => (z.prog ? [z.prog] : []);

  // Fertig-Text ehrlich: läuft die Pflege wirklich im Hintergrunddienst für diesen Vault (dienst.fuerVault), oder erst beim nächsten Sitzungsstart?
  async function ladePflege() {
    if (!z.pflege || !vaultPfad()) return;
    try { const r = await api.kiPflege(vaultPfad()); z.pflege.imDienst = r?.dienst?.fuerVault === true; } catch { z.pflege.imDienst = false; }
  }

  // ---------------------------------------------------------------- Zusätzlich, wenn du möchtest (Hooks, Prüfung, Hintergrunddienst): nur nach dem Verbinden
  async function ladeZusatz() {
    if (zusatzGeladen || !vaultPfad() || !z.geladen) return;
    zusatzGeladen = true;
    try { z.zusatz = await api.kernStand(); } catch { z.zusatz = null; }
    zeichneZusatz();
  }
  const claudeProfil = () => {
    const profile = Array.isArray(z.zusatz?.profile) ? z.zusatz.profile : [];
    if (!profile.length) return null;
    const k = z.ki.claude, konto = k && z.konten.find((c) => c.id === k.konto);
    const norm = (p) => String(p || "").replace(/^~/, "").replace(/\/+$/, "");
    return (konto && profile.find((p) => norm(p.pfad).endsWith(norm(konto.ordner)) && norm(konto.ordner))) || profile.find((p) => p.standard) || profile[0];
  };
  function zusatzZeile(was, titel, text, aktiv, schalten) {
    const fehler = z.zusatzFehler[was];
    const schalter = umschalter({ an: aktiv, label: titel, daten: { "data-aktion": `zusatz-${was}` }, aufAenderung: async (w) => {
      if (z.zusatzBusy) { schalter.an = aktiv; return; }
      z.zusatzBusy = was; z.zusatzFehler[was] = null; z.zusatzFrage = null; zeichneZusatz();
      try { const r = await schalten(w, false); if (r?.stand) z.zusatz = r.stand; }
      catch (e) {
        if (was === "git" && w && e?.status === 409 && e?.daten?.art === "anders") z.zusatzFrage = "git";
        else z.zusatzFehler[was] = meldungVon(e);
      }
      z.zusatzBusy = null; zeichneZusatz();
    } });
    return h("div", { klasse: "e-schalt-zeile e-zusatz-zeile", "data-zusatz": was },
      h("div", null, h("b", { text: titel }), h("span", { text }),
        z.zusatzBusy === was ? h("span", { klasse: "e-hint e-shimmer", text: TE.ki.zusatzArbeit }) : null,
        fehler ? h("span", { klasse: "e-meldung schlecht", role: "alert" }, symbol("warnung", 14), h("span", { text: fehler })) : null,
        was === "git" && z.zusatzFrage === "git" ? h("span", { klasse: "e-frage", role: "group", "data-bereich": "git-ersetzen" }, h("span", { klasse: "e-hint", text: TE.ki.zusatzGitErsetzen }),
          h("span", { klasse: "e-frage-knoepfe" },
            baueKnopf({ text: TE.ki.nichtAendern, groesse: "s", aktion: "git-nicht-ersetzen", aufKlick: () => { z.zusatzFrage = null; zeichneZusatz(); } }),
            baueKnopf({ text: TE.ki.zusatzErsetzen, variante: "primaer", groesse: "s", aktion: "git-ersetzen", aufKlick: async () => {
              z.zusatzBusy = "git"; z.zusatzFrage = null; zeichneZusatz();
              try { const r = await schalten(true, true); if (r?.stand) z.zusatz = r.stand; } catch (e) { z.zusatzFehler.git = meldungVon(e); }
              z.zusatzBusy = null; zeichneZusatz();
            } }))) : null),
      schalter);
  }
  function zeichneZusatz() {
    // erst wenn eine KI verbunden ist (Schritt „Fertig“ des Ablaufs); davor stört es die Wahl
    if (fluss.schritt() !== "fertig") { zusatzEl.hidden = true; return; }
    ladeZusatz();
    const s = z.zusatz;
    const zeilenListe = [];
    const claudeDa = z.verbunden.some((v) => v.id === "claude") || gefunden("claude");
    const profil = claudeProfil();
    if (s && claudeDa && profil) {
      zeilenListe.push(zusatzZeile("claude", TE.ki.zusatz.claude.titel, TE.ki.zusatz.claude.text, s.claude?.profile?.[profil.pfad]?.aktiv === true,
        (an) => api.kernVerdrahten({ was: "claude", an, profile: [profil.pfad] })));
    }
    if (s?.git && s.git.moeglich === true && !s.git.fehler) {
      zeilenListe.push(zusatzZeile("git", TE.ki.zusatz.git.titel, TE.ki.zusatz.git.text, s.git.aktiv === true, (an, ersetzen) => api.kernVerdrahten({ was: "git", an, ...(ersetzen ? { ersetzen: true } : {}) })));
    }
    if (s?.dienst?.verfuegbar === true) {
      zeilenListe.push(zusatzZeile("dienst", TE.ki.zusatz.dienst.titel, TE.ki.zusatz.dienst.text, s.dienst.eingerichtet === true, (an) => api.kernVerdrahten({ was: "dienst", an })));
    }
    zusatzEl.hidden = !zeilenListe.length;
    zusatzEl.replaceChildren(...(zeilenListe.length ? [h("div", { klasse: "e-abschnitt-kopf" }, TE.ki.zusatz.kopf), ...zeilenListe] : []));
  }

  return {
    z, wurzel, fluss,
    lade: (neu) => { zusatzGeladen = false; return fluss.lade(neu); },
    verbundene: () => fluss.verbundene(),
    vaultGewechselt() { z.zusatz = null; z.zusatzFehler = {}; z.zusatzFrage = null; zusatzGeladen = false; fluss.vaultGewechselt(); },
    ladePflege,
    // Fußleiste: der Assistent zeigt den Hauptknopf selbst, der Ablauf sagt, was draufsteht und ob er gilt
    fuss: () => fluss.fuss(),
    primaerTun: () => fluss.primaerTun(),   // true = der Assistent geht selbst weiter (Schritt „Fertig“ oder „Ohne KI weiter“)
    zurueckTun: () => fluss.zurueckTun(),   // true = der Ablauf ist einen Schritt zurück; false = der Assistent geht zum vorigen Schritt
    // Ansicht für die Bühne: gefundene, gewählte und verbundene KIs, höchstens vier
    buehne() {
      const verb = new Set([...z.verbunden.map((v) => v.id), ...z.konten.filter((k) => k.verbunden).map((k) => k.programm)]);
      const ids = [...new Set([...kiKatalog().filter((e) => e.verbindbar && gefunden(e.id)).map((e) => e.id), ...gewaehlt(), ...z.verbunden.map((v) => v.id)])].slice(0, 4);
      return {
        modus: `${z.geladen}:${ids.join(",")}:${[...verb].join(",")}:${z.prog || ""}`,
        programme: ids.map((id) => ({ id, name: name(id), an: id === z.prog || z.verbunden.some((v) => v.id === id), stufeName: TE.ki.stufen[z.ki[id]?.stufe || (id === z.prog ? z.stufe : "posteingang")].name })),
        keine: z.geladen && !Object.values(z.erkennung).some((x) => x.gefunden),
      };
    },
  };
}
