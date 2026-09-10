import AppKit
import ApplicationServices
import Darwin
import FocusTrackerCore
import Foundation

private enum CommandLineError: Error, CustomStringConvertible {
    case usage
    case pathMustBeAbsolute(String)

    var description: String {
        switch self {
        case .usage:
            return "usage: mac-focus-tracker --output <absolute path> [--pid-file <absolute path>]"
        case let .pathMustBeAbsolute(path):
            return "path must be absolute: \(path)"
        }
    }
}

private struct Configuration {
    let outputURL: URL
    let pidFileURL: URL?
}

private func configuration(arguments: [String]) throws -> Configuration {
    var outputURL: URL?
    var pidFileURL: URL?
    var arguments = Array(arguments.dropFirst())

    while !arguments.isEmpty {
        let option = arguments.removeFirst()
        guard let path = arguments.first else { throw CommandLineError.usage }
        arguments.removeFirst()
        guard !path.isEmpty, (path as NSString).isAbsolutePath else {
            throw CommandLineError.pathMustBeAbsolute(path)
        }
        let url = URL(fileURLWithPath: path, isDirectory: false)
        switch option {
        case "--output":
            guard outputURL == nil else { throw CommandLineError.usage }
            outputURL = url
        case "--pid-file":
            guard pidFileURL == nil else { throw CommandLineError.usage }
            pidFileURL = url
        default:
            throw CommandLineError.usage
        }
    }

    guard let outputURL else { throw CommandLineError.usage }
    return Configuration(outputURL: outputURL, pidFileURL: pidFileURL)
}

private final class JSONLWriter {
    private let handle: FileHandle
    private var isClosed = false

    init(outputURL: URL) throws {
        let directoryURL = outputURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: directoryURL,
            withIntermediateDirectories: true
        )
        if !FileManager.default.fileExists(atPath: outputURL.path) {
            guard FileManager.default.createFile(atPath: outputURL.path, contents: nil) else {
                throw CocoaError(.fileWriteUnknown)
            }
        }

        handle = try FileHandle(forWritingTo: outputURL)
        try handle.seekToEnd()
    }

    func append(_ record: FocusRecord) throws {
        guard !isClosed else { return }
        try handle.write(contentsOf: Data(record.encodedLine().utf8))
        try handle.synchronize()
    }

    func close() {
        guard !isClosed else { return }
        isClosed = true
        try? handle.synchronize()
        try? handle.close()
    }

    deinit {
        close()
    }
}

private final class PIDFile {
    private let url: URL

    init(url: URL) throws {
        self.url = url
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try "\(getpid())\n".write(to: url, atomically: true, encoding: .utf8)
    }

    func remove() {
        try? FileManager.default.removeItem(at: url)
    }

    deinit {
        remove()
    }
}

private final class FocusTracker: @unchecked Sendable {
    private static let ghosttyBundleIdentifier = "com.mitchellh.ghostty"
    private let ghosttyRouteScript = NSAppleScript(source: """
        tell application id "com.mitchellh.ghostty"
            with timeout of 1 second
                if not frontmost then return ""
                set targetWindow to front window
                set targetTab to selected tab of targetWindow
                set targetTerminal to focused terminal of targetTab
                return (id of targetWindow as text) & linefeed & (id of targetTerminal as text)
            end timeout
        end tell
        """)

    private let writer: JSONLWriter
    private let workspace = NSWorkspace.shared
    private var activationObserver: NSObjectProtocol?
    private var trustTimer: Timer?
    private var signalSources: [DispatchSourceSignal] = []
    private var activeApplication: NSRunningApplication?
    private var accessibilityTrusted: Bool?
    private var axObserver: AXObserver?
    private var observedApplicationElement: AXUIElement?
    private var observedWindowElement: AXUIElement?
    private var isStopped = false

    init(writer: JSONLWriter) {
        self.writer = writer
    }

    func start() throws {
        try writer.append(FocusRecord(timestamp: Date(), event: .ready))

        activationObserver = workspace.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            self?.applicationDidActivate(notification)
        }

        reportFocus(workspace.frontmostApplication)
        checkAccessibilityTrust()

        trustTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            self?.checkAccessibilityTrust()
        }
        installSignalHandlers()
    }

    func stop() {
        guard !isStopped else { return }
        isStopped = true
        trustTimer?.invalidate()
        trustTimer = nil
        if let activationObserver {
            workspace.notificationCenter.removeObserver(activationObserver)
            self.activationObserver = nil
        }
        detachAccessibilityObserver()
        for source in signalSources {
            source.cancel()
        }
        signalSources.removeAll()
        writer.close()
        CFRunLoopStop(CFRunLoopGetMain())
    }

    private func installSignalHandlers() {
        for signalNumber in [SIGTERM, SIGINT] {
            Darwin.signal(signalNumber, SIG_IGN)
            let source = DispatchSource.makeSignalSource(
                signal: signalNumber,
                queue: .main
            )
            source.setEventHandler { [weak self] in
                self?.stop()
            }
            source.resume()
            signalSources.append(source)
        }
    }

    private func applicationDidActivate(_ notification: Notification) {
        let application = notification.userInfo?[NSWorkspace.applicationUserInfoKey]
            as? NSRunningApplication
        reportFocus(application ?? workspace.frontmostApplication)
    }

    private func reportFocus(_ application: NSRunningApplication?) {
        activeApplication = application
        let ghosttyRoute = resolveGhosttyRoute(for: application)
        write(
            FocusRecord(
                timestamp: Date(),
                event: .focusChanged,
                applicationName: application?.localizedName,
                bundleIdentifier: application?.bundleIdentifier,
                processIdentifier: application?.processIdentifier,
                ghosttyWindowIdentifier: ghosttyRoute?.windowIdentifier,
                ghosttyTerminalIdentifier: ghosttyRoute?.terminalIdentifier
            )
        )

        if accessibilityTrusted == true {
            attachAccessibilityObserver(to: application)
        } else {
            detachAccessibilityObserver()
        }
    }

    private func checkAccessibilityTrust() {
        let trusted = AXIsProcessTrusted()
        if accessibilityTrusted != trusted {
            accessibilityTrusted = trusted
            write(
                FocusRecord(
                    timestamp: Date(),
                    event: .accessibilityStateChanged,
                    accessibilityTrusted: trusted
                )
            )
        }

        if trusted {
            if axObserver == nil {
                attachAccessibilityObserver(to: activeApplication ?? workspace.frontmostApplication)
            }
        } else {
            detachAccessibilityObserver()
        }
    }

    private func attachAccessibilityObserver(to application: NSRunningApplication?) {
        detachAccessibilityObserver()
        guard let application, !application.isTerminated else { return }

        let processIdentifier = application.processIdentifier
        var newObserver: AXObserver?
        let result = AXObserverCreate(
            processIdentifier,
            { observer, element, notification, context in
                guard let context else { return }
                let tracker = Unmanaged<FocusTracker>
                    .fromOpaque(context)
                    .takeUnretainedValue()
                tracker.accessibilityNotification(
                    observer: observer,
                    element: element,
                    notification: notification
                )
            },
            &newObserver
        )
        guard result == .success, let newObserver else { return }

        let applicationElement = AXUIElementCreateApplication(processIdentifier)
        let context = Unmanaged.passUnretained(self).toOpaque()
        guard AXObserverAddNotification(
            newObserver,
            applicationElement,
            kAXFocusedWindowChangedNotification as CFString,
            context
        ) == .success else {
            return
        }

        axObserver = newObserver
        observedApplicationElement = applicationElement
        CFRunLoopAddSource(
            CFRunLoopGetMain(),
            AXObserverGetRunLoopSource(newObserver),
            .commonModes
        )
        attachFocusedWindow(
            using: newObserver,
            applicationElement: applicationElement,
            event: .focusedWindowObserved
        )
    }

    private func attachFocusedWindow(
        using observer: AXObserver,
        applicationElement: AXUIElement,
        event: FocusRecord.Event
    ) {
        if let observedWindowElement {
            AXObserverRemoveNotification(
                observer,
                observedWindowElement,
                kAXTitleChangedNotification as CFString
            )
            self.observedWindowElement = nil
        }

        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(
            applicationElement,
            kAXFocusedWindowAttribute as CFString,
            &value
        ) == .success,
            let value,
            CFGetTypeID(value) == AXUIElementGetTypeID()
        else {
            reportWindow(event: event, title: nil)
            return
        }

        let windowElement = unsafeDowncast(value, to: AXUIElement.self)
        let context = Unmanaged.passUnretained(self).toOpaque()
        guard AXObserverAddNotification(
            observer,
            windowElement,
            kAXTitleChangedNotification as CFString,
            context
        ) == .success else {
            reportWindow(event: event, title: title(of: windowElement))
            return
        }

        observedWindowElement = windowElement
        reportWindow(event: event, title: title(of: windowElement))
    }

    private func detachAccessibilityObserver() {
        guard let observer = axObserver else {
            observedApplicationElement = nil
            observedWindowElement = nil
            return
        }

        if let observedWindowElement {
            AXObserverRemoveNotification(
                observer,
                observedWindowElement,
                kAXTitleChangedNotification as CFString
            )
        }
        if let observedApplicationElement {
            AXObserverRemoveNotification(
                observer,
                observedApplicationElement,
                kAXFocusedWindowChangedNotification as CFString
            )
        }
        CFRunLoopRemoveSource(
            CFRunLoopGetMain(),
            AXObserverGetRunLoopSource(observer),
            .commonModes
        )
        axObserver = nil
        observedApplicationElement = nil
        observedWindowElement = nil
    }

    fileprivate func accessibilityNotification(
        observer: AXObserver,
        element: AXUIElement,
        notification: CFString
    ) {
        if notification == kAXFocusedWindowChangedNotification as CFString,
            let applicationElement = observedApplicationElement
        {
            attachFocusedWindow(
                using: observer,
                applicationElement: applicationElement,
                event: .focusedWindowChanged
            )
        } else if notification == kAXTitleChangedNotification as CFString {
            reportWindow(event: .windowTitleChanged, title: title(of: element))
        }
    }

    private func title(of element: AXUIElement) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(
            element,
            kAXTitleAttribute as CFString,
            &value
        ) == .success else {
            return nil
        }
        return value as? String
    }

    private func reportWindow(event: FocusRecord.Event, title: String?) {
        let application = activeApplication
        let ghosttyRoute = resolveGhosttyRoute(for: application)
        write(
            FocusRecord(
                timestamp: Date(),
                event: event,
                applicationName: application?.localizedName,
                bundleIdentifier: application?.bundleIdentifier,
                processIdentifier: application?.processIdentifier,
                windowTitle: title,
                ghosttyWindowIdentifier: ghosttyRoute?.windowIdentifier,
                ghosttyTerminalIdentifier: ghosttyRoute?.terminalIdentifier
            )
        )
    }

    private func resolveGhosttyRoute(
        for application: NSRunningApplication?
    ) -> GhosttyRoute? {
        guard let application,
            application.bundleIdentifier == Self.ghosttyBundleIdentifier,
            !application.isTerminated
        else {
            return nil
        }

        let processIdentifier = application.processIdentifier
        guard workspace.frontmostApplication?.processIdentifier == processIdentifier else {
            return nil
        }

        var error: NSDictionary?
        guard let scriptResult = ghosttyRouteScript?
            .executeAndReturnError(&error)
            .stringValue,
            let route = GhosttyRoute.parse(scriptResult: scriptResult),
            !application.isTerminated,
            activeApplication?.processIdentifier == processIdentifier,
            workspace.frontmostApplication?.processIdentifier == processIdentifier
        else {
            return nil
        }

        return route
    }

    private func write(_ record: FocusRecord) {
        do {
            try writer.append(record)
        } catch {
            writeStandardError("failed to append focus record: \(error)\n")
        }
    }
}

private func writeStandardError(_ message: String) {
    FileHandle.standardError.write(Data(message.utf8))
}

do {
    let configuration = try configuration(arguments: CommandLine.arguments)
    let pidFile = try configuration.pidFileURL.map(PIDFile.init)
    defer { pidFile?.remove() }
    let writer = try JSONLWriter(outputURL: configuration.outputURL)
    let tracker = FocusTracker(writer: writer)
    try tracker.start()
    CFRunLoopRun()
    tracker.stop()
} catch {
    writeStandardError("mac-focus-tracker: \(error)\n")
    exit(EX_USAGE)
}
