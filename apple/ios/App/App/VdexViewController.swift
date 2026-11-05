import UIKit
import Capacitor

// The web view that shows vdex.crowmade.app, with the two plugins that live in this app (the App Store purchase and
// the Files app picker) registered beside the ones that come from packages (notifications, calendar, files, share).
class VdexViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PurchasesPlugin())
        bridge?.registerPluginInstance(DocumentPickerPlugin())
    }
}
