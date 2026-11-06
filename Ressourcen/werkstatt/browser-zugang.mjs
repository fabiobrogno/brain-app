// werkstatt/browser-zugang.mjs — Zugangsschutz für „Kortex im Browser“ (Paket W1). Reine Logik ohne Netzwerk, damit sie sich einzeln testen lässt.
//   · Geheimnis (`geheimnis`): zufällig je Start, steht nur in der Sperrdatei im Support-Ordner (nur für den Benutzer lesbar) und dient allein dazu, Einlass-Karten auszustellen.
//   · Einlass-Karte (Ticket): zufällig, einmal einlösbar, 2 Minuten gültig; kommt als `/?t=<karte>` in die Adresse, die der Browser öffnet. Eine verratene Adresse (Verlauf, Prozessliste) ist danach wertlos.
//   · Sitzung: zufällige Kennung im Cookie `kortex_s_<port>` (HttpOnly, SameSite=Strict, Path=/); nur ihr SHA-256 liegt im Speicher. Der Port steckt im Namen, denn Cookies sind nicht an Ports gebunden.
//   · Prüfungen je Anfrage: Host (DNS-Rebinding), Sec-Fetch-Site, Origin, Methode, bei schreibenden Anfragen zwingend ein passender Origin. Kein CORS.
// Nichts davon wird je protokolliert.
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

const sha = (t) => createHash("sha256").update(String(t)).digest();
const hex = (t) => sha(t).toString("hex");
export const KARTE_MS = 120_000;
export const MAX_KARTEN = 20;
export const MAX_SITZUNGEN = 50;
export const SICHER = new Set(["GET", "HEAD"]);
export const ERLAUBT = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);

export function erzeugeZugang({ port, jetzt = Date.now } = {}) {
  const geheimnis = randomBytes(32).toString("base64url");
  const cookieName = () => `kortex_s_${port()}`;
  const karten = new Map(); // sha(karte) → Ablauf
  const sitzungen = new Set(); // sha-hex der Sitzungskennungen

  const geheimnisStimmt = (angebot) => typeof angebot === "string" && angebot.length > 0 && timingSafeEqual(sha(angebot), sha(geheimnis));
  function neueKarte() {
    for (const [k, bis] of karten) if (bis <= jetzt()) karten.delete(k);
    if (karten.size >= MAX_KARTEN) karten.delete(karten.keys().next().value);
    const karte = randomBytes(24).toString("base64url");
    karten.set(hex(karte), jetzt() + KARTE_MS);
    return karte;
  }
  // Löst eine Karte ein (einmal) und gibt die neue Sitzungskennung zurück, sonst null.
  function loeseEin(karte) {
    if (typeof karte !== "string" || !karte || karte.length > 200) return null;
    const k = hex(karte), bis = karten.get(k);
    karten.delete(k);
    if (bis === undefined || bis <= jetzt()) return null;
    const sitzung = randomBytes(32).toString("base64url");
    if (sitzungen.size >= MAX_SITZUNGEN) sitzungen.delete(sitzungen.values().next().value);
    sitzungen.add(hex(sitzung));
    return sitzung;
  }
  const cookieWert = (kopf) => {
    for (const teil of String(kopf || "").split(";")) {
      const i = teil.indexOf("="); if (i < 0) continue;
      if (teil.slice(0, i).trim() === cookieName()) return teil.slice(i + 1).trim();
    }
    return null;
  };
  const hatSitzung = (cookieKopf) => { const w = cookieWert(cookieKopf); return !!w && sitzungen.has(hex(w)); };
  const setzeCookie = (sitzung) => `${cookieName()}=${sitzung}; HttpOnly; SameSite=Strict; Path=/`;
  const bearer = (kopf) => { const m = /^Bearer ([\w-]+)$/.exec(String(kopf || "")); return m ? m[1] : null; };
  return { geheimnisStimmt, neueKarte, loeseEin, hatSitzung, setzeCookie, bearer, cookieName, geheimnis: () => geheimnis, anzahlSitzungen: () => sitzungen.size };
}

// Die eigene Herkunft: genau diese beiden Schreibweisen (kein anderer Host, kein anderer Port).
export const hostErlaubt = (host, port) => host === `127.0.0.1:${port}` || host === `localhost:${port}`;
export const herkunftErlaubt = (origin, port) => origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;

// Gemeinsame Vorprüfung jeder Anfrage → null (weiter) oder { status, text }.
export function pruefeAnfrage({ methode, kopf, port }) {
  if (!hostErlaubt(String(kopf.host || ""), port)) return { status: 403, text: "Host nicht erlaubt" }; // gegen DNS-Rebinding
  if (!ERLAUBT.has(methode)) return { status: 405, text: "Methode nicht erlaubt" }; // auch OPTIONS: es gibt kein CORS
  const sfs = kopf["sec-fetch-site"];
  if (sfs !== undefined && sfs !== "same-origin" && sfs !== "none") return { status: 403, text: "Herkunft nicht erlaubt" }; // „same-site“ (anderer lokaler Port) zählt nicht
  const origin = kopf.origin;
  if (origin !== undefined && !herkunftErlaubt(origin, port)) return { status: 403, text: "Herkunft nicht erlaubt" };
  if (!SICHER.has(methode) && origin === undefined) return { status: 403, text: "Herkunft fehlt" }; // schreibend nur mit eigenem Origin (Browser schicken ihn immer mit)
  return null;
}
