import SwiftUI
import WidgetKit

/// «Сегодня» — the day's plan on the home screen and the lock screen.
/// Data comes from the app (WidgetStore); a tap opens that day in the planner.
@main
struct PlannerWidgets: WidgetBundle {
  var body: some Widget {
    TodayWidget()
  }
}

struct TodayWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: WidgetStore.kind, provider: Provider()) { entry in
      TodayView(entry: entry)
        .containerBackground(for: .widget) { Color(uiColor: .systemBackground) }
        .widgetURL(URL(string: "planerapp://d/\(WidgetStore.key(entry.date))"))
    }
    .configurationDisplayName("Сегодня")
    .description("События и задачи на день.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryInline, .accessoryCircular])
  }
}

// MARK: - Timeline

struct Entry: TimelineEntry {
  let date: Date
  let snapshot: WidgetSnapshot
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> Entry { Entry(date: .now, snapshot: .sample) }

  func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
    let data = WidgetStore.load()
    completion(Entry(date: .now, snapshot: context.isPreview && data.days.isEmpty ? .sample : data))
  }

  /// One entry now, then one at every event start and end over the next two days (so finished
  /// events drop off and "next" moves on by itself) and at each midnight.
  func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
    let snapshot = WidgetStore.load()
    let now = Date.now
    let cal = Calendar.current
    var moments: Set<Date> = [now]
    for offset in 0..<2 {
      guard let day = cal.date(byAdding: .day, value: offset, to: cal.startOfDay(for: now)) else { continue }
      if offset > 0 { moments.insert(day) }
      for e in snapshot.day(WidgetStore.key(day))?.events ?? [] {
        moments.insert(WidgetStore.time(e.start, on: day))
        moments.insert(WidgetStore.time(e.end, on: day))
      }
    }
    let entries = moments.filter { $0 >= now }.sorted().map { Entry(date: $0, snapshot: snapshot) }
    let midnight = cal.date(byAdding: .day, value: 2, to: cal.startOfDay(for: now)) ?? now.addingTimeInterval(86_400)
    completion(Timeline(entries: entries, policy: .after(midnight)))
  }
}

// MARK: - What the day looks like at a given moment

struct DayPlan {
  let date: Date
  /// Events that haven't ended yet, in time order.
  let events: [WidgetSnapshot.Event]
  let tasks: [WidgetSnapshot.Task]
  let overdue: Int
  let isToday: Bool

  init(_ snapshot: WidgetSnapshot, at date: Date, dayOffset: Int = 0) {
    let day = Calendar.current.date(byAdding: .day, value: dayOffset, to: date) ?? date
    self.date = day
    let plan = snapshot.day(WidgetStore.key(day))
    events = (plan?.events ?? []).filter { dayOffset > 0 || WidgetStore.time($0.end, on: day) > date }
    tasks = plan?.tasks ?? []
    overdue = dayOffset == 0 ? snapshot.overdue : 0
    isToday = dayOffset == 0
  }

  var openTasks: [WidgetSnapshot.Task] { tasks.filter { !$0.done } }
  var isEmpty: Bool { events.isEmpty && openTasks.isEmpty }
  var next: WidgetSnapshot.Event? { events.first }

  func isNow(_ e: WidgetSnapshot.Event) -> Bool { isToday && WidgetStore.time(e.start, on: date) <= date }
}

// MARK: - Views

struct TodayView: View {
  let entry: Entry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    let today = DayPlan(entry.snapshot, at: entry.date)
    switch family {
    case .systemSmall: SmallView(day: today)
    case .systemMedium: MediumView(day: today)
    case .systemLarge: LargeView(day: today, tomorrow: DayPlan(entry.snapshot, at: entry.date, dayOffset: 1))
    case .accessoryRectangular: RectangularView(day: today)
    case .accessoryCircular: CircularView(day: today)
    default: InlineView(day: today)
    }
  }
}

private let accent = Color(red: 1, green: 0.23, blue: 0.19) // the date in red, like Calendar

