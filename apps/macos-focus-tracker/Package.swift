// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "macos-focus-tracker",
    platforms: [
        .macOS(.v13),
    ],
    products: [
        .library(name: "FocusTrackerCore", targets: ["FocusTrackerCore"]),
        .executable(name: "mac-focus-tracker", targets: ["mac-focus-tracker"]),
    ],
    targets: [
        .target(
            name: "FocusTrackerCore",
            path: "Sources/FocusTrackerCore"
        ),
        .executableTarget(
            name: "mac-focus-tracker",
            dependencies: ["FocusTrackerCore"],
            path: "Sources/mac-focus-tracker"
        ),
        .testTarget(
            name: "FocusTrackerCoreTests",
            dependencies: ["FocusTrackerCore"],
            path: "Tests/FocusTrackerCoreTests"
        ),
    ]
)
