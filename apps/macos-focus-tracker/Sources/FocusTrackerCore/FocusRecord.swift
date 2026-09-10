import Foundation

public struct FocusRecord: Codable, Equatable, Sendable {
    public enum Event: String, Codable, Sendable {
        case focusChanged = "focus_changed"
        case focusedWindowObserved = "focused_window_observed"
        case focusedWindowChanged = "focused_window_changed"
        case windowTitleChanged = "window_title_changed"
        case ready
        case accessibilityStateChanged = "accessibility_state_changed"
    }

    public let timestamp: Date
    public let event: Event
    public let applicationName: String?
    public let bundleIdentifier: String?
    public let processIdentifier: Int32?
    public let windowTitle: String?
    public let accessibilityTrusted: Bool?
    public let ghosttyWindowIdentifier: String?
    public let ghosttyTerminalIdentifier: String?

    public init(
        timestamp: Date,
        event: Event,
        applicationName: String? = nil,
        bundleIdentifier: String? = nil,
        processIdentifier: Int32? = nil,
        windowTitle: String? = nil,
        accessibilityTrusted: Bool? = nil,
        ghosttyWindowIdentifier: String? = nil,
        ghosttyTerminalIdentifier: String? = nil
    ) {
        self.timestamp = timestamp
        self.event = event
        self.applicationName = applicationName
        self.bundleIdentifier = bundleIdentifier
        self.processIdentifier = processIdentifier
        self.windowTitle = windowTitle
        self.accessibilityTrusted = accessibilityTrusted
        self.ghosttyWindowIdentifier = ghosttyWindowIdentifier
        self.ghosttyTerminalIdentifier = ghosttyTerminalIdentifier
    }

    public func encodedLine() throws -> String {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            var container = encoder.singleValueContainer()
            try container.encode(formatter.string(from: date))
        }
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(self)
        guard let json = String(data: data, encoding: .utf8) else {
            throw EncodingError.invalidValue(
                self,
                EncodingError.Context(
                    codingPath: [],
                    debugDescription: "Encoded focus record was not valid UTF-8"
                )
            )
        }
        return json + "\n"
    }

    private enum CodingKeys: String, CodingKey {
        case timestamp
        case event
        case applicationName = "application_name"
        case bundleIdentifier = "bundle_identifier"
        case processIdentifier = "process_identifier"
        case windowTitle = "window_title"
        case accessibilityTrusted = "accessibility_trusted"
        case ghosttyWindowIdentifier = "ghostty_window_id"
        case ghosttyTerminalIdentifier = "ghostty_terminal_id"
    }
}
