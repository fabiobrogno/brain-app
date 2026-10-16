import AppKit
import SwiftUI
import BrainCore

@MainActor
final class AppDelegat: NSObject, NSApplicationDelegate {
    let zustand = AppZustand()

    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { await zustand.starte() }
    }

    func applicationWillTerminate(_ notification: Notification) {
        zustand.beende()
    }
}

@main
struct BrainApp: App {
    @NSApplicationDelegateAdaptor(AppDelegat.self) private var delegat

    var body: some Scene {
        MenuBarExtra {
            MenueInhalt(zustand: delegat.zustand)
        } label: {
            MenueSymbol(zustand: delegat.zustand)
        }
    }
}
