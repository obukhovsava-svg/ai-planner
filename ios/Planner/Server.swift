import Foundation

/// The planner's server. Russian mobile networks throttle Cloudflare, so requests go through the
/// Russian relay first (Cloud.ru, see /relay) and straight to the Worker only if that fails.
enum Server {
  private static let bases = ["https://plan-relay.containerapps.ru", "https://ai-planner-brain.savelyobuhov.workers.dev"]

  /// POSTs JSON with the device key; returns the decoded body of the first 200 answer.
  static func post(_ path: String, _ body: [String: Any], timeout: TimeInterval) async -> [String: Any]? {
    let started = Date()
    for base in bases {
      // whatever time is left goes to the next try
      let left = timeout - Date().timeIntervalSince(started)
      guard left > 2, let url = URL(string: base + path) else { break }
      var request = URLRequest(url: url)
      request.httpMethod = "POST"
      request.timeoutInterval = base == bases[0] ? min(left, timeout * 0.6) : left
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.setValue(DeviceKey.value, forHTTPHeaderField: "X-Device-Key")
      request.httpBody = try? JSONSerialization.data(withJSONObject: body)
      if let (data, response) = try? await URLSession.shared.data(for: request),
         (response as? HTTPURLResponse)?.statusCode == 200,
         let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        return json
      }
    }
    return nil
  }
}
