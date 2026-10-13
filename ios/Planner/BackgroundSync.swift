import BackgroundTasks
import Foundation

/// Keeps the widgets, the wallpaper data and local reminders fresh without opening the app:
/// the server computes them from its copy of the plan (changes from Telegram, the voice button,
/// another device). Called by the wallpaper action, after «Добавить в ПЛАН» and by iOS's
/// background refresh.
enum BackgroundSync {
  static let taskID = "com.obukhov.planner.refresh"
  /// Fetches and applies; false if offline or slow (the old data simply stays).
  @discardableResult
  static func refresh(timeout: TimeInterval = 8) async -> Bool {
    guard let body = await Server.post("/snapshot", ["tz": -TimeZone.current.secondsFromGMT() / 60], timeout: timeout) else { return false }
    await apply(snapshot: body["snapshot"], reminders: body["reminders"])
    return true
  }

  /// Saves the widget snapshot (same format the page sends) and reschedules local reminders —
  /// unless what's on the phone is newer (a change made in the app that hasn't reached the server).
  @MainActor
  static func apply(snapshot: Any?, reminders: Any?) {
    let serverAt = ((snapshot as? [String: Any])?["at"] as? NSNumber)?.doubleValue ?? 0
    if let local = WidgetStore.loadedAt(), local > serverAt + 1000 { return }
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
