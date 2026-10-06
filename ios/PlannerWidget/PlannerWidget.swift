import SwiftUI
import WidgetKit

/// «Сегодня» — the day's plan on the home screen and the lock screen.
/// Data comes from the app (WidgetStore); a tap opens that day in the planner.
@main
struct PlannerWidgets: WidgetBundle {
  var body: some Widget {
    TodayWidget()
    TasksWidget()
  }
}

struct TodayWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: WidgetStore.kind, provider: Provider()) { entry in
      TodayView(entry: entry)
        .containerBackground(for: .widget) { WidgetBackground() }
        .widgetURL(URL(string: "planerapp://d/\(WidgetStore.key(entry.date))"))
    }
    .configurationDisplayName("Сегодня")
    .description("Планы и задачи на сегодня.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryInline, .accessoryCircular])
  }
}

/// Lock screen only: today's tasks with a progress ring — sits next to «Сегодня»'s plans.
struct TasksWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: WidgetStore.tasksKind, provider: Provider()) { entry in
      TasksLockView(day: DayPlan(entry.snapshot, at: entry.date))
        .containerBackground(for: .widget) { Color.clear }
        .widgetURL(URL(string: "planerapp://d/\(WidgetStore.key(entry.date))"))
    }
    .configurationDisplayName("Задачи")
    .description("Задачи на сегодня и прогресс.")
    .supportedFamilies([.accessoryRectangular, .accessoryCircular])
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

/// A row in the task list: today's tasks, plus overdue ones and those without a date.
struct TodoItem: Hashable {
  enum Kind { case today, late, inbox }
  let title: String
  let done: Bool
  let kind: Kind
  /// "18:00" for today's tasks with a time, the original date for overdue ones.
  let detail: String?
}

struct DayPlan {
  let date: Date
  /// Events that haven't ended yet, in time order.
  let events: [WidgetSnapshot.Event]
  let tasks: [WidgetSnapshot.Task]
  let overdue: Int
  let isToday: Bool
  /// Overdue first, then today's open tasks, today's done ones, then tasks without a date.
  let todo: [TodoItem]

  init(_ snapshot: WidgetSnapshot, at date: Date, dayOffset: Int = 0) {
    let day = Calendar.current.date(byAdding: .day, value: dayOffset, to: date) ?? date
    self.date = day
    let plan = snapshot.day(WidgetStore.key(day))
    events = (plan?.events ?? []).filter { dayOffset > 0 || WidgetStore.time($0.end, on: day) > date }
    tasks = plan?.tasks ?? []
    isToday = dayOffset == 0
    overdue = isToday ? snapshot.overdue : 0
    let dated = tasks.filter { !$0.done } + tasks.filter(\.done)
    var todo = dated.map { TodoItem(title: $0.title, done: $0.done, kind: .today, detail: $0.done ? nil : $0.time) }
    if isToday {
      todo.insert(contentsOf: snapshot.late.map { TodoItem(title: $0.title, done: false, kind: .late, detail: shortDate($0.date)) }, at: 0)
      todo += snapshot.inbox.map { TodoItem(title: $0.title, done: false, kind: .inbox, detail: nil) }
    }
    self.todo = todo
  }

  var openTodo: [TodoItem] { todo.filter { !$0.done } }
  var openTasks: [WidgetSnapshot.Task] { tasks.filter { !$0.done } }
  var doneCount: Int { tasks.count - openTasks.count }
  var isEmpty: Bool { events.isEmpty && openTodo.isEmpty }
  var next: WidgetSnapshot.Event? { events.first }

  func isNow(_ e: WidgetSnapshot.Event) -> Bool { isToday && WidgetStore.time(e.start, on: date) <= date }
}

private let ru = Locale(identifier: "ru_RU")

/// "2026-10-04" → "4 окт"
private func shortDate(_ key: String) -> String {
  let p = key.split(separator: "-").compactMap { Int($0) }
  guard p.count == 3, let d = Calendar.current.date(from: DateComponents(year: p[0], month: p[1], day: p[2])) else { return key }
  return d.formatted(.dateTime.day().month(.abbreviated).locale(ru)).replacingOccurrences(of: ".", with: "")
}

