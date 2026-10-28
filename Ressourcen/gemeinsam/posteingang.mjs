// gemeinsam/posteingang.mjs — Posteingang sichten (FBL-68/FBL-71): Verwerfen, Später, in eine Wiki-Seite übernehmen.
// Jede Aktion ist EIN Git-Commit über genau die berührten Dateien. Nichts wird gelöscht: Verwerfen und Übernehmen verschieben die Notiz
// unverändert nach 90_archiv/ (dort zählt sie als Archiv, der Verlauf bleibt in Git), Später schreibt nur ein Datum in den Kopf der Notiz
// (`spaeter_bis`). Schlägt etwas fehl — auch erst der Commit —, wird alles zurückgenommen und der Fehler kommt zur Oberfläche.
// Vor jeder Änderung wird geprüft, ob Git gesperrt ist (409), damit dann gar nichts angefasst wird. Keine Abhängigkeiten außer den Nachbarn.
import { existsSync, lstatSync, mkdirSync, linkSync, unlinkSync, rmdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { HttpFehler, loese, BEARBEITBAR, MAX_DATEI } from "./basis.mjs";
import { leseKopf, istDatum, plusTage } from "./pruefung.mjs";

export const ARCHIV_VERWORFEN = "90_archiv/verworfen";
export const ARCHIV_UEBERNOMMEN = "90_archiv/uebernommen";
export const SPAETER_FELD = "spaeter_bis";
const MAX_TAGE = 366;

// ---------- Kopf (Frontmatter) zeilengenau ändern ----------
// Setzt `schluessel: wert` im Kopf (legt ihn an, wenn es keinen gibt) oder entfernt die Zeile (wert === null). Der Rest der Datei bleibt
// bytegleich, auch die Zeilenenden. Gibt den neuen Text zurück (derselbe Text, wenn nichts zu tun war).
export function setzeKopfFeld(text, schluessel, wert) {
  if (text.startsWith("\uFEFF")) return "\uFEFF" + setzeKopfFeld(text.slice(1), schluessel, wert); // BOM bleibt ganz vorn
  const zeilen = text.split("\n"); // ein \r bleibt am Zeilenende stehen
  const crlf = zeilen[0].endsWith("\r");
  const eol = crlf ? "\r\n" : "\n";
  const { bis } = leseKopf(text);
  const gleich = new RegExp(`^${schluessel}\\s*:`);
  if (!bis) {
    if (wert === null) return text;
    if (/^---/.test(text)) throw new HttpFehler(422, "Der Kopf dieser Notiz ist nicht lesbar (beginnt mit „---“, ist aber nicht geschlossen). Es wurde nichts geändert.");
    return `---${eol}${schluessel}: ${wert}${eol}---${eol}${text}`;
  }
  const kopf = zeilen.slice(0, bis), rest = zeilen.slice(bis);
  // alle Zeilen mit diesem Schlüssel (leseKopf nimmt den letzten Wert, also dürfen keine alten übrig bleiben)
  const treffer = kopf.map((z, n) => (n > 0 && n < bis - 1 && gleich.test(z) ? n : -1)).filter((n) => n >= 0);
  const neu = `${schluessel}: ${wert}${crlf ? "\r" : ""}`;
  if (wert === null) {
    if (!treffer.length) return text;
    for (const n of treffer.reverse()) kopf.splice(n, 1);
    if (kopf.length === 2) return rest.join("\n"); // der Kopf bestand nur aus diesem Feld → ganz weg
  } else if (treffer.length) {
    if (treffer.length === 1 && kopf[treffer[0]] === neu) return text;
    kopf[treffer[0]] = neu;
    for (const n of treffer.slice(1).reverse()) kopf.splice(n, 1);
  } else kopf.splice(bis - 1, 0, neu);
  return [...kopf, ...rest].join("\n");
}

// Text einer Notiz ohne Kopf und ohne ihre erste Überschrift (die wird zur Überschrift des Abschnitts), Zeilenenden als \n.
export function koerperVon(text) {
  const { bis } = leseKopf(text);
  const zeilen = text.split(/\r?\n/).slice(bis);
  while (zeilen.length && !zeilen[0].trim()) zeilen.shift();
  if (zeilen.length && /^#\s+\S/.test(zeilen[0])) zeilen.shift();
  while (zeilen.length && !zeilen[0].trim()) zeilen.shift();
  while (zeilen.length && !zeilen[zeilen.length - 1].trim()) zeilen.pop();
  return zeilen.join("\n");
}

const einzeilig = (s, max = 80) => String(s).replace(/\s+/g, " ").trim().slice(0, max);

// deps: { wurzel, heute(), notizen() (async, Notiz-Index), lies(rel), schreibe({pfad,inhalt,basisHash}), istGeneriert(rel,abs), slug(s,max),
//         git: { vorab() → ist Repo (wirft 409, wenn gesperrt), offen() → Pfade mit Änderungen, commit({nachricht,dateien}) → {sha} } }
export function erzeugePosteingang(deps) {
  const { wurzel } = deps;

  // Aktionen laufen nacheinander: zwei Klicks auf dieselbe Karte dürfen sich nicht überholen.
  let kette = Promise.resolve();
  const seriell = (fn) => { const lauf = kette.then(fn); kette = lauf.catch(() => {}); return lauf; };

  // Die Notiz muss es geben, im Posteingang liegen und unverändert verschiebbar/schreibbar sein.
  async function pruefeNotiz(pfad) {
    const { abs, rel } = loese(wurzel, pfad);
    if (!BEARBEITBAR.test(rel)) throw new HttpFehler(415, "Nur Markdown- und Textdateien lassen sich bearbeiten.");
    let st;
    try { st = lstatSync(abs); } catch { throw new HttpFehler(404, "Diese Notiz gibt es nicht (mehr)."); }
    if (st.isSymbolicLink() || !st.isFile()) throw new HttpFehler(400, "Das ist keine gewöhnliche Datei.");
    if (st.nlink > 1) throw new HttpFehler(423, "Diese Datei ist mehrfach verknüpft (derselbe Inhalt liegt unter einem zweiten Namen) und wird hier nicht verschoben.");
    if (deps.istGeneriert(rel, abs)) throw new HttpFehler(403, "Diese Datei wird automatisch erzeugt und ist schreibgeschützt.");
    const eintrag = (await deps.notizen()).notizen.find((n) => n.pfad === rel);
    if (!eintrag) throw new HttpFehler(404, "Diese Notiz gibt es nicht (mehr).");
    if (eintrag.bereich !== "inbox") throw new HttpFehler(409, "Diese Notiz liegt nicht (mehr) im Posteingang.", { art: "nicht-im-posteingang" });
    const d = deps.lies(rel);
    return { rel, abs, titel: einzeilig(eintrag.titel || rel.split("/").pop().replace(/\.[^.]+$/, "")), text: d.inhalt, hash: d.hash };
  }

  // Verschiebt die Datei exklusiv in den Ordner (frei gewählter Name: name.md, name-2.md …), ohne je etwas zu überschreiben.
  function verschiebe(n, ordnerRel) {
    const ordner = loese(wurzel, ordnerRel);
    mkdirSync(ordner.abs, { recursive: true });
    const name = n.rel.split("/").pop();
    const punkt = name.lastIndexOf(".");
    const stamm = punkt > 0 ? name.slice(0, punkt) : name, endung = punkt > 0 ? name.slice(punkt) : "";
    for (let i = 1; i < 1000; i++) {
      const ziel = join(ordner.abs, `${stamm}${i === 1 ? "" : "-" + i}${endung}`);
      try { linkSync(n.abs, ziel); }
      catch (e) { if (e.code === "EEXIST") continue; throw e; }
      try { unlinkSync(n.abs); }
      catch (e) { try { unlinkSync(ziel); } catch { /* bleibt als Kopie liegen: nichts geht verloren */ } throw e; }
      return `${ordnerRel}/${ziel.slice(ordner.abs.length + 1)}`;
    }
    throw new HttpFehler(409, "Im Archiv liegen schon zu viele Dateien mit diesem Namen.");
  }
  const zurueckVerschieben = (n, zielRel) => {
    const ziel = loese(wurzel, zielRel).abs;
    linkSync(ziel, n.abs); // EEXIST = der alte Pfad wurde inzwischen neu belegt → Fehler, nichts wird überschrieben
    unlinkSync(ziel);
    // die für das Archiv angelegten Ordner wieder entfernen, soweit sie leer sind (rmdir lässt volle Ordner stehen)
    for (let o = dirname(ziel); o.length > wurzel.length && o.startsWith(join(wurzel, "90_archiv")); o = dirname(o)) { try { rmdirSync(o); } catch { break; } }
  };

  // Ein Commit über genau diese Pfade. Ohne Git-Repository gibt es keinen (git:false); die Änderung bleibt dann nur auf der Platte.
  // Eine Änderung, die Git nicht sieht (z. B. weil der Zielordner in .gitignore steht), wird NICHT stillschweigend hingenommen.
  async function festhalten(repo, nachricht, pfade, pflicht) {
    if (!repo) return { sha: null, git: false };
    const offen = new Set(await deps.git.offen());
    const dateien = [...new Set(pfade)].filter((p) => offen.has(p));
    for (const p of pflicht) {
      if (!offen.has(p)) throw new HttpFehler(422, `Git sieht „${p}“ nicht (steht der Ordner in .gitignore?). Es wurde nichts geändert.`, { art: "git-ignoriert" });
    }
    if (!dateien.length) throw new HttpFehler(422, "Git sieht keine Änderung (steht der Ordner in .gitignore?). Es wurde nichts geändert.", { art: "git-ignoriert" });
    const r = await deps.git.commit({ nachricht, dateien });
    return { sha: r.sha, git: true };
  }

  // Führt `tun` aus; bei jedem Fehler werden die zuvor registrierten Rückwege in umgekehrter Reihenfolge gegangen.
  async function atomar(tun) {
    const rueck = [];
    try { return await tun((f) => rueck.push(f)); }
    catch (e) {
      const offen = [];
      for (const f of rueck.reverse()) { try { await f(); } catch (e2) { offen.push(e2 && e2.message ? e2.message : String(e2)); } }
      if (offen.length && e instanceof HttpFehler) {
        throw new HttpFehler(e.status, `${e.message} Das Zurücknehmen ist nicht ganz gelungen (${offen.join("; ")}). Es ist nichts gelöscht — bitte den Ordner prüfen.`, { ...e.extra, art: "rueckweg" });
      }
      throw e;
    }
  }

  const bereit = async () => Boolean(await deps.git.vorab());

  // ---------- Verwerfen ----------
  function verwerfen({ pfad } = {}) {
    return seriell(async () => {
      const repo = await bereit();
      const n = await pruefeNotiz(pfad);
      return atomar(async (merke) => {
        const ziel = verschiebe(n, ARCHIV_VERWORFEN);
        merke(() => zurueckVerschieben(n, ziel));
        const c = await festhalten(repo, `Posteingang: „${n.titel}“ verworfen`, [n.rel, ziel], [ziel]);
        return { pfad: n.rel, ziel, commit: c.sha, git: c.git };
      });
    });
  }

  // ---------- Später ----------
  // { pfad, bis: "JJJJ-MM-TT" | null } oder { pfad, tage: 1…366 }; bis null = wieder im Posteingang zeigen.
  function spaeter({ pfad, bis, tage } = {}) {
    return seriell(async () => {
      const heute = deps.heute();
      let datum;
      if (tage !== undefined && tage !== null) {
        if (!Number.isInteger(tage) || tage < 1 || tage > MAX_TAGE) throw new HttpFehler(400, `„tage“ muss eine ganze Zahl von 1 bis ${MAX_TAGE} sein.`);
        datum = plusTage(heute, tage);
      } else if (bis === null) datum = null;
      else if (typeof bis === "string" && istDatum(bis)) {
        if (bis <= heute) throw new HttpFehler(400, "Das Datum muss in der Zukunft liegen.");
        if (bis > plusTage(heute, MAX_TAGE)) throw new HttpFehler(400, "Das Datum liegt mehr als ein Jahr in der Zukunft.");
        datum = bis;
      } else throw new HttpFehler(400, "Bitte ein Datum (JJJJ-MM-TT) oder eine Zahl von Tagen angeben — oder „bis“: null, um die Notiz wieder zu zeigen.");
      const repo = await bereit();
      const n = await pruefeNotiz(pfad);
      const neuerText = setzeKopfFeld(n.text, SPAETER_FELD, datum);
      if (neuerText === n.text) return { pfad: n.rel, bis: datum, commit: null, git: repo, unveraendert: true };
      return atomar(async (merke) => {
        const s = deps.schreibe({ pfad: n.rel, inhalt: neuerText, basisHash: n.hash });
        merke(() => deps.schreibe({ pfad: n.rel, inhalt: n.text, basisHash: s.hash }));
        const nachricht = datum ? `Posteingang: „${n.titel}“ zurückgestellt bis ${datum}` : `Posteingang: „${n.titel}“ wieder im Posteingang`;
        const c = await festhalten(repo, nachricht, [n.rel], [n.rel]);
        return { pfad: n.rel, bis: datum, commit: c.sha, git: c.git };
      });
    });
  }

  // ---------- In eine Wiki-Seite übernehmen ----------
  // ziel: { seite: "09_wiki/…/x.md" } hängt einen Abschnitt an eine bestehende Seite an,
  //       { neu: { titel, bereich? } } legt 09_wiki/<bereich>/thema_<slug>.md an (bereich = ein Ordnername, Standard „wissen“).
  function uebernehmen({ pfad, ziel } = {}) {
    return seriell(async () => {
      if (!ziel || typeof ziel !== "object" || Array.isArray(ziel) || (typeof ziel.seite !== "string") === (ziel.neu === undefined)) {
        throw new HttpFehler(400, "Bitte genau eine Zielseite wählen: eine vorhandene Seite oder eine neue.");
      }
      const repo = await bereit();
      const n = await pruefeNotiz(pfad);
      const heute = deps.heute();
      const koerper = koerperVon(n.text) || n.titel;

      // Zielseite bestimmen und prüfen, bevor etwas geschrieben wird
      let seite, alt = null, neuText;
      if (typeof ziel.seite === "string") {
        const { abs, rel } = loese(wurzel, ziel.seite);
        if (!rel.startsWith("09_wiki/")) throw new HttpFehler(400, "Das Ziel muss eine Seite im Wiki (09_wiki/) sein.");
        if (!BEARBEITBAR.test(rel) || deps.istGeneriert(rel, abs) || /(^|\/)belege\//.test(rel) || rel.split("/").pop().startsWith("_")) {
          throw new HttpFehler(403, "In diese Seite lässt sich nichts übernehmen (generiert, Beleg oder Verwaltungsdatei).");
        }
        try { alt = deps.lies(rel); } catch (e) { throw e instanceof HttpFehler && e.status === 404 ? new HttpFehler(404, "Die Zielseite gibt es nicht (mehr).") : e; }
        if (alt.schreibschutz) throw new HttpFehler(403, "Die Zielseite ist schreibgeschützt.");
        seite = rel;
      } else {
        const neu = ziel.neu;
        if (!neu || typeof neu !== "object" || typeof neu.titel !== "string" || !neu.titel.trim()) throw new HttpFehler(400, "Bitte einen Titel für die neue Seite angeben.");
        const bereich = neu.bereich === undefined || neu.bereich === null || neu.bereich === "" ? "wissen" : neu.bereich;
        if (typeof bereich !== "string" || /[\\/]/.test(bereich) || bereich.startsWith(".") || bereich.startsWith("_") || bereich.toLowerCase() === "belege") {
          throw new HttpFehler(400, "Der Bereich muss ein einzelner Ordnername im Wiki sein.");
        }
        const stamm = `thema_${deps.slug(neu.titel, 60)}`;
        const ordnerRel = loese(wurzel, `09_wiki/${bereich}`).rel;
        let frei = null;
        for (let i = 1; i < 1000 && !frei; i++) {
          const kandidat = `${ordnerRel}/${stamm}${i === 1 ? "" : "-" + i}.md`;
          if (!existsSync(loese(wurzel, kandidat).abs)) frei = kandidat;
        }
        if (!frei) throw new HttpFehler(409, "Es gibt schon zu viele Seiten mit diesem Namen.");
        seite = frei;
      }

      return atomar(async (merke) => {
        const archiv = verschiebe(n, ARCHIV_UEBERNOMMEN);
        merke(() => zurueckVerschieben(n, archiv));
        // Die Notiz darf sich seit dem Lesen nicht geändert haben, sonst stünde im Wiki ein anderer Text als im Archiv
        if (deps.lies(archiv).hash !== n.hash) throw new HttpFehler(409, "Die Notiz wurde inzwischen geändert. Es wurde nichts übernommen — bitte noch einmal versuchen.");
        const herkunft = `_Übernommen aus dem Posteingang am ${heute} (Notiz: \`${archiv}\`)._`;
        if (alt) {
          const crlf = alt.inhalt.includes("\r\n");
          let basis = alt.inhalt.replace(/\r?\n$/, "");
          const abschnitt = `\n\n## ${n.titel} (aus dem Posteingang)\n\n${koerper}\n\n${herkunft}\n`;
          neuText = basis + (crlf ? abschnitt.replace(/\n/g, "\r\n") : abschnitt);
          if (Buffer.byteLength(neuText) > MAX_DATEI) throw new HttpFehler(413, "Die Zielseite würde zu groß.");
          const s = deps.schreibe({ pfad: seite, inhalt: neuText, basisHash: alt.hash });
          merke(() => deps.schreibe({ pfad: seite, inhalt: alt.inhalt, basisHash: s.hash }));
        } else {
          const name = seite.split("/").pop().replace(/\.md$/, "");
          const titel = einzeilig(ziel.neu.titel, 200);
          neuText = ["---", `name: ${name.replace(/^thema_/, "")}`, `description: ${JSON.stringify(titel)}`, "typ: thema", `stand: ${heute}`, `quellen: [${JSON.stringify(archiv)}]`, "---",
            `# ${titel}`, "", koerper, "", herkunft, ""].join("\n");
          const s = deps.schreibe({ pfad: seite, inhalt: neuText, basisHash: null });
          merke(() => {
            if (deps.lies(seite).hash !== s.hash) throw new Error(`die neue Seite „${seite}“ wurde inzwischen geändert und bleibt liegen`);
            unlinkSync(loese(wurzel, seite).abs);
          });
        }
        const c = await festhalten(repo, `Posteingang: „${n.titel}“ in „${seite.replace(/^09_wiki\//, "").replace(/\.md$/, "")}“ übernommen`, [n.rel, archiv, seite], [archiv, seite]);
        return { pfad: n.rel, ziel: archiv, seite, neu: !alt, commit: c.sha, git: c.git };
      });
    });
  }

  return { verwerfen, spaeter, uebernehmen };
}
