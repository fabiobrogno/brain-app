// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "BrainApp",
    platforms: [.macOS("26.0")],
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.0"),
    ],
    targets: [
        .target(name: "BrainCore"),
        .executableTarget(name: "BrainApp", dependencies: ["BrainCore", .product(name: "Sparkle", package: "Sparkle")]),
        .testTarget(name: "BrainCoreTests", dependencies: ["BrainCore"]),
    ],
    swiftLanguageModes: [.v5]
)
