import AppKit
import UserNotifications
import BrainCore

/// Das echte `UNUserNotificationCenter` hinter dem `MitteilungsZentrum` (nur hier wird `UserNotifications` benutzt). Es gibt nur in der
/// App mit Bundle-Kennung (nicht bei `swift run`, nicht in Test-Bundles) — der `MitteilungsDienst` legt diese Klasse deshalb erst an,
/// nachdem er das geprüft hat. Delegate: Klick → `beiKlick`; Banner im Vordergrund nur, wenn „nur im Hintergrund“ aus ist (oder bei der Probe).
final class SystemMitteilungsZentrum: NSObject, MitteilungsZentrum, UNUserNotificationCenterDelegate, @unchecked Sendable {
    /// Klick auf eine Mitteilung: das Ziel (nil = nicht von Kortex / unlesbar → nur nach vorn holen). Wird auf dem Main-Thread aufgerufen.
    var beiKlick: (@MainActor (MitteilungsZiel?) -> Void)?
    private let zeigeImVordergrund: @Sendable () -> Bool

    /// `zeigeImVordergrund`: frisch aus den Einstellungen (true = auch bei aktiver App ein Banner).
    init(zeigeImVordergrund: @escaping @Sendable () -> Bool) {
        self.zeigeImVordergrund = zeigeImVordergrund
        super.init()
        UNUserNotificationCenter.current().delegate = self
    }

    func fragen() async -> Bool {
        let c = UNUserNotificationCenter.current()
        switch await c.notificationSettings().authorizationStatus {
        case .authorized, .provisional, .ephemeral: return true
        case .notDetermined: return (try? await c.requestAuthorization(options: [.alert, .sound])) ?? false
        default: return false
        }
    }

    func zustellen(_ m: Mitteilung) async {
        let inhalt = UNMutableNotificationContent()
        inhalt.title = m.titel
        if let u = m.untertitel { inhalt.subtitle = u }
        inhalt.body = m.text
        inhalt.threadIdentifier = m.gruppe
        inhalt.userInfo = m.userInfo
        if m.ton { inhalt.sound = .default }
        try? await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: m.kennung, content: inhalt, trigger: nil))
    }

    func zurueckziehen(kennungen: [String]) async {
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: kennungen)
    }

    // MARK: UNUserNotificationCenterDelegate

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let info = notification.request.content.userInfo
        let probe = (info["probe"] as? String) == "1"
        if probe || zeigeImVordergrund() {
            completionHandler(notification.request.content.sound != nil ? [.banner, .list, .sound] : [.banner, .list])
        } else {
            completionHandler([]) // Kortex ist vorne: das Studio zeigt selbst einen Toast
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        let standard = response.actionIdentifier == UNNotificationDefaultActionIdentifier
        let ziel = MitteilungsZiel.lies(userInfo: info)
        DispatchQueue.main.async { [weak self] in
            MainActor.assumeIsolated { if standard { self?.beiKlick?(ziel) } }
            completionHandler()
        }
    }
}

/// Der Takt hinter den Mitteilungen: alle ~2 s neue Zeilen des Aktivitätsprotokolls lesen und fällige Mitteilungen zustellen
/// (die Regeln stehen in `MitteilungsPlaner`/`MitteilungsAblauf`, getestet in `MitteilungenTests`).
@MainActor
final class MitteilungsDienst {
    static let takt = Duration.seconds(2)

    private let pfade: AppPfade
    private let log: AppLog
    private let studioSichtbar: () -> Bool
    private let oeffne: (MitteilungsZiel?) -> Void
    private var zentrum: SystemMitteilungsZentrum?
    private var ablauf: MitteilungsAblauf?
    private var aufgabe: Task<Void, Never>?
    private var beobachter: NSObjectProtocol?

    /// `studioSichtbar`: das Studio-Fenster ist sichtbar (nicht verdeckt, nicht im Dock). `oeffne`: Klick → Studio nach vorn, Stelle öffnen.
    init(pfade: AppPfade, log: AppLog, studioSichtbar: @escaping () -> Bool, oeffne: @escaping (MitteilungsZiel?) -> Void) {
        self.pfade = pfade; self.log = log; self.studioSichtbar = studioSichtbar; self.oeffne = oeffne
    }

    /// Ohne Bundle-Kennung (`swift run`) gibt es kein `UNUserNotificationCenter` (es stürzt dort ab): dann bleibt der Dienst aus.
    var verfuegbar: Bool { Bundle.main.bundleIdentifier != nil }

    func starte() {
        guard aufgabe == nil else { return }
        guard verfuegbar else { log.schreibe("mitteilungen-aus kein-bundle"); return }
        let support = pfade.basis
        let z = SystemMitteilungsZentrum(zeigeImVordergrund: { !MitteilungsEinstellungen.lies(supportOrdner: support).nurImHintergrund })
        z.beiKlick = { [weak self] ziel in
            NSApp.activate()
            self?.oeffne(ziel)
        }
        zentrum = z
        let a = MitteilungsAblauf(leser: AktivitaetsLeser(supportOrdner: support), planer: MitteilungsPlaner(), zentrum: z,
                                  einstellungen: { MitteilungsEinstellungen.lies(supportOrdner: support) },
                                  istVorne: { [weak self] in NSApp.isActive && (self?.studioSichtbar() ?? false) })
        ablauf = a
        beobachter = NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in await self?.ablauf?.ziehtZugestelltesZurueck() }
        }
        aufgabe = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                let gesendet = await a.takt()
                if !gesendet.isEmpty { self?.log.schreibe("mitteilungen zugestellt=\(gesendet.count)") } // nie Text oder Namen ins Log
                try? await Task.sleep(for: Self.takt)
            }
        }
        log.schreibe("mitteilungen-an")
    }

    func beende() {
        aufgabe?.cancel()
        aufgabe = nil
        if let b = beobachter { NotificationCenter.default.removeObserver(b) }
        beobachter = nil
    }

    /// „Probe-Mitteilung senden“: umgeht Schalter, Sammelfenster und Drosselung, braucht aber die Erlaubnis des Systems.
    /// → nil = zugestellt, sonst der Grund für die Seite.
    func probe() async -> String? {
        guard verfuegbar, let zentrum else { return "mitteilungen-nicht-verfuegbar" }
        guard await zentrum.fragen() else { return "keine-erlaubnis" }
        await zentrum.zustellen(Mitteilung.probe(ton: MitteilungsEinstellungen.lies(supportOrdner: pfade.basis).ton,
                                                 kennung: "kortex-probe-\(Int(Date().timeIntervalSince1970 * 1000))"))
        return nil
    }
}