// MARK: - Style

private func hex(_ v: UInt32) -> Color {
  Color(red: Double(v >> 16 & 0xff) / 255, green: Double(v >> 8 & 0xff) / 255, blue: Double(v & 0xff) / 255)
}

/// The app icon's colours: sky blue → lavender → pink.
private let brandA = hex(0x7a9dfe), brandB = hex(0xa48bfa), brandC = hex(0xf48eae)
private let brand = LinearGradient(colors: [brandA, brandB, brandC], startPoint: .leading, endPoint: .trailing)
private let lateRed = hex(0xff3b30)

func eventColor(_ name: String) -> Color {
  switch name {
  case "red": hex(0xff3b30)
  case "violet": hex(0xaf52de)
  case "green": hex(0x34c759)
  case "amber": hex(0xff9500)
  default: hex(0x007aff)
  }
}

/// Soft glows of the brand colours over a plain base.
struct WidgetBackground: View {
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    let dark = scheme == .dark
    ZStack {
      dark ? hex(0x15141c) : Color.white
      RadialGradient(colors: [brandB.opacity(dark ? 0.32 : 0.2), .clear], center: .topTrailing, startRadius: 0, endRadius: 230)
      RadialGradient(colors: [brandA.opacity(dark ? 0.22 : 0.14), .clear], center: .bottomLeading, startRadius: 0, endRadius: 210)
    }
  }
}

private func plural(_ n: Int, _ one: String, _ few: String, _ many: String) -> String {
  let m10 = n % 10, m100 = n % 100
  return m10 == 1 && m100 != 11 ? one : (2...4).contains(m10) && !(12...14).contains(m100) ? few : many
}

private func tasksLabel(_ n: Int) -> String { "\(n) \(plural(n, "задача", "задачи", "задач"))" }

// MARK: - Pieces

/// Today's tasks done / all of today's tasks.
private struct ProgressRing: View {
  let done: Int
  let total: Int
  var size: CGFloat = 34

  var body: some View {
    let value = total == 0 ? 0 : Double(done) / Double(total)
    ZStack {
      Circle().stroke(Color.primary.opacity(0.08), lineWidth: size * 0.12)
      Circle().trim(from: 0, to: value)
        .stroke(AngularGradient(colors: [brandA, brandB, brandC, brandA], center: .center), style: StrokeStyle(lineWidth: size * 0.12, lineCap: .round))
        .rotationEffect(.degrees(-90))
      if total > 0 && done == total {
        Image(systemName: "checkmark").font(.system(size: size * 0.34, weight: .bold)).foregroundStyle(brandB)
      } else {
        Text("\(done)/\(total)").font(.system(size: size * 0.28, weight: .semibold, design: .rounded)).monospacedDigit()
      }
    }
    .frame(width: size, height: size)
  }
}

private struct Header: View {
  let day: DayPlan
  var compact = false

  var body: some View {
    HStack(alignment: .center, spacing: 8) {
      VStack(alignment: .leading, spacing: 0) {
        Text(day.date.formatted(.dateTime.weekday(.wide).locale(ru)).uppercased())
          .font(.system(size: 11, weight: .bold)).foregroundStyle(brand).lineLimit(1)
        Text(compact ? day.date.formatted(.dateTime.day().month(.abbreviated).locale(ru)).replacingOccurrences(of: ".", with: "")
                     : day.date.formatted(.dateTime.day().month(.wide).locale(ru)))
          .font(.system(size: compact ? 18 : 21, weight: .bold, design: .rounded)).lineLimit(1).minimumScaleFactor(0.7)
      }
      Spacer(minLength: 0)
      if !day.tasks.isEmpty { ProgressRing(done: day.doneCount, total: day.tasks.count, size: compact ? 30 : 36) }
    }
  }
}

private struct SectionTitle: View {
  let icon: String
  let title: String
  var badge: String? = nil

