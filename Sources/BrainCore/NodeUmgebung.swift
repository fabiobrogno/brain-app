import Foundation

/// Umgebung für alle Node-Kindprozesse (Brücken, brain.mjs): Eine GUI-App erbt die Umgebung ihres Starters;
/// Variablen, die Node oder den Lader umlenken, dürfen nicht in die mitgelieferte Laufzeit gelangen.
public enum NodeUmgebung {
    /// Entfernt: Node-Optionen/-Pfade (fremder Code per `--require`), Electron-Modus, TLS-Abschaltung, `DYLD_*`/`LD_*` (Bibliotheken
    /// einschleusen). Bewusst behalten: `NODE_EXTRA_CA_CERTS` — es fügt nur vertraute Zertifikate hinzu (Firmen-Proxy für git/https)
    /// und führt keinen Code aus.
    static let gesperrt: Set<String> = [
        "NODE_OPTIONS", "NODE_PATH", "ELECTRON_RUN_AS_NODE", "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_PENDING_DEPRECATION",
        "NODE_REPL_EXTERNAL_MODULE", "NODE_ICU_DATA", "NODE_V8_COVERAGE", "NODE_DEBUG",
    ]
    static let gesperrtePraefixe = ["DYLD_", "LD_"]

    public static func bereinigt(_ env: [String: String]) -> [String: String] {
        env.filter { k, _ in
            !gesperrt.contains(k) && !gesperrtePraefixe.contains { k.hasPrefix($0) }
        }
    }

    /// Basis: bereinigte Prozessumgebung; danach die Vorgaben der App (immer gültig) und PATH mit Standardordnern.
    public static func fuerKind(basis: [String: String] = ProcessInfo.processInfo.environment,
                                vault: URL, vorgaben: [String: String]) -> [String: String] {
        var env = bereinigt(basis)
        env["BRAIN_VAULT"] = vault.path
        for (k, v) in vorgaben { env[k] = v }
        env["PATH"] = BrainBefehl.pfadMitStandardOrdnern(env["PATH"])
        return env
    }
}