func eventColor(_ name: String) -> Color {
  switch name {
  case "red": Color(red: 1, green: 0.23, blue: 0.19)
  case "violet": Color(red: 0.69, green: 0.32, blue: 0.87)
  case "green": Color(red: 0.2, green: 0.78, blue: 0.35)
  case "amber": Color(red: 1, green: 0.58, blue: 0)
  default: Color(red: 0, green: 0.48, blue: 1)
  }
}

private func weekday(_ date: Date, short: Bool = false) -> String {
  date.formatted(.dateTime.weekday(short ? .abbreviated : .wide).locale(Locale(identifier: "ru_RU"))).uppercased()
}

private func dayNumber(_ date: Date) -> String { "\(Calendar.current.component(.day, from: date))" }

private func tasksLabel(_ n: Int) -> String {
  let m10 = n % 10, m100 = n % 100
  let word = m10 == 1 && m100 != 11 ? "задача" : (2...4).contains(m10) && !(12...14).contains(m100) ? "задачи" : "задач"
  return "\(n) \(word)"
}

/// Weekday over a big day number, as on the Calendar widget.
private struct DateHeader: View {
  let date: Date
  var size: CGFloat = 34

  var body: some View {
    VStack(alignment: .leading, spacing: -2) {
      Text(weekday(date)).font(.system(size: 11, weight: .semibold)).foregroundStyle(accent)
      Text(dayNumber(date)).font(.system(size: size, weight: .regular)).minimumScaleFactor(0.6)
    }
  }
}

private struct EventRow: View {
  let event: WidgetSnapshot.Event
  var now = false

  var body: some View {
    HStack(spacing: 6) {
      RoundedRectangle(cornerRadius: 2).fill(eventColor(event.color)).frame(width: 4)
      VStack(alignment: .leading, spacing: 0) {
        Text(event.title).font(.system(size: 13, weight: .semibold)).lineLimit(1)
        Text(now ? "сейчас · до \(event.end)" : "\(event.start)–\(event.end)")
          .font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
      }
      Spacer(minLength: 0)
    }
    .padding(.vertical, 3).padding(.trailing, 4)
    .background(eventColor(event.color).opacity(0.12), in: RoundedRectangle(cornerRadius: 6))
    .fixedSize(horizontal: false, vertical: true)
  }
}

private struct TaskRow: View {
  let task: WidgetSnapshot.Task

  var body: some View {
    HStack(spacing: 6) {
      Image(systemName: task.done ? "checkmark.circle.fill" : "circle")
        .font(.system(size: 13)).foregroundStyle(task.done ? Color.green : Color.secondary)
      Text(task.title).font(.system(size: 13)).lineLimit(1)
        .strikethrough(task.done).foregroundStyle(task.done ? .secondary : .primary)
      Spacer(minLength: 0)
      if let time = task.time, !task.done { Text(time).font(.system(size: 11)).foregroundStyle(.secondary) }
    }
  }
}

private struct EmptyDay: View {
  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text("Свободный день").font(.system(size: 13, weight: .semibold))
      Text("Скажите ассистенту, что запланировать").font(.system(size: 11)).foregroundStyle(.secondary)
    }
  }
}

private struct Summary: View {
  let day: DayPlan
  /// Narrow column: one fact per line instead of "2 задачи · 1 просроч." in a row.
  var stacked = false

  var body: some View {
    let n = day.openTasks.count
    let layout = stacked ? AnyLayout(VStackLayout(alignment: .leading, spacing: 1)) : AnyLayout(HStackLayout(spacing: 4))
    layout {
      if n > 0 { Text(tasksLabel(n)) }
      if day.overdue > 0 { Text(stacked ? "\(day.overdue) просроч." : "· \(day.overdue) просроч.").foregroundStyle(accent) }
    }
    .font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary).lineLimit(1)
  }
}

/// Rows for one day: events first, then open tasks, then done ones, up to `limit`.
private struct DayList: View {
  let day: DayPlan
  let limit: Int

  var body: some View {
    let events = Array(day.events.prefix(limit))
    let tasks = Array(day.tasks.sorted { !$0.done && $1.done }.prefix(max(0, limit - events.count)))
    let hidden = day.events.count + day.tasks.count - events.count - tasks.count
    VStack(alignment: .leading, spacing: 4) {
      ForEach(Array(events.enumerated()), id: \.offset) { _, e in EventRow(event: e, now: day.isNow(e)) }
      ForEach(Array(tasks.enumerated()), id: \.offset) { _, t in TaskRow(task: t) }
      if hidden > 0 { Text("ещё \(hidden)").font(.system(size: 11)).foregroundStyle(.secondary) }
    }
  }
}

