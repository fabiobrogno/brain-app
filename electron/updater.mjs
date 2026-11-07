// electron/updater.mjs — Updates der installierten App (Paket W2c), das Gegenstück zu Sparkle in der Mac-App: Menü „Nach Updates suchen …“, dazu eine stille Prüfung beim Start und danach täglich.
// Ablauf wie bei Sparkle: gibt es eine neuere Version, fragt Kortex („Laden“ / „Später“), lädt sie (Prüfsumme sha512 prüft electron-updater selbst) und fragt dann, ob es jetzt neu starten soll.
// Quelle: GitHub-Releases (latest.yml / latest-linux.yml, vom Paketbau erzeugt; Adresse steht in resources/app-update.yml). Kanal wie am Mac (docs/veroeffentlichen.md): eine Beta-Version
// (`-beta.N`) folgt den Prereleases, eine stabile nur stabilen Releases; nie ein Downgrade; nichts lädt ohne Zustimmung (autoDownload aus).
// Reine Logik OHNE `import "electron"`: `autoUpdater` (electron-updater), `meldung` (Dialog) und `neustart` kommen von außen — so läuft der Ablauf im Test gegen eine Attrappe und im
// Playwright-Test gegen einen echten lokalen Dateiserver (generic provider).

/** Gibt es in dieser Ausführung Updates? → { moeglich, grund }. Nie in der Entwicklung und nie in der Vorschau (kein Abruf im Netz, wie bei Sparkle: BrainApp.swift). */
export function updatesMoeglich({ gepackt, vorschau = false, testFeed = false }) {
  if (vorschau) return { moeglich: false, grund: "In der Vorschau gibt es keine Updates." };
  if (!gepackt && !testFeed) return { moeglich: false, grund: "In der Entwicklung gibt es keine Updates." };
  return { moeglich: true, grund: null };
}

/** Einstellungen des Updaters (immer dieselben): nichts ohne Zustimmung, nie zurück, Kanal nach der eigenen Version. */
export function konfiguriere(autoUpdater, { version, protokoll = () => {} }) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = /-/.test(String(version)); // Beta-Version → Prereleases; stabile Version → nur stabile Releases
  autoUpdater.logger = { info() {}, debug() {}, warn: (m) => protokoll(`updater warn: ${String(m).slice(0, 200)}`), error: (m) => protokoll(`updater fehler: ${String(m).slice(0, 200)}`) };
  return autoUpdater;
}

const kurz = (e) => String(e?.message || e || "unbekannt").split("\n")[0].slice(0, 200);

/**
 * abh: { autoUpdater, version, aktiv: {moeglich, grund}, meldung({titel, text, knoepfe?}) → Promise<Nummer des Knopfes>, neustart() → Promise, protokoll }
 * → { pruefe({manuell}) → {ok, …}, starteAutomatisch({verzoegerungMs, intervallMs}) → stop(), geladen() }
 */
export function erzeugeUpdater({ autoUpdater, version, aktiv, meldung, neustart, protokoll = () => {} }) {
  let laeuft = false, geladen = null; // geladen = Version, die schon heruntergeladen ist und nur noch installiert werden muss

  async function frageNeustart(v) {
    const i = await meldung({ titel: "Update bereit", text: `Kortex ${v} ist geladen. Jetzt neu starten und installieren?`, knoepfe: ["Jetzt neu starten", "Später"] });
    if (i !== 0) return { ok: true, neu: true, geladen: true, neustart: false };
    protokoll(`update neustart ${v}`);
    await neustart();
    return { ok: true, neu: true, geladen: true, neustart: true };
  }

  async function pruefe({ manuell = false } = {}) {
    if (!aktiv.moeglich) {
      if (manuell) await meldung({ titel: "Updates", text: aktiv.grund });
      return { ok: false, grund: "aus" };
    }
    if (laeuft) return { ok: false, grund: "laeuft" };
    laeuft = true;
    try {
      if (geladen) return await frageNeustart(geladen);
      const r = await autoUpdater.checkForUpdates();
      if (!r || !r.isUpdateAvailable) {
        protokoll("update keins");
        if (manuell) await meldung({ titel: "Kortex ist aktuell", text: `Du hast die neueste Version (${version}).` });
        return { ok: true, neu: false };
      }
      const v = String(r.updateInfo?.version ?? "");
      protokoll(`update verfügbar ${v}`);
      const i = await meldung({ titel: "Neue Version verfügbar", text: `Kortex ${v} ist verfügbar. Du hast ${version}. Jetzt laden?`, knoepfe: ["Laden", "Später"] });
      if (i !== 0) return { ok: true, neu: true, geladen: false };
      await autoUpdater.downloadUpdate();
      geladen = v;
      protokoll(`update geladen ${v}`);
      return await frageNeustart(v);
    } catch (e) {
      protokoll(`update fehlgeschlagen: ${kurz(e)}`);
      if (manuell) await meldung({ titel: "Updates", text: `Die Suche nach Updates ist fehlgeschlagen. ${kurz(e)}` }).catch(() => {});
      return { ok: false, grund: "fehler", meldung: kurz(e) };
    } finally { laeuft = false; }
  }

  // Stille Prüfung: nach dem Start (verzögert) und danach alle 24 Stunden; sie meldet sich nur, wenn es etwas Neues gibt
  function starteAutomatisch({ verzoegerungMs = 30_000, intervallMs = 86_400_000 } = {}) {
    if (!aktiv.moeglich) return () => {};
    const t1 = setTimeout(() => { pruefe({ manuell: false }); }, verzoegerungMs);
    const t2 = setInterval(() => { pruefe({ manuell: false }); }, intervallMs);
    t1.unref?.(); t2.unref?.();
    return () => { clearTimeout(t1); clearInterval(t2); };
  }

  return { pruefe, starteAutomatisch, geladen: () => geladen };
}
