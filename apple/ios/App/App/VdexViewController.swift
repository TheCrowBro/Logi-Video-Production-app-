import UIKit
import Capacitor

// The web view that shows vdex.crowmade.app, with the three plugins that live in this app (the App Store purchase, the
// Files app picker and the sign-in window) registered beside the ones that come from packages (notifications,
// calendar, files, share).
class VdexViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PurchasesPlugin())
        bridge?.registerPluginInstance(DocumentPickerPlugin())
        bridge?.registerPluginInstance(WebAuthPlugin())
    }
}
