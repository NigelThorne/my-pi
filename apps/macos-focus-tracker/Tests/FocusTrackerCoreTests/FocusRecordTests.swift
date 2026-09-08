import Foundation
import XCTest
@testable import FocusTrackerCore

final class FocusRecordTests: XCTestCase {
    func testEncodedLineIsOneJSONObjectFollowedByOneNewline() throws {
        let record = FocusRecord(
            timestamp: Date(timeIntervalSince1970: 0),
            event: .focusChanged,
            applicationName: "Finder",
            bundleIdentifier: "com.apple.finder",
            processIdentifier: 42
        )

        let line = try record.encodedLine()

        XCTAssertTrue(line.hasSuffix("\n"))
        XCTAssertEqual(line.filter { $0 == "\n" }.count, 1)

        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(line.dropLast().utf8)) as? [String: Any]
        )
        XCTAssertEqual(object["event"] as? String, "focus_changed")
        XCTAssertEqual(object["application_name"] as? String, "Finder")
        XCTAssertEqual(object["bundle_identifier"] as? String, "com.apple.finder")
        XCTAssertEqual(object["process_identifier"] as? Int, 42)
        XCTAssertNotNil(object["timestamp"] as? String)
    }

    func testEncodedLineOmitsWindowFieldsWhenUnavailable() throws {
        let record = FocusRecord(
            timestamp: Date(timeIntervalSince1970: 0),
            event: .focusChanged,
            applicationName: "Finder",
            bundleIdentifier: "com.apple.finder",
            processIdentifier: 42
        )

        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(
                with: Data(try record.encodedLine().dropLast().utf8)
            ) as? [String: Any]
        )

        XCTAssertNil(object["window_title"])
        XCTAssertNil(object["window_identifier"])
    }

    func testSupportedEventsHaveDistinctJSONValuesAndOmitAbsentTitle() throws {
        let cases: [(FocusRecord, String)] = [
            (FocusRecord(timestamp: .distantPast, event: .focusChanged), "focus_changed"),
            (FocusRecord(timestamp: .distantPast, event: .windowTitleChanged), "window_title_changed"),
            (FocusRecord(timestamp: .distantPast, event: .ready), "ready"),
            (
                FocusRecord(
                    timestamp: .distantPast,
                    event: .accessibilityStateChanged,
                    accessibilityTrusted: false
                ),
                "accessibility_state_changed"
            ),
        ]

        for (record, expectedEvent) in cases {
            let object = try XCTUnwrap(
                JSONSerialization.jsonObject(
                    with: Data(try record.encodedLine().dropLast().utf8)
                ) as? [String: Any]
            )

            XCTAssertEqual(object["event"] as? String, expectedEvent)
            XCTAssertNil(object["window_title"])
        }

        let accessibilityObject = try XCTUnwrap(
            JSONSerialization.jsonObject(
                with: Data(try cases[3].0.encodedLine().dropLast().utf8)
            ) as? [String: Any]
        )
        XCTAssertEqual(accessibilityObject["accessibility_trusted"] as? Bool, false)
    }
}
