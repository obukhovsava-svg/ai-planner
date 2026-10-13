import AppIntents
import WidgetKit

/// A tap on a task's circle in the widget: ticked at once in the widget, then sent to the server
/// (the app and Telegram get it with the next sync). Runs in the widget, the app stays closed.
struct CompleteTaskIntent: AppIntent {
  static let title: LocalizedStringResource = "Отметить задачу"
  static let isDiscoverable = false

  @Parameter(title: "Задача") var id: String

  init() {}
  init(id: String) { self.id = id }

  func perform() async throws -> some IntentResult {
    WidgetStore.markDone(id)
    guard let key = WidgetStore.deviceKey else { return .result() }
    let body = try? JSONSerialization.data(withJSONObject: ["id": id, "tz": -TimeZone.current.secondsFromGMT() / 60])
    // the Russian relay first (mobile networks throttle Cloudflare), the Worker as a fallback
    for base in ["https://plan-relay.containerapps.ru", "https://ai-planner-brain.savelyobuhov.workers.dev"] {
      guard let url = URL(string: base + "/task/done") else { continue }
      var request = URLRequest(url: url)
      request.httpMethod = "POST"
      request.timeoutInterval = 8
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.setValue(key, forHTTPHeaderField: "X-Device-Key")
      request.httpBody = body
      if let (data, response) = try? await URLSession.shared.data(for: request), (response as? HTTPURLResponse)?.statusCode == 200 {
        if let reply = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let snapshot = reply["snapshot"],
           let fresh = try? JSONSerialization.data(withJSONObject: snapshot, options: .sortedKeys) {
          WidgetStore.save(fresh)
        }
        break
      }
    }
    return .result()
  }
}
