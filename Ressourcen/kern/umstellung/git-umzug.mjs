// umstellung/git-umzug.mjs — Schritt A2 der Phase A (Paket P7b, Plan Abschnitt 3.3 und 8.3): lokale git-Schlüssel, die git-sicher sperrt, ziehen um.
//
// Entscheidung 1 des Plans: NICHT flach in die globale Konfiguration (ein credential.helper oder core.sshCommand gälte sonst für ALLE Repositories des Nutzers),
// sondern in eine Datei je Vault im Support-Ordner (<Support>/git/<Kennung>.gitconfig, 0600) und per includeIf in die globale Konfiguration eingebunden – mit ZWEI Einträgen
// (gemessen mit git 2.51, Plan 8.3 Nr. 3): `gitdir:<aufgelöster Vault>/.git` trifft den Vault selbst, `gitdir:<aufgelöster Vault>/.git/worktrees/` (mit Schrägstrich) trifft nur die
// verknüpften Arbeitsbäume darunter (die Arbeitskopien des Tageslaufs); die Form mit Schrägstrich am Ende trifft den Vault NICHT. Sonderzeichen des Musters (* ? [ \) im Pfad werden
// maskiert, auf Volumes ohne Groß/klein-Unterscheidung steht gitdir/i. Der Block in der globalen Konfiguration steht zwischen Marken und wird als Ganzes wieder entfernt.
// Außerdem (nur auf ausdrücklichen Wunsch): ein lokales Remote entfernen, Verweise im .git-Ordner durch echte Kopien ersetzen.
// Datenschutz: Werte stehen nur in den Sicherungen/Rückweg-Angaben (0600) und in der Datei je Vault – nie im Protokoll.
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, lstatSync, statSync, realpathSync, readlinkSync, symlinkSync, rmSync, rmdirSync, cpSync, copyFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { echtesGit, lokaleKonfiguration, pruefungAlle, ordneSchluesselEin, formSchluessel, lokaleRemotes, alsPrueflistenName, gitVerzeichnis } from "./git-lage.mjs";
import { gitLauf, kennung } from "./ziele.mjs";
import { hashDatei, hashText, schreibeAtomar, schreibeMitLock, sichereDatei, sicherungsPfad, echtesDateiZiel } from "./protokoll.mjs";

export const id = "A2";
export const titel = "Persönliche git-Einstellungen verschieben";