  var body: some View {
    HStack(spacing: 4) {
      Image(systemName: icon).font(.system(size: 10, weight: .bold))
      Text(title.uppercased()).font(.system(size: 10, weight: .bold)).kerning(0.4)
      if let badge {
        Text(badge).font(.system(size: 10, weight: .bold)).monospacedDigit()
          .padding(.horizontal, 5).padding(.vertical, 1)
          .background(Color.primary.opacity(0.07), in: Capsule())
      }
      Spacer(minLength: 0)
    }
    .foregroundStyle(.secondary)
  }
}

/// Time · colour bar · title — a little timeline.
private struct PlanRow: View {
  let event: WidgetSnapshot.Event
  let now: Bool
  var showEnd = true
  /// Small widget: no time column, the time goes under the title.
  var compact = false

  var body: some View {
    let color = eventColor(event.color)
    HStack(spacing: 7) {
      if !compact {
        Text(event.start).font(.system(size: 12, weight: .semibold, design: .rounded)).monospacedDigit()
          .foregroundStyle(now ? color : .secondary).frame(width: 37, alignment: .leading)
      }
      Capsule().fill(color).frame(width: 3.5).padding(.vertical, 1)
      VStack(alignment: .leading, spacing: 0) {
        Text(event.title).font(.system(size: 13, weight: .semibold)).lineLimit(1)
        if now {
          Text("сейчас · до \(event.end)").font(.system(size: 10, weight: .semibold)).foregroundStyle(color).lineLimit(1)
        } else if compact {
          Text("\(event.start)–\(event.end)").font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary).lineLimit(1)
        } else if showEnd {
          Text("до \(event.end)").font(.system(size: 10)).foregroundStyle(.secondary)
        }
      }
      Spacer(minLength: 0)
    }
    .fixedSize(horizontal: false, vertical: true)
    .padding(.vertical, now ? 3 : 0).padding(.horizontal, now ? 5 : 0)
    .background(now ? color.opacity(0.13) : .clear, in: RoundedRectangle(cornerRadius: 8))
    .padding(.horizontal, now ? -5 : 0)
  }
}

private struct TodoRow: View {
  let item: TodoItem

  var body: some View {
    HStack(spacing: 7) {
      ZStack {
        if item.done {
          Circle().fill(brand)
          Image(systemName: "checkmark").font(.system(size: 7.5, weight: .heavy)).foregroundStyle(.white)
        } else {
          Circle().strokeBorder(item.kind == .late ? AnyShapeStyle(lateRed) : AnyShapeStyle(brand), lineWidth: 1.6)
        }
      }
      .frame(width: 15, height: 15)
      Text(item.title).font(.system(size: 13)).lineLimit(1)
        .strikethrough(item.done).foregroundStyle(item.done ? .secondary : .primary)
      Spacer(minLength: 0)
      if let d = item.detail {
        Text(d).font(.system(size: 10, weight: .medium)).monospacedDigit()
          .foregroundStyle(item.kind == .late ? lateRed : .secondary).lineLimit(1)
      }
    }
  }
}

private struct More: View {
  let count: Int
  var body: some View {
    if count > 0 { Text("ещё \(count)").font(.system(size: 10, weight: .medium)).foregroundStyle(.tertiary) }
  }
}

private struct Placeholder: View {
  let title: String
  let subtitle: String

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      Text(title).font(.system(size: 13, weight: .semibold))
      Text(subtitle).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(2)
    }
  }
}

private struct PlansList: View {
  let day: DayPlan
  let limit: Int
  var showEnd = true

  var body: some View {
    let shown = Array(day.events.prefix(limit))
    VStack(alignment: .leading, spacing: 6) {
      if shown.isEmpty {
        Placeholder(title: day.isToday ? "Планов нет" : "Пусто", subtitle: "Скажите ассистенту, что запланировать")
      }
      ForEach(Array(shown.enumerated()), id: \.offset) { _, e in PlanRow(event: e, now: day.isNow(e), showEnd: showEnd) }
      More(count: day.events.count - shown.count)
    }
  }
}

private struct TodoList: View {
  let day: DayPlan
  let limit: Int

