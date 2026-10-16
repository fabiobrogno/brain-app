import SwiftUI

@main
struct BrainApp: App {
    var body: some Scene {
        MenuBarExtra("Brain", systemImage: "brain") {
            Button("Beenden") { NSApplication.shared.terminate(nil) }
        }
    }
}
