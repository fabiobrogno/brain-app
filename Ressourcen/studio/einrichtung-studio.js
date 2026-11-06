// Die Einrichtung als Teil des Studios: öffnen (Overlay `#einrichtung-host`, nie ein zweites Fenster), das Ende (der Vault wird IN DER SEITE geladen, das Zeichen
// schrumpft in die Seitenleiste) und die Hinweise der App beim Start (Banner statt eines Systemdialogs). app.js bindet das an Menübefehle und Knöpfe.
import { api, aktion, mitHuelle } from "./api.js";
import { h, toast } from "./hilfen.js";
import { knopf as baueKnopf, wenigBewegung } from "./bausteine.js";
import { symbol } from "./symbole.js";
import { TE } from "./texte-einrichtung.js";

const FLUG_MS = 280; // das Zeichen wandert in die Seitenleiste (bei reduzierter Bewegung gar nicht)

/**
 * @param {{ vault: () => (string|null), vorOeffnen: () => Promise<boolean>, ladeNeu: () => Promise<void>, aufgefrischt: () => void, vertrauenErledigt?: (pfad: string) => void, beiEnde?: (e: object) => void }} p
 *   vault: aktiver Vault des Studios · vorOeffnen: offene Eingaben sichern (false = nicht öffnen; ein neuer Vault in der Einrichtung dürfte sie sonst in den falschen Ordner schreiben)
 *   · ladeNeu: den (neuen) Vault in der Seite laden (`ladeAlles`) · aufgefrischt: Stand von KI und Sicherung neu lesen, wenn der Vault gleich blieb
 *   · vertrauenErledigt(pfad): die Frage „Diesem Ordner vertrauen“ war im Vault-Schritt gestellt (egal wie beantwortet): das Studio fragt danach nicht noch einmal
 *   · beiEnde: nach jedem Ende (Checkliste in der Seitenleiste neu lesen)
 */
export function erzeugeEinrichtungImStudio({ vault, vorOeffnen, ladeNeu, aufgefrischt, vertrauenErledigt, beiEnde }) {
  // Jede neu geladene Seite meldet der Hülle „kein Overlay offen“: ein Neuladen (Absturz, Entwicklung) lässt die Rechte der Einrichtung nie offen stehen. Das passiert vor dem Befehl
  // `einrichtung`, der erst nach `window.studio.bereit` ausgeführt wird; ein schon angeforderter Lauf bleibt dadurch unberührt (siehe EinrichtungsSitzung.seiteMeldetZu).
  if (mitHuelle()) aktion("einrichtung-sitzung", { offen: false });

  // Das Overlay selbst öffnen. Aufrufer ist der Befehl der App (`window.studio.befehl('einrichtung', { ab, weg })`), nie die Seite von sich aus: die App führt Buch darüber,
  // ob die Einrichtung offen ist (nur dann gelten git, Zwischenablage und Ende), darum geht jeder Weg über `anfordern`.
  async function oeffne({ ab = null, weg = null } = {}) {
    let modul;
    if (!(await vorOeffnen())) return null;
    try { modul = await import("./einrichtung.js"); }
    catch { toast(TE.nichtDa, { fehler: true }); return null; }
    return modul.oeffneEinrichtung({ ab, weg, beiEnde: nachEinrichtung });
  }

  // Knopf, Karte und Seitenleiste bitten die App darum (sie öffnet das Overlay im selben Fenster); im Browser ohne App öffnet die Seite es selbst.
  function anfordern({ ab, weg } = {}) {
    const wert = { ...(ab ? { ab } : {}), ...(weg ? { weg } : {}) };
    if (mitHuelle() && aktion("einrichtung-oeffnen", Object.keys(wert).length ? wert : undefined)) return;
    oeffne({ ab, weg });
  }

  async function nachEinrichtung({ art, zeichen, vertrauenFuer }) {
    if (vertrauenFuer) { try { vertrauenErledigt?.(vertrauenFuer); } catch (e) { console.error(e); } }
    let neu = null;
    try { neu = await api.info(); } catch { /* der Stand bleibt, wie er war */ }
    const gewechselt = !!neu && (neu.vault || null) !== (vault() || null);
    if (gewechselt) { aktion("vault-gewechselt"); await ladeNeu(); } else aufgefrischt();
    if (art === "fertig" && vault()) { fliegeInSeitenleiste(zeichen); toast(TE.ende.bereit); }
    try { beiEnde?.({ art }); } catch (e) { console.error(e); }
  }

  // Das Zeichen der Bühne wandert (transform, 280 ms) auf das Zeichen des Vaults in der Seitenleiste; dort bleibt dieses bis zur Ankunft unsichtbar.
  function fliegeInSeitenleiste(zeichen) {
    const ziel = document.getElementById("vault-farbe");
    if (!zeichen?.el || !ziel || wenigBewegung()) return;
    const von = zeichen.rect, nach = ziel.getBoundingClientRect();
    if (!von.width || !nach.width) return;
    const el = zeichen.el;
    el.removeAttribute("id");
    el.querySelectorAll(".zeichnen").forEach((n) => n.classList.remove("zeichnen"));
    el.classList.add("e-flug");
    Object.assign(el.style, { left: `${von.left}px`, top: `${von.top}px`, width: `${von.width}px`, height: `${von.height}px`, transitionDuration: `${FLUG_MS}ms` });
    document.body.append(el);
    ziel.style.visibility = "hidden";
    const fertig = () => { el.remove(); ziel.style.visibility = ""; };
    el.addEventListener("transitionend", fertig, { once: true });
    setTimeout(fertig, FLUG_MS + 250); // falls das Ende der Bewegung nie gemeldet wird (Fenster verdeckt)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transform = `translate(${nach.left - von.left}px, ${nach.top - von.top}px) scale(${nach.width / von.width}, ${nach.height / von.height})`;
    }));
  }

  // Hinweise der App beim Start (Ordner „Brain“ umbenannt, Laufzeit unvollständig …): ein Banner oben, auch vor der Einrichtung sichtbar, statt eines Systemdialogs.
  function zeigeHinweis({ titel, text } = {}) {
    const host = document.getElementById("hinweis-host");
    if (!host || typeof text !== "string" || !text) return;
    const zu = baueKnopf({ text: TE.hinweis.ok, groesse: "s", aktion: "hinweis-ok" });
    const el = h("div", { klasse: "start-hinweis", role: "alert", "data-hinweis": "start" }, symbol("warnung", 16),
      h("div", { klasse: "start-hinweis-text" }, typeof titel === "string" && titel ? h("b", { text: titel }) : null, h("p", { text })), zu);
    zu.addEventListener("click", () => el.remove());
    host.append(el);
    return el;
  }

  return { oeffne, anfordern, zeigeHinweis };
}
