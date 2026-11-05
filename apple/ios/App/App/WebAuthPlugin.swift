import Foundation
import Capacitor
import AuthenticationServices

// Sign-ins that must not happen inside an app's web view (Google, Microsoft, Dropbox and Apple all say so): the page
// opens in the phone's own sign-in window (ASWebAuthenticationSession, which shares Safari's sign-ins), and the answer
// comes back to the app on the vdex:// address the window ends on. Nothing from the window is read but that address.
@objc(WebAuthPlugin)
public class WebAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "WebAuthPlugin"
    public let jsName = "WebAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
    ]
    private var session: ASWebAuthenticationSession?

    // start({ url, scheme }) → { url } with the address the window ended on, or { cancelled: true } when it was closed.
    @objc func start(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw), ["https"].contains(url.scheme ?? "") else { return call.reject("A web address is needed") }
        let scheme = call.getString("scheme") ?? "vdex"
        DispatchQueue.main.async {
            self.session?.cancel()
            let s = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { back, error in
                self.session = nil
                if let back = back { call.resolve(["url": back.absoluteString]); return }
                if let e = error as? ASWebAuthenticationSessionError, e.code == .canceledLogin { call.resolve(["cancelled": true]); return }
                call.reject(error?.localizedDescription ?? "The sign-in window could not open")
            }
            s.presentationContextProvider = self
            s.prefersEphemeralWebBrowserSession = false // Safari's own sign-ins (Google, Apple ID) spare the typing
            self.session = s
            if !s.start() { self.session = nil; call.reject("The sign-in window could not open") }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return self.bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }
}
