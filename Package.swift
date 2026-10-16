// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "BrainApp",
    platforms: [.macOS("26.0")],
    targets: [
        .target(name: "BrainCore"),
        .executableTarget(name: "BrainApp", dependencies: ["BrainCore"]),
        .testTarget(name: "BrainCoreTests", dependencies: ["BrainCore"]),
    ],
    swiftLanguageModes: [.v5]
)
