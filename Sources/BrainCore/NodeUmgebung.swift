import Foundation

/// Umgebung für alle Node-Kindprozesse (Brücken, brain.mjs): Eine GUI-App erbt die Umgebung ihres Starters;
/// Variablen, die Node, den Lader oder Git umlenken, dürfen nicht in die mitgelieferte Laufzeit gelangen.
public enum NodeUmgebung {
    /// Entfernt: Node-Optionen/-Pfade (fremder Code per `--require`), Electron-Modus, TLS-Abschaltung, `DYLD_*`/`LD_*` (Bibliotheken
    /// einschleusen) und alle `GIT_*` (Git-Konfiguration, Hooks-, SSH- und Askpass-Programme: die Werkstatt setzt selbst, was Git
    /// braucht). Bewusst behalten: `NODE_EXTRA_CA_CERTS` — es fügt nur vertraute Zertifikate hinzu (Firmen-Proxy für git/https)
    /// und führt keinen Code aus.
    static let gesperrt: Set<String> = [
        "NODE_OPTIONS", "NODE_PATH", "ELECTRON_RUN_AS_NODE", "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_PENDING_DEPRECATION",
        "NODE_REPL_EXTERNAL_MODULE", "NODE_ICU_DATA", "NODE_V8_COVERAGE", "NODE_DEBUG", "KORTEX_VORSCHAU",
    ]
    static let gesperrtePraefixe = ["DYLD_", "LD_", "GIT_"]

    /// Der Testschalter der Werkstatt (`BRAIN_TESTMODUS=1`: Test-Hilfen der Werkstatt). Swift liest ihn
    /// selbst für `--test-skript`; an Kindprozesse geht er nur in Debug-Builds — ein Release-Build gibt ihn nie weiter, auch nicht,
    /// wenn der Starter ihn gesetzt hat.
    static let testmodusName = "BRAIN_TESTMODUS"
    /// Weitere Testschalter des Kerns und der Werkstatt: Sie schalten Schutzmaßnahmen ab (`KORTEX_VAULT_VERTRAUT=alle` macht jeden Vault
    /// vertraut, `KORTEX_KERN_UNSTABIL_ERLAUBT` erlaubt unbeständige Kern-Pfade), ersetzen Programme, Skripte, Module, Zeitwerte und
    /// Messdateien durch Attrappen (`BRAIN_LAUNCHCTL`, `BRAIN_CLAUDE`, `BRAIN_*_SKRIPT`, `BRAIN_OEFFNER` …) oder biegen Starter,
    /// Temp-Wurzeln, die Versionsverwaltung und Hook-Ordner um. Wie der Testmodus gehen sie nur in Debug-Builds an Kindprozesse; ein
    /// Release-Build entfernt sie aus der geerbten Umgebung und aus den Vorgaben.
    ///
    /// Neue Testhaken MÜSSEN hier eingetragen werden: `NodeUmgebungTests.testSchalterListeDecktAlleNamenInRessourcenAb` gleicht die Liste
    /// gegen alle `BRAIN_*`/`KORTEX_*`-Namen in `Ressourcen/**` ab und schlägt bei jedem unbekannten Namen an. Eine Variable, die auch im
    /// Betrieb gebraucht wird (z. B. `BRAIN_VAULT`, `BRAIN_ERNTE`), gehört NICHT hierher, sondern in die Betriebsliste dieses Tests.
    static let testSchalter: Set<String> = [
        "KORTEX_VAULT_VERTRAUT", "KORTEX_KERN_UNSTABIL_ERLAUBT", "KORTEX_STARTER_PFAD", "KORTEX_KERN_TEMP_WURZELN",
        "BRAIN_GIT_PROGRAMM", "BRAIN_GIT_HOOKS_ERLAUBT", "KORTEX_DIENST_PLATTFORM",
        // Programme, Skripte und Module durch Attrappen ersetzen
        "BRAIN_LAUNCHCTL", "BRAIN_CLAUDE", "BRAIN_CLAUDE_EXTRA", "KORTEX_CODEX_PROGRAMM", "BRAIN_OEFFNER", "BRAIN_HINT_SEARCH_MODULE",
        "BRAIN_ANTWORT_SKRIPT", "BRAIN_ERNTE_SKRIPT", "BRAIN_LEKTIONEN_SKRIPT", "BRAIN_W7_SKRIPT", "BRAIN_PFLEGELAUF_SKRIPT",
        "BRAIN_TAGESLAUF_SKRIPT", "BRAIN_LINT_SKRIPT", "BRAIN_DIENST_LIB",
        // Orte, Quellen und Messdateien umlenken
        "BRAIN_TAGESLAUF_CACHE", "BRAIN_QUELLE", "BRAIN_EVAL_DATEI", "BRAIN_EVAL_ZIEL", "BRAIN_IOREG_DATEI", "BRAIN_PMSET_DATEI",
        "BRAIN_GITHUB_API", "BRAIN_GITHUB_BASIS", "BRAIN_GITHUB_HELPER", "BRAIN_APP_VERSION",
        // Verhalten und Zeiten für Tests umschalten
        "BRAIN_EINMAL", "BRAIN_KONTEN_START", "BRAIN_SESSION_NUR_STATUS", "BRAIN_NODE_KEINE_ORTE", "BRAIN_DIENST_AUS",
        "BRAIN_DIENST_IDLE_MS", "BRAIN_DIENST_KARENZ_MS", "BRAIN_DIENST_LEERLAUF_MS", "BRAIN_DIENST_RUHE_MS",
    ]
    /// Marke der Vorschau (`VorschauModus.kindVorgaben`): Wer sie als Vorgabe setzt, bekommt keine Standardordner im PATH.
    /// Aus der geerbten Umgebung fliegt sie raus (`gesperrt`) — sie kommt nur von der App selbst.
    static let vorschauName = "KORTEX_VORSCHAU"
    #if DEBUG
    public static let testmodusWeitergeben = true
    #else
    public static let testmodusWeitergeben = false
    #endif