struct SmallView: View {
  let day: DayPlan

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      DateHeader(date: day.date)
      Spacer(minLength: 0)
      if let e = day.next {
        EventRow(event: e, now: day.isNow(e))
        if day.events.count > 1 {
          Text("и ещё \(day.events.count - 1) событ.").font(.system(size: 11)).foregroundStyle(.secondary)
        } else {
          Summary(day: day)
        }
      } else if let t = day.openTasks.first {
        TaskRow(task: t)
        Summary(day: day)
      } else {
        EmptyDay()
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
}

struct MediumView: View {
  let day: DayPlan

  var body: some View {
    HStack(alignment: .top, spacing: 14) {
      VStack(alignment: .leading) {
        DateHeader(date: day.date)
        Spacer(minLength: 0)
        Summary(day: day, stacked: true)
      }
      .frame(width: 84, alignment: .leading)
      Group {
        if day.isEmpty { EmptyDay() } else { DayList(day: day, limit: 4) }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
  }
}

struct LargeView: View {
  let day: DayPlan
  let tomorrow: DayPlan

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .lastTextBaseline) {
        DateHeader(date: day.date, size: 30)
        Spacer()
        Summary(day: day)
      }
      if day.isEmpty { EmptyDay() } else { DayList(day: day, limit: tomorrow.isEmpty ? 9 : 6) }
      if !tomorrow.isEmpty {
        Text("ЗАВТРА").font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary).padding(.top, 4)
        DayList(day: tomorrow, limit: 3)
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

// Lock screen

struct RectangularView: View {
  let day: DayPlan

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      if let e = day.next {
        Text(day.isNow(e) ? "Сейчас · до \(e.end)" : e.start).font(.system(size: 13, weight: .semibold)).widgetAccentable()
        Text(e.title).font(.system(size: 15, weight: .semibold)).lineLimit(1)
        Text(rest).font(.system(size: 13)).foregroundStyle(.secondary).lineLimit(1)
      } else {
        Text("Сегодня").font(.system(size: 13, weight: .semibold)).widgetAccentable()
        Text(day.openTasks.first?.title ?? "Свободный день").font(.system(size: 15, weight: .semibold)).lineLimit(1)
        Text(day.openTasks.isEmpty ? "Нет дел" : tasksLabel(day.openTasks.count)).font(.system(size: 13)).foregroundStyle(.secondary)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var rest: String {
    let more = day.events.count - 1
    let tasks = day.openTasks.count
    return [more > 0 ? "ещё \(more) событ." : nil, tasks > 0 ? tasksLabel(tasks) : nil].compactMap { $0 }.joined(separator: " · ")
  }
}

struct InlineView: View {
  let day: DayPlan

  var body: some View {
    if let e = day.next {
      Text("\(e.start) \(e.title)")
    } else {
      Text(day.openTasks.isEmpty ? "Свободный день" : tasksLabel(day.openTasks.count))
    }
  }
}

struct CircularView: View {
  let day: DayPlan

  var body: some View {
    ZStack {
      AccessoryWidgetBackground()
      VStack(spacing: 0) {
        Image(systemName: "checklist").font(.system(size: 12))
        Text("\(day.openTasks.count)").font(.system(size: 20, weight: .semibold))
      }
    }
  }
}

// MARK: - Preview data (widget gallery before the app has sent anything)

extension WidgetSnapshot {
  static var sample: WidgetSnapshot {
    let today = WidgetStore.key(.now)
    return WidgetSnapshot(days: [
      Day(date: today, events: [
        Event(title: "Созвон с командой", start: "15:00", end: "16:00", color: "blue"),
        Event(title: "Тренировка", start: "19:00", end: "20:00", color: "red"),
      ], tasks: [
        Task(title: "Купить продукты", time: nil, done: false),
        Task(title: "Оплатить интернет", time: "18:00", done: false),
      ]),
    ], overdue: 0)
  }
}
