import Foundation
import UserNotifications

/// Reminders as the app's own local notifications: the interface sends the upcoming moments
/// whenever the plan changes; the soonest 60 are kept scheduled (iOS allows 64 pending).
enum Reminders {
  struct Item: Decodable {
    let id: String
    let at: Double // epoch ms
    let title: String
    let body: String
    let open: String
  }

  private static let prefix = "planner-"
  private static var askedPermission = false

  static func schedule(_ items: [Item]) {
    let center = UNUserNotificationCenter.current()
    let upcoming = items.filter { $0.at / 1000 > Date().timeIntervalSince1970 + 1 }.sorted { $0.at < $1.at }.prefix(60)
    Task {
      if !upcoming.isEmpty && !askedPermission {
        askedPermission = true
        _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
      }
      let pending = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(prefix) }
      center.removePendingNotificationRequests(withIdentifiers: pending)
      for item in upcoming {
        let content = UNMutableNotificationContent()
        content.title = item.title
        content.body = item.body
        content.sound = .default
        content.userInfo = ["open": item.open]
        content.threadIdentifier = "planner"
        let date = Date(timeIntervalSince1970: item.at / 1000)
        let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        let request = UNNotificationRequest(identifier: prefix + item.id, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: parts, repeats: false))
        try? await center.add(request)
      }
      #if DEBUG
      let scheduled = await center.pendingNotificationRequests().filter { $0.identifier.hasPrefix(prefix) }
      let delivered = await center.deliveredNotifications()
      print("PLANNER_DELIVERED:", delivered.map { "\($0.request.content.title) @ \($0.date)" })
      print("PLANNER_REMINDERS:", scheduled.count, scheduled.prefix(3).map { "\($0.content.title) @ \(($0.trigger as? UNCalendarNotificationTrigger)?.nextTriggerDate().map { "\($0)" } ?? "-")" })
      fflush(stdout)
      #endif
    }
  }
}
