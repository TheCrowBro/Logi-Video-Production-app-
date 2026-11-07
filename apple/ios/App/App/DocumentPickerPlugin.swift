import Foundation
import Capacitor
import UIKit
import UniformTypeIdentifiers

// The Files app, for backups and scripts: save a file where the person chooses (iCloud Drive, On My iPhone, a
// provider), open one from there, take in a file another app hands to Vdex, and print the page. The web app passes
// and receives the bytes as base64.
@objc(DocumentPickerPlugin)
public class DocumentPickerPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "DocumentPickerPlugin"
    public let jsName = "DocumentPicker"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "print", returnType: CAPPluginReturnPromise),
    ]
    private var pending: CAPPluginCall?
    private var mode = ""
    private var tempURL: URL?

    public override func load() {
        Inbox.plugin = self // files that arrived before the web app was listening are handed over now (retained until it listens)
    }

    // save({ name, data (base64), type (a MIME type, optional) }) → { saved: true } once the file is put somewhere, or
    // { saved: false } when the picker is dismissed.
    @objc func save(_ call: CAPPluginCall) {
        guard let name = call.getString("name"), let b64 = call.getString("data"), let bytes = Data(base64Encoded: b64) else { return call.reject("A name and the file's bytes are needed") }
        let safe = (name as NSString).lastPathComponent // a name, never a path
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(safe.isEmpty ? "Vdex file" : safe)
        do { try bytes.write(to: url, options: .atomic) } catch { return call.reject("Could not write the file: \(error.localizedDescription)") }
        DispatchQueue.main.async {
            guard self.ready(call) else { try? FileManager.default.removeItem(at: url); return }
            self.pending = call; self.mode = "save"; self.tempURL = url
            let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
            picker.delegate = self
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    // One sheet at a time: a call made while another picker, the print sheet or a sign-in is up is refused at once
    // rather than left waiting for a sheet that can never appear.
    private func ready(_ call: CAPPluginCall) -> Bool {
        if pending != nil || bridge?.viewController?.presentedViewController != nil { call.reject("Another window is open. Close it and try again."); return false }
        return true
    }

    // open({ types: ['docx', 'txt', …] (extensions, optional) }) → { name, data (base64), type } for the chosen file, or
    // { name: null } when the picker is dismissed.
    @objc func open(_ call: CAPPluginCall) {
        let exts = call.getArray("types", String.self) ?? []
        var types: [UTType] = exts.compactMap { UTType(filenameExtension: $0) }
        if types.isEmpty { types = [.data] }
        DispatchQueue.main.async {
            guard self.ready(call) else { return }
            self.pending = call; self.mode = "open"
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
            picker.allowsMultipleSelection = false
            picker.delegate = self
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    // print() → the phone's print sheet (AirPrint, or Save to Files as a PDF) for the page as it is now, with its print
    // styles. { printed: true } when the sheet closes after printing, { printed: false } when it is cancelled.
    @objc func print(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let webView = self.bridge?.webView else { return call.reject("No page to print") }
            guard self.ready(call) else { return }
            let controller = UIPrintInteractionController.shared
            let info = UIPrintInfo(dictionary: nil)
            info.outputType = .general
            info.jobName = "Vdex"
            controller.printInfo = info
            controller.printFormatter = webView.viewPrintFormatter()
            let done: UIPrintInteractionController.CompletionHandler = { _, completed, error in
                if let error = error { call.reject("Could not print: \(error.localizedDescription)") } else { call.resolve(["printed": completed]) }
            }
            if UIDevice.current.userInterfaceIdiom == .pad { // an iPad shows the print sheet as a popover, which needs a place to point at
                let anchor = CGRect(x: webView.bounds.midX, y: webView.bounds.maxY - 1, width: 1, height: 1)
                controller.present(from: anchor, in: webView, animated: true, completionHandler: done)
            } else {
                controller.present(animated: true, completionHandler: done)
            }
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pending else { return }
        pending = nil
        if mode == "save" { cleanTemp(); call.resolve(["saved": true]); return }
        guard let url = urls.first else { return call.resolve(["name": NSNull()]) }
        DispatchQueue.global(qos: .userInitiated).async { // a large file is read and encoded off the main thread
            let file = Inbox.read(url)
            try? FileManager.default.removeItem(at: url) // the picker's copy, once read
            if let file = file { call.resolve(file) } else { call.reject("Could not read the file") }
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard let call = pending else { return }
        pending = nil
        if mode == "save" { cleanTemp(); call.resolve(["saved": false]) } else { call.resolve(["name": NSNull()]) }
    }

    private func cleanTemp() { if let u = tempURL { try? FileManager.default.removeItem(at: u); tempURL = nil } }
}

// Files other apps hand to Vdex (Info.plist's document types: scripts, shot lists and backups). Each becomes a 'file'
// event on the DocumentPicker plugin, kept until the web app listens, so a file that opened the app cold is not lost.
enum Inbox {
    static weak var plugin: DocumentPickerPlugin? { didSet { flush() } }
    private static var queue: [[String: Any]] = []

    static func take(_ contexts: Set<UIOpenURLContext>) {
        let urls = contexts.map { $0.url }.filter { $0.isFileURL }
        if urls.isEmpty { return }
        DispatchQueue.global(qos: .userInitiated).async { // read and encode off the main thread, so a large file never stalls the start
            var files: [[String: Any]] = []
            for url in urls {
                guard let file = Inbox.read(url) else { continue }
                files.append(file)
                if url.path.contains("/Inbox/") { try? FileManager.default.removeItem(at: url) } // "Copy to Vdex" leaves its copy in Documents/Inbox: taken, then removed
            }
            DispatchQueue.main.async { Inbox.queue.append(contentsOf: files); Inbox.flush() }
        }
    }
    static func read(_ url: URL) -> [String: Any]? {
        let secured = url.startAccessingSecurityScopedResource()
        defer { if secured { url.stopAccessingSecurityScopedResource() } }
        var bytes: Data?
        var coordinatorError: NSError?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinatorError) { u in bytes = try? Data(contentsOf: u) }
        guard let data = bytes else { return nil }
        let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        return ["name": url.lastPathComponent, "data": data.base64EncodedString(), "type": type]
    }
    private static func flush() {
        guard let p = plugin else { return }
        for file in queue { p.notifyListeners("file", data: file, retainUntilConsumed: true) }
        queue.removeAll()
    }
}
