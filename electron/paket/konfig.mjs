// electron/paket/konfig.mjs — die Konfiguration von electron-builder (Paket W2c) als Objekt, damit ein Test sie prüfen kann.
// Windows: NSIS-Installer, Installation pro Benutzer ohne Admin (%LOCALAPPDATA%\Programs\Kortex), AppUserModelID = appId (wie die Bundle-ID am Mac und `app.setAppUserModelId` in haupt.mjs).
// Linux: AppImage und deb. Kein MSIX, kein Flatpak, kein Snap (docs/plaene/plattformen-windows-linux.md §6). Signatur: keine (Betas unsigniert).
// In die App (app.asar) kommt nur der Code der Hülle; Ressourcen/, das Node und die Lizenzen liegen als extraResources daneben (resources/Ressourcen, resources/node).
// Veröffentlicht wird hier nie: `publish` beschreibt nur, woher die installierte App Updates holt (resources/app-update.yml); gebaut wird immer mit `publish: "never"` (baue.mjs).

export const APP_ID = "io.github.fbrogno.brain"; // wie CFBundleIdentifier in Ressourcen/Info.plist und haupt.mjs

/**
 * version: Paketversion (aus Ressourcen/Info.plist), owner/repo: Quelle der Updates (GitHub), genericUrl: nur für den Update-Test (lokaler Dateiserver statt GitHub),
 * ressourcen: Ordner aus stage-Schritt (paket/ressourcen.mjs), ausgabe: Ausgabeordner.
 */
export function baueKonfig({ version, owner = "fabiobrogno", repo = "brain-app", genericUrl = null, ressourcen, ausgabe }) {
  return {
    appId: APP_ID,
    productName: "Kortex",
    executableName: "kortex",
    copyright: "Kortex",
    artifactName: "Kortex-${version}-${os}-${arch}.${ext}",
    // name: electron-builder nimmt für den Installationsordner pro Benutzer (NSIS: %LOCALAPPDATA%\Programs\<name>) den Paketnamen, nicht den Produktnamen
    extraMetadata: { name: "Kortex", version, desktopName: "kortex.desktop" },
    directories: { output: ausgabe },
    asar: true,
    // nur der Code der Hülle; Tests, Konfiguration der Tests und Paketbau bleiben draußen (devDependencies kommen ohnehin nie mit)
    files: ["*.mjs", "*.cjs", "test-schalter.json", "erfassen/**/*", "symbole/**/*", "!playwright.config.mjs"],
    extraResources: [
      { from: ressourcen, to: "Ressourcen" },
      { from: "build/node/${os}-${arch}", to: "node" },
    ],
    publish: genericUrl ? [{ provider: "generic", url: genericUrl }] : [{ provider: "github", owner, repo }],
    win: {
      target: [{ target: "nsis", arch: ["x64"] }],
      icon: "symbole/standard.ico",
    },
    nsis: {
      oneClick: true,
      perMachine: false,
      allowElevation: false,
      allowToChangeInstallationDirectory: false,
      deleteAppDataOnUninstall: false, // der Vault und der Support-Ordner gehören dem Nutzer
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: "Kortex",
      runAfterFinish: true,
      artifactName: "Kortex-Setup-${version}-${arch}.${ext}",
    },
    linux: {
      target: ["AppImage", "deb"],
      icon: "symbole/standard.png",
      category: "Office",
      syncDesktopName: true,
      maintainer: "Kortex <noreply@users.noreply.github.com>",
      synopsis: "Kortex — dein Wissen, dein Vault",
      description: "Kortex: Notizen, Aufgaben und dein Wissen als Vault, mit deiner KI an der Seite.",
      desktop: { entry: { Name: "Kortex", Comment: "Notizen, Aufgaben und Wissen", Keywords: "Notizen;Wissen;Vault;" } },
    },
    appImage: { artifactName: "Kortex-${version}-${arch}.${ext}" },
    deb: { packageName: "kortex", artifactName: "Kortex-${version}-${arch}.${ext}", depends: ["libgtk-3-0", "libnotify4", "libnss3", "libxss1", "libxtst6", "xdg-utils", "libatspi2.0-0", "libuuid1", "libsecret-1-0"] },
    // Beim Bau nie signieren, nie veröffentlichen
    forceCodeSigning: false,
  };
}