// --- Einbindung in die globale Konfiguration -------------------------------------------------------------------------------------
export const markeAnfang = (k) => `# >>> Kortex-Umstellung ${k} (von Kortex verwaltet – zum Entfernen den ganzen Block löschen) >>>`;
export const markeEnde = (k) => `# <<< Kortex-Umstellung ${k} <<<`;
// Sonderzeichen des gitdir-Musters maskieren (wildmatch: * ? [ \)
export const musterMaskiert = (pfad) => String(pfad).replace(/[\\*?[]/g, "\\$&");
// Text in einem Abschnittsnamen bzw. Wert in Anführungszeichen (Backslash und " maskiert)
const inAnfuehrung = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// Liegt der Pfad auf einem Volume ohne Groß/klein-Unterscheidung (APFS-Standard)? Ein Buchstabe des aufgelösten Pfads wird umgeschaltet; trifft der neue Pfad dieselbe Datei, ja.
export function istCaseInsensitiv(pfad) {
  try {
    const e = realpathSync(pfad);
    const i = [...e].map((c, n) => [c, n]).filter(([c]) => /[A-Za-z]/.test(c)).pop();
    if (!i) return false;
    const [c, n] = i;
    const andere = e.slice(0, n) + (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()) + e.slice(n + 1);
    const a = statSync(e), b = statSync(andere);
    return a.ino === b.ino && a.dev === b.dev;
  } catch { return false; }
}

export function einbindungsBlock({ vaultEcht, datei, k, caseInsensitiv }) {
  const schluessel = caseInsensitiv ? "gitdir/i" : "gitdir";
  const eintrag = (muster) => `[includeIf ${inAnfuehrung(`${schluessel}:${musterMaskiert(muster)}`)}]\n\tpath = ${inAnfuehrung(datei)}`;
  return [markeAnfang(k), eintrag(`${vaultEcht}/.git`), eintrag(`${vaultEcht}/.git/worktrees/`), markeEnde(k)].join("\n") + "\n";
}

const lies = (datei) => { try { return readFileSync(datei, "utf8"); } catch { return null; } };
export function entferneBlockAusText(text, k) {
  const a = markeAnfang(k), e = markeEnde(k);
  const i = text.indexOf(a);
  if (i < 0) return text;
  const j = text.indexOf(e, i);
  if (j < 0) return text;
  let ende = j + e.length;
  if (text[ende] === "\n") ende++;
  let anfang = i;
  // eine Leerzeile, die wir davor gesetzt haben, mit entfernen
  if (anfang >= 2 && text.slice(anfang - 2, anfang) === "\n\n") anfang -= 1;
  return text.slice(0, anfang) + text.slice(ende);
}
export const hatBlock = (text, k) => typeof text === "string" && text.includes(markeAnfang(k)) && text.includes(markeEnde(k));
// → { vorher: Hash | null (Datei fehlte), nachher: Hash }
export function setzeBlock(gitGlobal, k, block) {
  const ziel = echtesDateiZiel(gitGlobal);
  const alt = lies(ziel);
  let neu = alt === null ? "" : entferneBlockAusText(alt, k);
  if (neu && !neu.endsWith("\n")) neu += "\n";
  if (neu) neu += "\n";
  neu += block;
  schreibeMitLock(ziel, neu, 0o600);
  return { vorher: alt === null ? null : hashText(alt), nachher: hashText(neu), dateiFehlte: alt === null };
}
// → true, wenn der Block da war und entfernt wurde. Eine Datei, die danach leer ist und vorher fehlte (leereDatei), wird gelöscht.
export function entferneBlock(gitGlobal, k, { loescheWennLeer = false } = {}) {
  const ziel = echtesDateiZiel(gitGlobal);
  const alt = lies(ziel);
  if (alt === null || !hatBlock(alt, k)) return false;
  const neu = entferneBlockAusText(alt, k);
  if (!neu.trim() && loescheWennLeer) schreibeMitLock(ziel, null);
  else schreibeMitLock(ziel, neu, 0o600);
  return true;
}

export const dateiJeVault = (z) => join(z.support, "git", `${kennung(z.vault)}.gitconfig`);

// --- Lage ----------------------------------------------------------------------------------------------------------------------
// → { moeglich, grund?, verschieb: [{schluessel, wert}], remotes: [{name, eintraege}], verweise: [rel], struktur: [formen], offen: [namen] } – nur lesend
export function lage(z, ctx) {
  const e = ctx.entscheidungen;
  const git = echtesGit(z.env);
  const gv = gitVerzeichnis(z.vault);
  const leer = { moeglich: false, verschieb: [], remotes: [], verweise: [], struktur: [], offen: [] };
  if (gv.art === "keins") return { ...leer, grund: "kein-git" };
  if (gv.art !== "ordner" || gv.draussen || gv.alternates || !git) return { ...leer, grund: "git-nicht-umstellbar" };
  const konfig = lokaleKonfiguration(git, z.vault, { home: z.home });
  if (!konfig) return { ...leer, grund: "git-config-nicht-lesbar" };
  const pruef = pruefungAlle(git, z.vault, { home: z.home });
  if (pruef.nichtPruefbar) return { ...leer, grund: "pruefung-unmoeglich" };
  const lokal = new Set(lokaleRemotes(konfig));
  const rest = pruef.namen.filter((n) => !lokal.has(n));
  const ein = ordneSchluesselEin(rest.map(formSchluessel));
  const verschiebbar = new Set(rest.filter((n) => ein.verschiebbar.includes(formSchluessel(n))));
  // Werte, die nie unverändert in die Datei je Vault wandern: relative Pfade (./…, ../…: sie hätten dort eine andere Bedeutung) und alles, was in den Vault selbst zeigt (ein
  // Programm aus dem Vault liefe sonst für alle Versionsverläufe dieses Nutzers an dieser Stelle – Programme kommen nie aus dem Vault).
  const vaultFormen = [...new Set([z.vault, z.musterVault, (() => { try { return realpathSync(z.vault); } catch { return z.vault; } })()])];
  const bedenklich = (k) => typeof k.wert === "string" && (/(^|[\s"'=])\.{1,2}\//.test(k.wert) || vaultFormen.some((v) => k.wert.includes(v)));
  const kandidaten = e.gitSchluessel === false ? [] : konfig.filter((k) => verschiebbar.has(alsPrueflistenName(k.schluessel)));
  const abgelehnt = kandidaten.filter(bedenklich);
  const verschieb = kandidaten.filter((k) => !bedenklich(k));
  const remotes = [];
  if (e.remoteEntfernen === true) {
    const namen = new Set(konfig.filter((k) => lokal.has(alsPrueflistenName(k.schluessel))).map((k) => /^remote\.(.+)\.(?:url|pushurl)$/i.exec(k.schluessel)?.[1]).filter(Boolean));
    for (const n of namen) remotes.push({ name: n, eintraege: konfig.filter((k) => k.schluessel.toLowerCase().startsWith(`remote.${n.toLowerCase()}.`)) });
  }
  const verweise = e.verweiseAufloesen === true ? gv.verweise : [];
  return {
    moeglich: true, verschieb, remotes, verweise, abgelehnt: abgelehnt.length,
    struktur: rest.filter((n) => ein.strukturell.includes(formSchluessel(n))), offen: pruef.namen,
  };
}

export function plan(z, ctx) {
  const l = lage(z, ctx);
  const n = l.verschieb.length + l.remotes.length + l.verweise.length;
  return { noetig: l.moeglich && n > 0, text: l.moeglich ? (n > 0 ? `${l.verschieb.length} persönliche git-Einstellung(en) in eine Datei nur für diesen Vault verschieben` : "nichts zu verschieben") : "Der Versionsverlauf lässt sich nicht umstellen", grund: l.grund, struktur: l.struktur.length, anzahl: n };
}

const gitFehler = (r, was) => { if (r.status !== 0) throw new Error(`${was}-fehlgeschlagen`); return r; };

export function wende(z, ctx) {
  const l = lage(z, ctx);
  if (!l.moeglich) return { status: "uebersprungen", grund: l.grund };
  const arbeit = l.verschieb.length + l.remotes.length + l.verweise.length;
  if (!arbeit) return { status: "nichts" };
  const datei = dateiJeVault(z);
  const vaultEcht = realpathSync(z.vault);
  if (/[\n\r\0]/.test(datei) || /[\n\r\0]/.test(vaultEcht)) return { status: "uebersprungen", grund: "pfad-ungeeignet" };
  const konfigDatei = join(z.vault, ".git", "config");
  const sich = sichereDatei(z, ctx.sicherungsDir, konfigDatei, "git-config.vor-a2");
  const vorherPerVault = sichereDatei(z, ctx.sicherungsDir, datei, "git-pervault.vor-a2");
  // Die .git/config nach unseren Änderungen vorab auf einer Kopie berechnen: ihr Hash (`hashErwartet`) steht vor dem ersten Schreiben in den Rückweg-Angaben, damit der Rückweg die
  // Datei auch nach einem Absturz mitten im Schritt (hashNachher unbekannt) als „unsere“ erkennt und Byte für Byte herstellen kann.
  const erwartet = (() => {
    try {
      const tmp = join(ctx.sicherungsDir, "git-config.erwartet");
      copyFileSync(konfigDatei, tmp);
      for (const key of new Set(l.verschieb.map((k) => k.schluessel))) gitLauf(z, ["config", "--file", tmp, "--unset-all", key], { ohneOrdner: true });
      for (const r of l.remotes) gitLauf(z, ["config", "--file", tmp, "--remove-section", `remote.${r.name}`], { ohneOrdner: true });
      const h = hashDatei(tmp);
      rmSync(tmp, { force: true });
      return l.verweise.length ? null : h;       // Verweise ändern die Datei nicht, aber ihre Auflösung ist hier nicht vorab zu berechnen
    } catch { return null; }
  })();
  const undo = {
    gitConfig: { sicherung: sich && sich.rel, hashVorher: sich && sich.hash, hashErwartet: erwartet, modus: (() => { try { return statSync(konfigDatei).mode & 0o777; } catch { return 0o600; } })() },
    verschoben: l.verschieb.map((k) => ({ schluessel: k.schluessel, wert: k.wert })),
    remotes: l.remotes.map((r) => ({ name: r.name, eintraege: r.eintraege.map((k) => ({ schluessel: k.schluessel, wert: k.wert })) })),
    aufgeloest: [],
    datei, dateiVorher: vorherPerVault ? vorherPerVault.rel : null, k: kennung(z.vault), blockGesetzt: false,
  };
  ctx.merkeUndo(undo);

  if (l.verschieb.length) {
    mkdirSync(dirname(datei), { recursive: true, mode: 0o700 });
    try { chmodSync(dirname(datei), 0o700); } catch { /* best effort */ }
    if (!existsSync(datei)) writeFileSync(datei, "", { mode: 0o600 });
    chmodSync(datei, 0o600);
    for (const k of l.verschieb) {
      // kein "=" im Eintrag (Wahrheitswert wahr) wird als "true" geschrieben
      gitFehler(gitLauf(z, ["config", "--file", datei, "--add", k.schluessel, k.wert === null ? "true" : k.wert], { ordner: z.vault }), "datei-je-vault");
    }
    chmodSync(datei, 0o600);
    const block = einbindungsBlock({ vaultEcht, datei, k: kennung(z.vault), caseInsensitiv: z.caseInsensitiv ?? istCaseInsensitiv(z.vault) });
    // Rückweg-Angaben VOR dem Schreiben der globalen Konfiguration (ein Absturz mitten im Schreiben bleibt umkehrbar; entferneBlock findet nur, was wirklich da ist)
    const globalVorher = lies(echtesDateiZiel(z.gitGlobal));
    undo.blockGesetzt = true; undo.global = { vorher: globalVorher === null ? null : hashText(globalVorher), nachher: null, dateiFehlte: globalVorher === null };
    ctx.merkeUndo(undo);
    ctx.pruefpunkt("vor-block");
    const gb = setzeBlock(z.gitGlobal, kennung(z.vault), block);
    undo.global.nachher = gb.nachher;
    ctx.merkeUndo(undo);
    // Wirkt die Einbindung? Die Einträge müssen aus der Datei je Vault kommen, solange die lokalen noch da sind.
    const o = gitLauf(z, ["config", "--show-origin", "--list", "-z"]);
    // mit -z steht vor jedem Eintrag ein eigenes NUL-getrenntes Stück „file:<Datei>“
    const ausDatei = o.stdout.split("\0").filter((e) => e === `file:${datei}`).length;
    if (o.status !== 0 || ausDatei < l.verschieb.length) throw new Error("einbindung-wirkt-nicht");
    for (const key of new Set(l.verschieb.map((k) => k.schluessel))) gitFehler(gitLauf(z, ["config", "--local", "--unset-all", key]), "lokal-entfernen");
  }
  for (const r of l.remotes) gitFehler(gitLauf(z, ["config", "--local", "--remove-section", `remote.${r.name}`]), "remote-entfernen");
  for (const rel of l.verweise) {
    const p = join(z.vault, ".git", rel);
    let ziel;
    try { ziel = readlinkSync(p); } catch { continue; }
    const echtesZiel = resolve(dirname(p), ziel);
    if (!existsSync(echtesZiel)) { throw new Error("verweis-ziel-fehlt"); }
    rmSync(p, { force: true });
    cpSync(echtesZiel, p, { recursive: true, dereference: true });
    undo.aufgeloest.push({ rel, ziel, hash: hashDatei(p) });
    ctx.merkeUndo(undo);
  }
  ctx.pruefpunkt("nach-config");
  undo.gitConfig.hashNachher = hashDatei(konfigDatei);
  ctx.merkeUndo(undo);
  ctx.nachpruefenDaten = { verschieb: l.verschieb, offenVorher: l.offen };
  return { status: "ok", anzahl: l.verschieb.length + l.remotes.length + l.verweise.length, details: { verschoben: l.verschieb.length, remotesEntfernt: l.remotes.length, verweiseAufgeloest: l.verweise.length, strukturell: l.struktur.length, abgelehnt: l.abgelehnt } };
}

// Wirkt es? Die verschobenen Schlüssel liefern über die Einbindung dieselben Werte in derselben Reihenfolge, und die Prüfung der Erlaubnisliste beanstandet sie nicht mehr.
export function nachpruefen(z, ctx) {
  const d = ctx.nachpruefenDaten;
  if (!d || !d.verschieb.length) return true;
  const nach = new Map();
  for (const k of d.verschieb) { if (!nach.has(k.schluessel)) nach.set(k.schluessel, []); nach.get(k.schluessel).push(k.wert); }
  for (const [schluessel, soll] of nach) {
    const r = gitLauf(z, ["config", "--get-all", "-z", schluessel]);
    if (r.status !== 0) return false;
    const ist = r.stdout.split("\0"); if (ist.length && ist[ist.length - 1] === "") ist.pop();
    const erwartet = soll.map((w) => (w === null ? "" : w));
    if (soll.some((w) => w === null)) { if (ist.length !== soll.length) return false; continue; }
    if (JSON.stringify(ist) !== JSON.stringify(erwartet)) return false;
  }
  const git = echtesGit(z.env);
  const pruef = pruefungAlle(git, z.vault, { home: z.home });
  const verschoben = new Set(d.verschieb.map((k) => alsPrueflistenName(k.schluessel)));
  return !pruef.namen.some((n) => verschoben.has(n));
}

export function zurueck(z, ctx, undo) {
  const hinweise = [];
  if (!undo) return { status: "nichts", hinweise };
  const git = echtesGit(z.env);
  const konfigDatei = join(z.vault, ".git", "config");
  const jetzt = hashDatei(konfigDatei);
  const g = undo.gitConfig || {};
  const unveraendert = jetzt !== null && (jetzt === g.hashNachher || jetzt === g.hashErwartet);
  const nichtGeaendert = g.hashVorher ? jetzt === g.hashVorher : false;
  if (g.sicherung && unveraendert) {
    // seit A2 unverändert → die ursprüngliche Datei Byte für Byte zurück
    const quelle = sicherungsPfad(z, g.sicherung);
    if (existsSync(quelle)) { schreibeAtomar(echtesDateiZiel(konfigDatei), readFileSync(quelle), g.modus || 0o600); }
  } else if (!nichtGeaendert) {
    // inzwischen anders: nur unsere Schlüssel einzeln zurückschreiben (nichts anderes anfassen)
    const aktuell = git ? (lokaleKonfiguration(git, z.vault, { home: z.home }) || []) : [];
    const hat = (k, w) => aktuell.some((a) => a.schluessel === k.schluessel && a.wert === w);
    for (const k of undo.verschoben || []) if (!hat(k, k.wert)) gitLauf(z, ["config", "--local", "--add", k.schluessel, k.wert === null ? "true" : k.wert]);
    for (const r of undo.remotes || []) for (const k of r.eintraege) if (!hat(k, k.wert)) gitLauf(z, ["config", "--local", "--add", k.schluessel, k.wert === null ? "true" : k.wert]);
    if ((undo.verschoben || []).length || (undo.remotes || []).length) hinweise.push("git-config-einzeln-zurueck");
  }
  // aufgelöste Verweise wiederherstellen (nur, wenn die Kopie noch unsere ist)
  for (const a of undo.aufgeloest || []) {
    const p = join(z.vault, ".git", a.rel);
    try {
      const l = lstatSync(p);
      if (!l.isSymbolicLink() && (l.isDirectory() || hashDatei(p) === a.hash)) { rmSync(p, { recursive: true, force: true }); symlinkSync(a.ziel, p); }
      else if (!l.isSymbolicLink()) hinweise.push("verweis-geaendert");
    } catch { /* weg */ }
  }
  // Einbindung und Datei je Vault
  if (undo.datei) {
    if (undo.dateiVorher) { const q = sicherungsPfad(z, undo.dateiVorher); if (existsSync(q)) { copyFileSync(q, undo.datei); chmodSync(undo.datei, 0o600); } }
    else { rmSync(undo.datei, { force: true }); try { rmdirSync(dirname(undo.datei)); } catch { /* nicht leer */ } }
    if (!undo.dateiVorher && undo.blockGesetzt) {
      const globalNachher = hashDatei(echtesDateiZiel(z.gitGlobal));
      const raus = entferneBlock(z.gitGlobal, undo.k, { loescheWennLeer: !!(undo.global && undo.global.dateiFehlte) });
      if (raus && undo.global && undo.global.nachher && globalNachher !== undo.global.nachher) hinweise.push("globale-git-config-geaendert");
    }
  }
  return { status: "ok", hinweise };
}
