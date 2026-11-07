// Schnell erfassen (Electron-Hülle, Paket W2b): die Seite des kleinen Fensters. Verhalten wie ErfassenModell/ErfassenAnsicht der Mac-App: Aufgabe | Notiz, ein Feld, bei Aufgaben Priorität und Fälligkeit
// (erkannt aus dem Text mit denselben Kurzformen wie die Werkstatt; ein Klick auf den Chip wählt von Hand, das × lässt die erkannte Kurzform als Text), ↩ speichert, ⇧↩ neue Zeile, Esc schließt.
// Gespeichert wird im Hauptprozess (window.kortexErfassen); die Seite sieht nur diese Schnittstelle.
import { liesKurzformen, faelligText } from "/s/kurzformen.js";

const H = window.kortexErfassen;
const $ = (id) => document.getElementById(id);
const feld = $("text"), meldung = $("meldung"), speichern = $("speichern");
const S = { art: "aufgabe", prio: null, faellig: "auto", erkennePrio: true, erkenneFaellig: true, hinweis: null, laeuft: false, zustand: "bereit" };
const PRIOS = [null, "niedrig", "normal", "hoch"];
const heute = () => new Date().toISOString().slice(0, 10);
const iso = (tage) => { const d = new Date(); d.setDate(d.getDate() + tage); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const FAELLIG = ["auto", iso(0), iso(1), "woche", "keine"];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const zeigeMeldung = (art, text) => { meldung.dataset.art = art; meldung.textContent = text; };
function zeichneMeldung() {
  if (S.zustand === "speichert") return zeigeMeldung("info", "Speichert …");
  if (S.zustand.startsWith?.("ok:")) return zeigeMeldung("ok", `Gespeichert in „${S.zustand.slice(3)}“`);
  if (S.zustand.startsWith?.("fehler:")) return zeigeMeldung("fehler", S.zustand.slice(7));
  if (S.hinweis) return zeigeMeldung("fehler", S.hinweis);
  zeigeMeldung("info", "↩ speichert · ⇧↩ neue Zeile · esc schließt");
}

function entwurf() { return S.art === "aufgabe" ? liesKurzformen(feld.value.replace(/[\u2028\u2029]/g, "\n"), { heute: heute(), prioritaet: S.erkennePrio, faellig: S.erkenneFaellig }) : null; }
function zeichne() {
  for (const b of document.querySelectorAll(".segment button")) b.setAttribute("aria-checked", String(b.dataset.art === S.art));
  $("aufgabenzeile").hidden = S.art !== "aufgabe";
  $("notizzeile").hidden = S.art !== "notiz";
  feld.placeholder = S.art === "aufgabe" ? "Was willst du nicht vergessen? z. B. „Steuer machen morgen !hoch“" : "Ein Gedanke, eine Idee … landet im Posteingang.";
  const e = entwurf();
  if (e) {
    const prio = S.prio ?? e.prioritaet;
    const p = $("prio"); p.textContent = prio ? `Priorität: ${cap(prio)}` : "Priorität"; p.dataset.aktiv = prio && prio !== "normal" ? "1" : "0";
    $("prio-aus").hidden = !(S.prio === null && e.prioritaetWort);
    const f = S.faellig === "auto" ? e.faellig : S.faellig === "keine" ? null : S.faellig === "woche" ? S.wochenTag : S.faellig;
    const fe = $("faellig"); fe.textContent = f ? `Fällig: ${faelligText(f, heute())}` : "Fällig"; fe.dataset.aktiv = f ? "1" : "0";
    $("faellig-aus").hidden = !(S.faellig === "auto" && e.faelligWort);
  }
  speichern.disabled = !feld.value.replace(/[\u2028\u2029]/g, "\n").trim() || S.laeuft;
  zeichneMeldung();
}
const naechsterMontag = () => liesKurzformen("x nächste Woche", { heute: heute() }).faellig;

async function hole() {
  const i = await H.start();
  S.art = i.art; S.hinweis = i.hinweis; $("vault").textContent = i.vault || "Kein Vault"; $("kuerzel").textContent = i.kuerzel || "";
  if (S.laeuft === false && !S.zustand.startsWith("ok:")) S.zustand = "bereit"; // der Entwurf bleibt stehen (ein Esc darf keinen Gedanken kosten), Meldungen nicht
  zeichne();
}

async function sichere() {
  if (S.laeuft || speichern.disabled) return;
  if (S.hinweis) { S.zustand = `fehler:${S.hinweis}`; return zeichne(); }
  S.laeuft = true; S.zustand = "speichert"; zeichne();
  const faellig = S.faellig === "woche" ? naechsterMontag() ?? "auto" : S.faellig;
  const r = await H.speichern({ art: S.art, text: feld.value, prioritaet: S.prio, faellig, erkennePrioritaet: S.erkennePrio, erkenneFaelligkeit: S.erkenneFaellig }).catch(() => ({ ok: false, text: "Das Speichern hat nicht geklappt." }));
  S.laeuft = false;
  if (!r.ok) { S.zustand = `fehler:${r.text}`; return zeichne(); }
  feld.value = ""; S.prio = null; S.faellig = "auto"; S.erkennePrio = true; S.erkenneFaellig = true;
  S.zustand = `ok:${r.vault}`; zeichne();
  setTimeout(() => { if (S.zustand.startsWith("ok:")) H.schliessen(); }, 900); // hat der Nutzer inzwischen weitergeschrieben, bleibt das Fenster
}

feld.addEventListener("input", () => { if (S.zustand !== "bereit" && S.zustand !== "speichert") S.zustand = "bereit"; zeichne(); });
feld.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sichere(); } });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); H.schliessen(); } });
speichern.addEventListener("click", sichere);
for (const b of document.querySelectorAll(".segment button")) b.addEventListener("click", () => { S.art = b.dataset.art; zeichne(); feld.focus(); });
$("prio").addEventListener("click", () => { S.prio = PRIOS[(PRIOS.indexOf(S.prio) + 1) % PRIOS.length]; zeichne(); feld.focus(); });
$("faellig").addEventListener("click", () => { S.faellig = FAELLIG[(FAELLIG.indexOf(S.faellig) + 1) % FAELLIG.length]; S.wochenTag = naechsterMontag(); zeichne(); feld.focus(); });
$("prio-aus").addEventListener("click", () => { S.erkennePrio = false; zeichne(); feld.focus(); });
$("faellig-aus").addEventListener("click", () => { S.erkenneFaellig = false; zeichne(); feld.focus(); });
H.beiZeigen(() => { hole().then(() => feld.focus()); });
hole().then(() => { feld.focus(); window.__erfassenBereit = true; });
