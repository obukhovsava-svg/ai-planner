import Foundation
import Security

/// The account without sign-up: 32 random bytes created on first launch and kept in the
/// Keychain (survives app updates; the server stores only its hash).
///
/// The iPhone puts its key into iCloud Keychain (end-to-end encrypted, only the owner's devices),
/// so the Mac app opens the same planner. The Mac only reads it: until the iPhone's key arrives
/// it uses a key of its own, and switches once the shared one shows up.
enum DeviceKey {
  private static let service = "planner.device-key"

  static let value: String = {
    if let shared = read(synchronizable: true) { return shared }
    #if targetEnvironment(macCatalyst)
    if let local = read(synchronizable: false) { return local }
    let key = random()
    save(key, synchronizable: false)
    return key
    #else
    // An iPhone key from before iCloud sync moves there as is: same account, now on every device.
    let key = read(synchronizable: false) ?? random()
    save(key, synchronizable: true)
    return key
    #endif
  }()

  private static func random() -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    return bytes.map { String(format: "%02x", $0) }.joined()
  }

  private static func read(synchronizable: Bool) -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrSynchronizable as String: synchronizable,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  private static func save(_ key: String, synchronizable: Bool) {
    let attrs: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrSynchronizable as String: synchronizable,
      kSecValueData as String: Data(key.utf8),
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
    ]
    SecItemAdd(attrs as CFDictionary, nil)
  }
}
