import XCTest
@testable import FocusTrackerCore

final class GhosttyRouteTests: XCTestCase {
    func testParsesWindowAndTerminalIdentifiers() {
        XCTAssertEqual(
            GhosttyRoute.parse(scriptResult: "window-123\nterminal-456"),
            GhosttyRoute(
                windowIdentifier: "window-123",
                terminalIdentifier: "terminal-456"
            )
        )
    }

    func testRejectsIncompleteOrAmbiguousScriptResults() {
        XCTAssertNil(GhosttyRoute.parse(scriptResult: ""))
        XCTAssertNil(GhosttyRoute.parse(scriptResult: "window-123"))
        XCTAssertNil(GhosttyRoute.parse(scriptResult: "window-123\n"))
        XCTAssertNil(GhosttyRoute.parse(scriptResult: "\nterminal-456"))
        XCTAssertNil(GhosttyRoute.parse(scriptResult: "window-123\nterminal-456\nextra"))
    }
}
