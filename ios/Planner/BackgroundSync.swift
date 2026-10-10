import BackgroundTasks
import Foundation

/// Keeps the widgets, the wallpaper data and local reminders fresh without opening the app:
/// the server computes them from its copy of the plan (changes from Telegram, the voice button,
/// another device). Called by the wallpaper action, after «Добавить в ПЛАН» and by iOS's
/// background refresh.
enum BackgroundSync {
  static let taskID = "com.obukhov.planner.refresh"
  private static let url = URL(string: "https://ai-planner-brain.savelyobuhov.workers.dev/snapshot")!

  /// Fetches and applies; false if offline or slow (the old data simply stays).
  @discardableResult
  static func refresh(timeout: TimeInterval = 8) async -> Bool {
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.timeoutInterval = timeout
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(DeviceKey.value, forHTTPHeaderField: "X-Device-Key")
    request.httpBody = try? JSONSerialization.data(withJSONObject: ["tz": -TimeZone.current.secondsFromGMT() / 60])
    guard let (data, response) = try? await URLSession.shared.data(for: request),
          (response as? HTTPURLResponse)?.statusCode == 200,
          let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
    await apply(snapshot: body["snapshot"], reminders: body["reminders"])
    return true
  }

  /// Saves the widget snapshot (same format the page sends) and reschedules local reminders.
  @MainActor
  static func apply(snapshot: Any?, reminders: Any?) {
    if let snapshot, let data = try? JSONSerialization.data(withJSONObject: snapshot, options: .sortedKeys) {
      WidgetStore.save(data)
    }
    if let reminders, let data = try? JSONSerialization.data(withJSONObject: reminders),
       let items = try? JSONDecoder().decode([Reminders.Item].self, from: data) {
      Reminders.schedule(items)
    }
  }

  // MARK: iOS background refresh

  static func register() {
    // handler on the main queue (this type is main-actor isolated)
    BGTaskScheduler.shared.register(forTaskWithIdentifier: taskID, using: .main) { task in
      schedule()
      let work = Task { await refresh(timeout: 20) }
      task.expirationHandler = { work.cancel() }
      Task {
        let ok = await work.value
        task.setTaskCompleted(success: ok)
      }
    }
  }

  /// Asks iOS for the next run (it decides when — typically every few hours, more often if used).
  static func schedule() {
    let request = BGAppRefreshTaskRequest(identifier: taskID)
    request.earliestBeginDate = Date(timeIntervalSinceNow: 30 * 60)
    try? BGTaskScheduler.shared.submit(request)
  }
}
