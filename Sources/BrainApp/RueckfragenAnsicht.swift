import SwiftUI
import BrainCore

/// Zustand der Rückfragen-Ansicht: Liste einmal beim Öffnen holen, Antworten sofort speichern, danach die nächste Frage.
/// Beim Schließen werden gespeicherte Antworten angewendet (wie der Skill `/rueckfragen`).
@MainActor
final class RueckfragenModell: ObservableObject {
    enum Phase: Equatable { case laedt, fragen, fertig, fehler(String) }

    @Published private(set) var phase = Phase.laedt
    @Published private(set) var stapel = RueckfragenStapel(RueckfragenListe(fragen: []))
    @Published private(set) var bericht: Tagesbericht?
    @Published private(set) var tageslauf: TageslaufKurz?
    @Published private(set) var meldung: String?
    @Published private(set) var arbeitet = false
    @Published var notiz = ""

    private let befehl: BrainBefehl
    private let log: AppLog
    private let beiAenderung: () -> Void

    init(befehl: BrainBefehl, tageslauf: TageslaufKurz?, log: AppLog, beiAenderung: @escaping () -> Void) {
        self.befehl = befehl
        self.tageslauf = tageslauf
        self.log = log
        self.beiAenderung = beiAenderung
    }

    func lade() async {
        phase = .laedt
        bericht = Tagesbericht.lade(vault: befehl.vault)
        do {
            stapel = RueckfragenStapel(try await befehl.rueckfragen())
            phase = stapel.istLeer ? .fertig : .fragen
        } catch {
            phase = .fehler(text(error))
            log.schreibe("rueckfragen-fehler \(error)")
        }
    }

    func antworte(_ option: RueckfrageOption) async {
        guard let frage = stapel.aktuell, !arbeitet else { return }
        arbeitet = true
        defer { arbeitet = false }
        do {
            try await befehl.antworte(id: frage.id, wahl: option.wahl, notiz: notiz)
            notiz = ""
            meldung = nil
            stapel.aktuelleErledigt()
            phase = stapel.istLeer ? .fertig : .fragen
            beiAenderung()
        } catch {
            // Antwort nicht gespeichert: Frage bleibt stehen.
            meldung = text(error)
            log.schreibe("antwort-fehler \(error)")
        }
    }

    func spaeter() { stapel.aktuelleZurueckstellen(); notiz = ""; meldung = nil }

    func nimmZurueck() async {
        guard let lauf = bericht?.lauf, bericht?.kannZurueck == true, !arbeitet else { return }
        arbeitet = true
        defer { arbeitet = false }
        do {
            meldung = try await befehl.nimmZurueck(lauf: lauf)
            beiAenderung()
        } catch {
            meldung = text(error)
            log.schreibe("zurueck-fehler \(error)")
        }
    }

    /// Beim Schließen: gespeicherte Antworten einarbeiten lassen (löst sich vom Aufrufer).
    func schliesse() async {
        guard stapel.beantwortet > 0 else { return }
        do { try await befehl.antwortenAnwenden() } catch { log.schreibe("anwenden-fehler \(error)") }
        beiAenderung()
    }

    private func text(_ error: Error) -> String {
        switch error {
        case RueckfragenFehler.abgelehnt(let m): return m
        case BefehlFehler.zeitUeberschritten: return "Kortex antwortet gerade nicht."
        default: return "Das hat gerade nicht geklappt."
        }
    }
}

struct RueckfragenAnsicht: View {
    @ObservedObject var modell: RueckfragenModell
    @State private var zurueckBestaetigen = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            fragenTeil
            Divider()
            berichtTeil
            if let m = modell.meldung { Label(m, systemImage: "info.circle").foregroundStyle(.secondary) }
        }
        .padding(20)
        .frame(width: 520)
        .task { await modell.lade() }
    }

    @ViewBuilder private var fragenTeil: some View {
        switch modell.phase {
        case .laedt:
            ProgressView("Rückfragen werden geholt …")
        case .fehler(let m):
            Label(m, systemImage: "exclamationmark.triangle")
            Button("Nochmal versuchen") { Task { await modell.lade() } }
        case .fertig:
            Label(modell.stapel.beantwortet > 0 ? "Alles beantwortet — danke." : "Keine Rückfragen offen.", systemImage: "checkmark.circle")
            if modell.stapel.wartend > 0 { Text("Weitere \(modell.stapel.wartend) warten, bis Platz ist.").foregroundStyle(.secondary) }
        case .fragen:
            if let f = modell.stapel.aktuell { frage(f) }
        }
    }

    private func frage(_ f: Rueckfrage) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("\(f.header) · \(modell.stapel.fortschritt)").font(.caption).foregroundStyle(.secondary)
            Text(f.frage).font(.title3.bold()).fixedSize(horizontal: false, vertical: true)
            if !f.belegZeilen.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(f.belegZeilen.enumerated()), id: \.offset) { _, z in Text(z).textSelection(.enabled) }
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
            }
            if !f.seite.isEmpty { Label(f.seite, systemImage: "doc.text").font(.caption).foregroundStyle(.secondary) }
            HStack {
                ForEach(f.optionen) { o in
                    Button(o.label) { Task { await modell.antworte(o) } }.help(o.wirkung)
                }
                Spacer()
                Button("Später") { modell.spaeter() }
            }
            .disabled(modell.arbeitet)
            TextField("Notiz (nur wenn nötig)", text: $modell.notiz)
        }
    }

    @ViewBuilder private var berichtTeil: some View {
        Text("Letzter Tageslauf").font(.headline)
        Text(RueckfragenText.tageslauf(modell.tageslauf)).foregroundStyle(.secondary)
        if let b = modell.bericht {
            ScrollView { Text(b.text).font(.system(.caption, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
                .frame(height: 140)
            if b.kannZurueck {
                Button("Letzten Lauf zurücknehmen …", role: .destructive) { zurueckBestaetigen = true }
                    .disabled(modell.arbeitet)
                    .confirmationDialog("Alle automatischen Übernahmen dieses Laufs zurücknehmen?", isPresented: $zurueckBestaetigen) {
                        Button("Zurücknehmen", role: .destructive) { Task { await modell.nimmZurueck() } }
                    } message: { Text("Das Wiki bekommt dafür neue Gegen-Einträge; nichts geht verloren.") }
            }
        }
    }
}
