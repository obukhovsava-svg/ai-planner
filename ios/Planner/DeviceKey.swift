import Foundation
import Security

/// The account without sign-up: 32 random bytes created on first launch and kept in the
/// Keychain (survives app updates; never leaves the device except as a request header,
/// and the server stores only its hash).
enum DeviceKey {
  private static let service = "planner.device-key"

  static let value: String = {
    if let existing = read() { return existing }
    var bytes = [UInt8](repeating: 0, count: 32)
    _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    let key = bytes.map { String(format: "%02x", $0) }.joined()
    save(key)
    return key
  }()

  private static func read() -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  private static func save(_ key: String) {
    let attrs: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecValueData as String: Data(key.utf8),
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
    ]
    SecItemAdd(attrs as CFDictionary, nil)
  }
}
