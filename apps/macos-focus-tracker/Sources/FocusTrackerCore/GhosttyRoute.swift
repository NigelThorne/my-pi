public struct GhosttyRoute: Equatable, Sendable {
    public let windowIdentifier: String
    public let terminalIdentifier: String

    public init(windowIdentifier: String, terminalIdentifier: String) {
        self.windowIdentifier = windowIdentifier
        self.terminalIdentifier = terminalIdentifier
    }

    public static func parse(scriptResult: String) -> GhosttyRoute? {
        let identifiers = scriptResult.components(separatedBy: "\n")
        guard identifiers.count == 2,
            !identifiers[0].isEmpty,
            !identifiers[1].isEmpty
        else {
            return nil
        }

        return GhosttyRoute(
            windowIdentifier: identifiers[0],
            terminalIdentifier: identifiers[1]
        )
    }
}
