import Foundation
import WidgetKit

/// The plan for the coming week as the home-screen widget sees it. The interface sends it
/// whenever the plan changes (lib/nativeReminders.ts); the app keeps it in the shared App Group
/// container, where the widget extension reads it.
nonisolated struct WidgetSnapshot: Codable, Sendable {
  struct Event: Codable, Hashable, Sendable {
    let title: String
    let start: String // "HH:mm"
    let end: String
    let color: String // blue | red | violet | green | amber
  }

  struct Task: Codable, Hashable, Sendable {
    let title: String
    let time: String?
    let done: Bool
  }

  struct Day: Codable, Sendable {
    let date: String // "YYYY-MM-DD"
    let events: [Event]
    let tasks: [Task]
  }

  struct Late: Codable, Hashable, Sendable {
    let title: String
    let date: String
  }

  struct Inbox: Codable, Hashable, Sendable {
    let title: String
  }

  let days: [Day]
  /// Undone tasks from earlier days.
  let overdue: Int
  let late: [Late]
  /// Undone tasks without a date.
  let inbox: [Inbox]

  init(days: [Day], overdue: Int, late: [Late] = [], inbox: [Inbox] = []) {
    self.days = days
    self.overdue = overdue
    self.late = late
    self.inbox = inbox
  }

  /// Older app data has no `late` / `inbox` yet.
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    days = try c.decode([Day].self, forKey: .days)
    overdue = try c.decodeIfPresent(Int.self, forKey: .overdue) ?? 0
    late = try c.decodeIfPresent([Late].self, forKey: .late) ?? []
    inbox = try c.decodeIfPresent([Inbox].self, forKey: .inbox) ?? []
  }

  static let empty = WidgetSnapshot(days: [], overdue: 0)

  func day(_ key: String) -> Day? { days.first { $0.date == key } }
}

nonisolated enum WidgetStore {
  static let group = "group.com.obukhov.planner"
  static let kind = "PlannerToday"

  private static var file: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?.appendingPathComponent("widget.json")
  }

  /// Saves what the interface sent and asks iOS to redraw the widget — only if something changed,
  /// since widget reloads are rationed.
  static func save(_ data: Data) {
    guard let file, (try? Data(contentsOf: file)) != data else { return }
    try? data.write(to: file, options: .atomic)
    WidgetCenter.shared.reloadTimelines(ofKind: kind)
  }

  static func load() -> WidgetSnapshot {
    guard let file, let data = try? Data(contentsOf: file),
          let snapshot = try? JSONDecoder().decode(WidgetSnapshot.self, from: data) else { return .empty }
    return snapshot
  }

  static func key(_ date: Date) -> String {
    let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
  }

  /// "HH:mm" on the given day.
  static func time(_ hhmm: String, on date: Date) -> Date {
    let p = hhmm.split(separator: ":").compactMap { Int($0) }
    guard p.count == 2 else { return date }
    return Calendar.current.date(bySettingHour: min(p[0], 23), minute: p[1], second: 0, of: date) ?? date
  }
}