    public static func bereinigt(_ env: [String: String], testmodusWeitergeben: Bool = NodeUmgebung.testmodusWeitergeben) -> [String: String] {
        env.filter { k, _ in
            !gesperrt.contains(k) && !gesperrtePraefixe.contains { k.hasPrefix($0) }
                && (testmodusWeitergeben || (k != testmodusName && !testSchalter.contains(k)))
        }
    }

    /// Basis: bereinigte Prozessumgebung; danach die Vorgaben der App (immer gültig) und PATH mit Standardordnern — und NUR mit
    /// absoluten Einträgen: leere und relative Einträge (`.`, `node_modules/.bin`) fliegen auch aus einem PATH, den die Vorgaben
    /// setzen, denn die Kindprozesse laufen oft mit einem fremden Vault als Arbeitsverzeichnis (`BrainBefehl.pfadMitStandardOrdnern`).
    /// Ohne Vault (Studio vor der Vault-Wahl) wird auch ein geerbtes `BRAIN_VAULT` entfernt: die Werkstatt liest dann
    /// ausschließlich `<support>/vaults.json`, nie einen zufällig aus der Shell geerbten Pfad.
    public static func fuerKind(basis: [String: String] = ProcessInfo.processInfo.environment,
                                vault: URL?, vorgaben: [String: String],
                                testmodusWeitergeben: Bool = NodeUmgebung.testmodusWeitergeben) -> [String: String] {
        var env = bereinigt(basis, testmodusWeitergeben: testmodusWeitergeben)
        env["BRAIN_VAULT"] = vault?.path
        for (k, v) in vorgaben where testmodusWeitergeben || (k != testmodusName && !testSchalter.contains(k)) { env[k] = v }
        if env[vorschauName] != nil {
            // Vorschau: nur absolute Einträge, aber NICHT Homebrew und /usr/local — dort liegt das echte claude des Rechners.
            let absolut = (env["PATH"] ?? "").split(separator: ":").map(String.init).filter { $0.hasPrefix("/") }
            env["PATH"] = (absolut.isEmpty ? BrainBefehl.systemOrdner : absolut).joined(separator: ":")
        } else {
            env["PATH"] = BrainBefehl.pfadMitStandardOrdnern(env["PATH"])
        }
        return env
    }
}