  var body: some View {
    // Done tasks only if there's room left after the open ones.
    let open = day.openTodo, done = day.todo.filter(\.done)
    let shown = Array((open + done).prefix(limit))
    VStack(alignment: .leading, spacing: 6) {
      if open.isEmpty && done.isEmpty {
        Placeholder(title: "Задач нет", subtitle: "Можно отдохнуть")
      } else if open.isEmpty {
        Placeholder(title: "Всё сделано", subtitle: "Отличный день")
      }
      ForEach(Array(shown.enumerated()), id: \.offset) { _, t in TodoRow(item: t) }
      More(count: open.count - shown.filter { !$0.done }.count)
    }
  }
}

// MARK: - Home screen

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

struct SmallView: View {
  let day: DayPlan

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Header(day: day, compact: true)
      if day.isEmpty {
        Spacer(minLength: 0)
        Placeholder(title: "Свободный день", subtitle: "Скажите ассистенту, что запланировать")
      } else {
        if let e = day.next { PlanRow(event: e, now: day.isNow(e), compact: true) }
        let n = day.next == nil ? 3 : 2
        ForEach(Array(day.openTodo.prefix(n).enumerated()), id: \.offset) { _, t in TodoRow(item: t) }
        Spacer(minLength: 0)
        More(count: max(0, day.events.count - 1) + max(0, day.openTodo.count - n))
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct MediumView: View {
  let day: DayPlan

  var body: some View {
    VStack(alignment: .leading, spacing: 9) {
      Header(day: day, compact: true)
      HStack(alignment: .top, spacing: 12) {
        VStack(alignment: .leading, spacing: 6) {
          SectionTitle(icon: "calendar", title: "Планы", badge: day.events.isEmpty ? nil : "\(day.events.count)")
          PlansList(day: day, limit: 2, showEnd: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        VStack(alignment: .leading, spacing: 6) {
          SectionTitle(icon: "checklist", title: "Задачи", badge: day.openTodo.isEmpty ? nil : "\(day.openTodo.count)")
          TodoList(day: day, limit: 3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct LargeView: View {
  let day: DayPlan
  let tomorrow: DayPlan

  var body: some View {
    let plans = min(max(day.events.count, 1), 3)
    let todos = (tomorrow.next == nil ? 9 : 8) - plans
    VStack(alignment: .leading, spacing: 8) {
      Header(day: day)
      VStack(alignment: .leading, spacing: 6) {
        SectionTitle(icon: "calendar", title: "Планы", badge: day.events.isEmpty ? nil : "\(day.events.count)")
        PlansList(day: day, limit: plans)
      }
      Rectangle().fill(Color.primary.opacity(0.06)).frame(height: 1)
      VStack(alignment: .leading, spacing: 6) {
        SectionTitle(icon: "checklist", title: "Задачи", badge: day.openTodo.isEmpty ? nil : "\(day.openTodo.count)")
        TodoList(day: day, limit: min(todos, 5))
      }
      Spacer(minLength: 0)
      if let e = tomorrow.next {
        HStack(spacing: 5) {
          Text("Завтра").font(.system(size: 11, weight: .bold)).foregroundStyle(brand)
          Text("\(e.start) \(e.title)").font(.system(size: 11, weight: .medium)).lineLimit(1)
          if tomorrow.events.count > 1 { Text("+\(tomorrow.events.count - 1)").font(.system(size: 11)).foregroundStyle(.secondary) }
          Spacer(minLength: 0)
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(Color.primary.opacity(0.05), in: Capsule())
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

// MARK: - Lock screen
// iOS tints lock-screen widgets to one colour over the wallpaper, so the design carries over
// as shapes: the plan timeline (time · bar · title), task circles and the progress ring.

/// «Сегодня» on the lock screen: the next plans as a mini timeline.
struct RectangularView: View {
  let day: DayPlan

  var body: some View {
    if day.events.isEmpty {
      TasksRect(day: day)
    } else {
      VStack(alignment: .leading, spacing: 2) {
        LockTitle(icon: "calendar", title: "Планы", count: day.events.count)
        ForEach(Array(day.events.prefix(2).enumerated()), id: \.offset) { _, e in
          let now = day.isNow(e)
          HStack(spacing: 5) {
            Text(e.start).font(.system(size: 13, weight: .semibold, design: .rounded)).monospacedDigit()
              .fixedSize()
            Capsule().frame(width: 3, height: 13).opacity(now ? 1 : 0.5).widgetAccentable()
            Text(e.title).font(.system(size: 14, weight: now ? .bold : .regular)).lineLimit(1)
          }
        }
        Spacer(minLength: 0)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

private struct LockTitle: View {
  let icon: String
  let title: String
  let count: Int

  var body: some View {
    HStack(spacing: 3) {
      Image(systemName: icon)
      Text(count > 0 ? "\(title.uppercased()) · \(count)" : title.uppercased())
    }
    .font(.system(size: 11, weight: .bold)).opacity(0.75).widgetAccentable()
  }
}

/// Ring of today's progress + the first open tasks.
struct TasksRect: View {
  let day: DayPlan

  var body: some View {
    HStack(spacing: 8) {
      LockRing(day: day, size: 38)
      VStack(alignment: .leading, spacing: 2) {
        if day.openTodo.isEmpty {
          Text(day.todo.isEmpty ? "Задач нет" : "Всё сделано").font(.system(size: 15, weight: .semibold))
          Text("на сегодня").font(.system(size: 13)).opacity(0.7)
        }
        ForEach(Array(day.openTodo.prefix(3).enumerated()), id: \.offset) { _, t in
          HStack(spacing: 4) {
            Image(systemName: t.kind == .late ? "exclamationmark.circle" : "circle").font(.system(size: 10, weight: .semibold))
            Text(t.title).font(.system(size: 13)).lineLimit(1)
          }
        }
      }
      Spacer(minLength: 0)
    }
  }
}

/// Today's tasks done / all of them, drawn like the home-screen ring.
private struct LockRing: View {
  let day: DayPlan
  let size: CGFloat

  var body: some View {
    let total = day.tasks.count, done = day.doneCount
    ZStack {
      Circle().stroke(lineWidth: size * 0.11).opacity(0.25)
      Circle().trim(from: 0, to: total == 0 ? 0 : Double(done) / Double(total))
        .stroke(style: StrokeStyle(lineWidth: size * 0.11, lineCap: .round))
        .rotationEffect(.degrees(-90)).widgetAccentable()
      if total > 0 && done == total {
        Image(systemName: "checkmark").font(.system(size: size * 0.32, weight: .bold))
      } else {
        Text("\(done)/\(total)").font(.system(size: size * 0.27, weight: .bold, design: .rounded)).monospacedDigit()
      }
    }
    .frame(width: size, height: size)
  }
}

struct TasksLockView: View {
  let day: DayPlan
  @Environment(\.widgetFamily) private var family

  var body: some View {
    if family == .accessoryCircular {
      LockRing(day: day, size: 52)
    } else {
      TasksRect(day: day)
    }
  }
}

struct InlineView: View {
  let day: DayPlan

  var body: some View {
    if let e = day.next {
      Text("\(e.start) \(e.title)")
    } else {
      Text(day.openTodo.isEmpty ? "Свободный день" : tasksLabel(day.openTodo.count))
    }
  }
}

/// «Сегодня» round: the next plan's time, or how many tasks are left.
struct CircularView: View {
  let day: DayPlan

  var body: some View {
    ZStack {
      AccessoryWidgetBackground()
      VStack(spacing: 0) {
        if let e = day.next {
          Image(systemName: "calendar").font(.system(size: 11, weight: .semibold))
          Text(e.start).font(.system(size: 14, weight: .bold, design: .rounded)).monospacedDigit()
        } else {
          Image(systemName: "checklist").font(.system(size: 11, weight: .semibold))
          Text("\(day.openTodo.count)").font(.system(size: 20, weight: .bold, design: .rounded))
        }
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
        Task(title: "Позвонить врачу", time: nil, done: true),
      ]),
    ], overdue: 0)
  }
}
