import Foundation

/// Umgebung für alle Node-Kindprozesse (Brücken, brain.mjs, Vertrauensprüfung): Eine GUI-App erbt die Umgebung ihres Starters;
/// Variablen, die Node, den Lader oder Git umlenken, dürfen nicht in die mitgelieferte Laufzeit gelangen.
public enum NodeUmgebung {
    /// Entfernt: Node-Optionen/-Pfade (fremder Code per `--require`), Electron-Modus, TLS-Abschaltung, `DYLD_*`/`LD_*` (Bibliotheken
    /// einschleusen) und alle `GIT_*` (Git-Konfiguration, Hooks-, SSH- und Askpass-Programme: die Werkstatt setzt selbst, was Git
    /// braucht). Bewusst behalten: `NODE_EXTRA_CA_CERTS` — es fügt nur vertraute Zertifikate hinzu (Firmen-Proxy für git/https)
    /// und führt keinen Code aus.
    static let gesperrt: Set<String> = [
        "NODE_OPTIONS", "NODE_PATH", "ELECTRON_RUN_AS_NODE", "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_PENDING_DEPRECATION",
        "NODE_REPL_EXTERNAL_MODULE", "NODE_ICU_DATA", "NODE_V8_COVERAGE", "NODE_DEBUG",
    ]
    static let gesperrtePraefixe = ["DYLD_", "LD_", "GIT_"]

    /// Der Testschalter der Werkstatt (`BRAIN_TESTMODUS=1`: Test-Hilfen wie `--erlauben` der Vertrauensprüfung). Swift liest ihn
    /// selbst für `--test-skript`; an Kindprozesse geht er nur in Debug-Builds — ein Release-Build gibt ihn nie weiter, auch nicht,
    /// wenn der Starter ihn gesetzt hat.
    static let testmodusName = "BRAIN_TESTMODUS"
    #if DEBUG
    public static let testmodusWeitergeben = true
    #else
    public static let testmodusWeitergeben = false
    #endif

    public static func bereinigt(_ env: [String: String], testmodusWeitergeben: Bool = NodeUmgebung.testmodusWeitergeben) -> [String: String] {
        env.filter { k, _ in
            !gesperrt.contains(k) && !gesperrtePraefixe.contains { k.hasPrefix($0) } && (testmodusWeitergeben || k != testmodusName)
        }
    }

    /// Basis: bereinigte Prozessumgebung; danach die Vorgaben der App (immer gültig) und PATH mit Standardordnern.
    /// Ohne Vault (Studio vor der Vault-Wahl) wird auch ein geerbtes `BRAIN_VAULT` entfernt: die Werkstatt liest dann
    /// ausschließlich `<support>/vaults.json`, nie einen zufällig aus der Shell geerbten Pfad.
    public static func fuerKind(basis: [String: String] = ProcessInfo.processInfo.environment,
                                vault: URL?, vorgaben: [String: String],
                                testmodusWeitergeben: Bool = NodeUmgebung.testmodusWeitergeben) -> [String: String] {
        var env = bereinigt(basis, testmodusWeitergeben: testmodusWeitergeben)
        env["BRAIN_VAULT"] = vault?.path
        for (k, v) in vorgaben where testmodusWeitergeben || k != testmodusName { env[k] = v }
        env["PATH"] = BrainBefehl.pfadMitStandardOrdnern(env["PATH"])
        return env
    }
}
