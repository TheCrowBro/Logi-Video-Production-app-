import Foundation
import Capacitor
import StoreKit

// The App Store purchase of a Vdex licence (StoreKit 2). The web app asks for the product, buys it, and sends the
// signed transaction (a JWS Apple signs) to vdex.crowmade.app, which checks Apple's signature and turns it into a
// licence, exactly as a purchase on the website does. Nothing here decides whether Vdex is licensed: the website does.
@objc(PurchasesPlugin)
public class PurchasesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PurchasesPlugin"
    public let jsName = "Purchases"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "products", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "buy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "current", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
    ]

    // The products by their ids (set up in App Store Connect), with the price in the person's own currency.
    @objc func products(_ call: CAPPluginCall) {
        let ids = call.getArray("ids", String.self) ?? []
        Task {
            do {
                let products = try await Product.products(for: ids)
                call.resolve(["products": products.map { ["id": $0.id, "name": $0.displayName, "description": $0.description, "price": $0.displayPrice] }])
            } catch { call.reject(error.localizedDescription) }
        }
    }

    // Buy one product. Resolves with the state, and for a purchase the signed transaction for the website to verify.
    @objc func buy(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { return call.reject("Which product?") }
        Task {
            do {
                guard let product = try await Product.products(for: [id]).first else { return call.reject("That product is not for sale here") }
                let result = try await product.purchase()
                switch result {
                case .success(let verification):
                    switch verification {
                    case .verified(let tx):
                        await tx.finish()
                        call.resolve(Self.describe(tx, jws: verification.jwsRepresentation, state: "purchased"))
                    case .unverified(_, let err):
                        call.reject("The purchase could not be verified: \(err.localizedDescription)")
                    }
                case .userCancelled: call.resolve(["state": "cancelled"])
                case .pending: call.resolve(["state": "pending"]) // waiting for approval (Ask to Buy): the entitlement arrives later
                @unknown default: call.resolve(["state": "unknown"])
                }
            } catch { call.reject(error.localizedDescription) }
        }
    }

    // What this Apple ID owns right now: the signed transactions, for the website to verify (also after a reinstall).
    @objc func current(_ call: CAPPluginCall) {
        Task {
            var list: [[String: Any]] = []
            for await result in Transaction.currentEntitlements {
                if case .verified(let tx) = result { list.append(Self.describe(tx, jws: result.jwsRepresentation, state: tx.revocationDate == nil ? "owned" : "revoked")) }
            }
            call.resolve(["entitlements": list])
        }
    }

    // Ask the App Store again (Restore purchases): entitlements then show up in current().
    @objc func restore(_ call: CAPPluginCall) {
        Task {
            do { try await AppStore.sync(); call.resolve() } catch { call.reject(error.localizedDescription) }
        }
    }

    private static func describe(_ tx: Transaction, jws: String, state: String) -> [String: Any] {
        var out: [String: Any] = ["state": state, "jws": jws, "productId": tx.productID, "transactionId": String(tx.id), "originalTransactionId": String(tx.originalID), "purchased": Int(tx.purchaseDate.timeIntervalSince1970 * 1000)]
        if #available(iOS 16.0, *) { out["environment"] = tx.environment.rawValue }
        if let revoked = tx.revocationDate { out["revoked"] = Int(revoked.timeIntervalSince1970 * 1000) }
        return out
    }
}
