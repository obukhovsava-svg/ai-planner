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
// Flat colour of the app's accent (Настройки → Цвет оформления): a pastel field with deep text in
// light mode, the deep shade with pastel text in dark mode. Bold monospaced type throughout.

private func hex(_ v: UInt32) -> Color {
  Color(red: Double(v >> 16 & 0xff) / 255, green: Double(v >> 8 & 0xff) / 255, blue: Double(v & 0xff) / 255)
}

/// pastel, deep — per accent.
private let palettes: [String: (UInt32, UInt32)] = [
  "blue": (0xcdd0f7, 0x0b1166),
  "sage": (0xd7ebc6, 0x27501b),
  "lime": (0xd3f5a8, 0x1f5a0f),
  "mist": (0xcbe6f8, 0x0b3b60),
  "pink": (0xf8c9d8, 0x5c1030),
  "red": (0xf4a09a, 0x5e0a08),
  "yellow": (0xf6e3a1, 0x4f3b00),
  "milk": (0xefe4d2, 0x4a3826),
]

struct Palette {
  let bg: Color
  let fg: Color
  let late: Color

  init(_ accent: String, dark: Bool) {
    let (pastel, deep) = palettes[accent] ?? palettes["blue"]!
    bg = hex(dark ? deep : pastel)
    fg = hex(dark ? pastel : deep)
    // overdue stands out in coral — on the red theme coral is the background itself, so it's white there
    late = accent == "red" ? .white : hex(dark ? 0xff8a80 : 0xe5484d)
  }

  var secondary: Color { fg.opacity(0.62) }
  var faint: Color { fg.opacity(0.14) }
}

private struct PaletteKey: EnvironmentKey { static let defaultValue = Palette("blue", dark: false) }
extension EnvironmentValues {
  var palette: Palette {
    get { self[PaletteKey.self] }
    set { self[PaletteKey.self] = newValue }
  }
}

/// Pastel or deep field — chosen in the planner (Настройки → Фон виджета).
private func isDark(_ scheme: ColorScheme) -> Bool { WidgetStore.darkTone }

/// Supplies the palette for the current appearance.
struct Painted<Content: View>: View {
  @Environment(\.colorScheme) private var scheme
  @ViewBuilder let content: () -> Content
  var body: some View {
    let p = Palette(WidgetStore.accent, dark: isDark(scheme))
    content().environment(\.palette, p).foregroundStyle(p.fg)
  }
}

struct WidgetBackground: View {
  @Environment(\.colorScheme) private var scheme
  var body: some View { Palette(WidgetStore.accent, dark: isDark(scheme)).bg }
}

private func mono(_ size: CGFloat, _ weight: Font.Weight = .bold) -> Font { .system(size: size, weight: weight, design: .monospaced) }

func eventColor(_ name: String) -> Color {
  switch name {
  case "red": hex(0xff3b30)
  case "violet": hex(0xaf52de)
  case "green": hex(0x34c759)
  case "amber": hex(0xff9500)
  default: hex(0x007aff)
  }
}

private func plural(_ n: Int, _ one: String, _ few: String, _ many: String) -> String {
  let m10 = n % 10, m100 = n % 100
  return m10 == 1 && m100 != 11 ? one : (2...4).contains(m10) && !(12...14).contains(m100) ? few : many
}

private func tasksLabel(_ n: Int) -> String { "\(n) \(plural(n, "задача", "задачи", "задач"))" }

// MARK: - Pieces

/// Today's tasks done / all: the arc fills task by task (animated when it changes) and turns
/// into a closed circle with a tick once everything is done.
private struct ProgressRing: View {
  let done: Int
  let total: Int
  var size: CGFloat = 26
  @Environment(\.palette) private var p

  var body: some View {
    let all = total > 0 && done >= total
    let value = total == 0 ? 0 : min(1, Double(done) / Double(total))
    ZStack {
      Circle().stroke(p.fg.opacity(0.3), lineWidth: 2)
      Circle().trim(from: 0, to: value)
        .stroke(p.fg, style: StrokeStyle(lineWidth: 2.2, lineCap: .round))
        .rotationEffect(.degrees(-90))
        .animation(.spring(duration: 0.8, bounce: 0.15), value: value)
      if all {
        Circle().fill(p.fg).padding(size * 0.16)
        Image(systemName: "checkmark").font(.system(size: size * 0.36, weight: .heavy)).foregroundStyle(p.bg)
          .transition(.scale.combined(with: .opacity))
      } else {
        Text("\(done)/\(total)").font(mono(size * 0.34)).minimumScaleFactor(0.6).lineLimit(1).padding(2)
          .contentTransition(.numericText(value: Double(done)))
      }
    }
    .animation(.spring(duration: 0.6, bounce: 0.25), value: all)
    .frame(width: size, height: size)
  }
}

/// ВТОРНИК / 13 ОКТ and the ring.
private struct Header: View {
  let day: DayPlan
  var size: CGFloat = 22
  var ring: CGFloat? = nil

  var body: some View {
    HStack(alignment: .top, spacing: 6) {
      VStack(alignment: .leading, spacing: -3) {
        Text(day.date.formatted(.dateTime.weekday(.wide).locale(ru)).uppercased())
        Text(day.date.formatted(.dateTime.day().month(.abbreviated).locale(ru)).replacingOccurrences(of: ".", with: "").uppercased())
      }
      .font(mono(size, .heavy)).lineLimit(1).minimumScaleFactor(0.55)
      Spacer(minLength: 0)
      ProgressRing(done: day.doneCount, total: day.tasks.count, size: ring ?? size * 1.2)
    }
  }
}

private struct SectionTitle: View {
  let title: String
  var badge: String? = nil
  @Environment(\.palette) private var p

  var body: some View {
    HStack(spacing: 5) {
      Text(title.uppercased()).font(.system(size: 10.5, weight: .heavy)).kerning(0.6)
      if let badge { Text(badge).font(mono(10, .heavy)) }
      Spacer(minLength: 0)
    }
    .foregroundStyle(p.secondary)
  }
}

/// Colour bar · title / time.
private struct PlanRow: View {
  let event: WidgetSnapshot.Event
  let now: Bool
  var titleSize: CGFloat = 13
  @Environment(\.palette) private var p

  var body: some View {
    HStack(spacing: 6) {
      Capsule().fill(eventColor(event.color)).frame(width: 3).padding(.vertical, 1)
      VStack(alignment: .leading, spacing: 1) {
        Text(event.title).font(mono(titleSize)).lineLimit(1)
        Text(now ? "сейчас · до \(event.end)" : "\(event.start)-\(event.end)").font(mono(8, now ? .heavy : .semibold))
          .foregroundStyle(now ? p.fg : p.secondary).lineLimit(1)
      }
      Spacer(minLength: 0)
    }
    .fixedSize(horizontal: false, vertical: true)
  }
}

private struct TodoRow: View {
  let item: TodoItem
  var size: CGFloat = 14
  /// Small widget: titles only, as in the design.
  var showDetail = true
  @Environment(\.palette) private var p

  var body: some View {
    HStack(spacing: 5) {
      ZStack {
        if item.done {
          Circle().fill(p.fg)
          Image(systemName: "checkmark").font(.system(size: size * 0.5, weight: .heavy)).foregroundStyle(p.bg)
        } else {
          Circle().strokeBorder(item.kind == .late ? p.late : p.fg, lineWidth: 2)
        }
      }
      .frame(width: size + 1, height: size + 1)
      Text(item.title).font(mono(size)).lineLimit(1).truncationMode(.tail)
        .strikethrough(item.done).foregroundStyle(item.done ? p.secondary : p.fg)
      Spacer(minLength: 0)
      if showDetail, let d = item.detail, !item.done {
        Text(d).font(mono(9, .semibold)).foregroundStyle(item.kind == .late ? p.late : p.secondary).lineLimit(1)
      }
    }
  }
}

private struct More: View {
  let count: Int
  @Environment(\.palette) private var p
  var body: some View {
    if count > 0 { Text("ещё \(count)").font(mono(9, .semibold)).foregroundStyle(p.secondary) }
  }
}

private struct Placeholder: View {
  let title: String
  let subtitle: String
  @Environment(\.palette) private var p

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(title).font(mono(13))
      Text(subtitle).font(mono(9, .semibold)).foregroundStyle(p.secondary).lineLimit(2)
    }
  }
}

private struct PlansList: View {
  let day: DayPlan
  let limit: Int

  var body: some View {
    let shown = Array(day.events.prefix(limit))
    VStack(alignment: .leading, spacing: 6) {
      if shown.isEmpty { Placeholder(title: day.isToday ? "Планов нет" : "Пусто", subtitle: "Скажите ассистенту") }
      ForEach(Array(shown.enumerated()), id: \.offset) { _, e in PlanRow(event: e, now: day.isNow(e)) }
      More(count: day.events.count - shown.count)
    }
  }
}

private struct TodoList: View {
  let day: DayPlan
  let limit: Int
  var size: CGFloat = 13

  var body: some View {
    let open = day.openTodo, done = day.todo.filter(\.done)
    let shown = Array((open + done).prefix(limit))
    VStack(alignment: .leading, spacing: 5) {
      if open.isEmpty && done.isEmpty { Placeholder(title: "Задач нет", subtitle: "Можно отдохнуть") }
      else if open.isEmpty { Placeholder(title: "Всё сделано", subtitle: "Отличный день") }
      ForEach(Array(shown.enumerated()), id: \.offset) { _, t in TodoRow(item: t, size: size) }
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
    case .systemSmall: Painted { SmallView(day: today) }
    case .systemMedium: Painted { MediumView(day: today) }
    case .systemLarge: Painted { LargeView(day: today, tomorrow: DayPlan(entry.snapshot, at: entry.date, dayOffset: 1)) }
    case .accessoryRectangular: RectangularView(day: today)
    case .accessoryCircular: CircularView(day: today)
    default: InlineView(day: today)
    }
  }
}

/// The reference layout: date, the next plan, then tasks.
struct SmallView: View {
  let day: DayPlan

  var body: some View {
    VStack(alignment: .leading, spacing: 7) {
      Header(day: day, size: 24, ring: 24)
      if day.isEmpty {
        Spacer(minLength: 0)
        if day.doneCount > 0 { Placeholder(title: "Всё сделано", subtitle: "Отличный день") }
        else { Placeholder(title: "Свободный день", subtitle: "Скажите ассистенту, что запланировать") }
      } else {
        if let e = day.next { PlanRow(event: e, now: day.isNow(e)) }
        let n = day.next == nil ? 4 : 3
        VStack(alignment: .leading, spacing: 4) {
          ForEach(Array(day.openTodo.prefix(n).enumerated()), id: \.offset) { _, t in TodoRow(item: t, size: 14, showDetail: false) }
        }
        Spacer(minLength: 0)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct MediumView: View {
  let day: DayPlan

  var body: some View {
    HStack(alignment: .top, spacing: 14) {
      VStack(alignment: .leading, spacing: 8) {
        Header(day: day)
        SectionTitle(title: "Планы", badge: day.events.isEmpty ? nil : "\(day.events.count)")
        PlansList(day: day, limit: 2)
        Spacer(minLength: 0)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      VStack(alignment: .leading, spacing: 6) {
        SectionTitle(title: "Задачи", badge: day.openTodo.isEmpty ? nil : "\(day.openTodo.count)")
        TodoList(day: day, limit: 5, size: 13)
        Spacer(minLength: 0)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct LargeView: View {
  let day: DayPlan
  let tomorrow: DayPlan
  @Environment(\.palette) private var p

  var body: some View {
    let plans = min(max(day.events.count, 1), 3)
    VStack(alignment: .leading, spacing: 10) {
      Header(day: day, size: 26)
      VStack(alignment: .leading, spacing: 6) {
        SectionTitle(title: "Планы", badge: day.events.isEmpty ? nil : "\(day.events.count)")
        PlansList(day: day, limit: plans)
      }
      Rectangle().fill(p.faint).frame(height: 1.5)
      VStack(alignment: .leading, spacing: 6) {
        SectionTitle(title: "Задачи", badge: day.openTodo.isEmpty ? nil : "\(day.openTodo.count)")
        TodoList(day: day, limit: 7 - plans, size: 14)
      }
      Spacer(minLength: 0)
      if let e = tomorrow.next {
        HStack(spacing: 6) {
          Text("ЗАВТРА").font(mono(10, .heavy))
          Text("\(e.start) \(e.title)").font(mono(10, .semibold)).lineLimit(1)
          if tomorrow.events.count > 1 { Text("+\(tomorrow.events.count - 1)").font(mono(10, .semibold)).foregroundStyle(p.secondary) }
          Spacer(minLength: 0)
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(p.faint, in: Capsule())
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
            Text(e.start).font(.system(size: 13, weight: .bold, design: .monospaced)).monospacedDigit()
              .fixedSize()
            Capsule().frame(width: 3, height: 13).opacity(now ? 1 : 0.5).widgetAccentable()
            Text(e.title).font(.system(size: 13, weight: now ? .heavy : .semibold, design: .monospaced)).lineLimit(1)
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
    .font(.system(size: 11, weight: .heavy)).opacity(0.75).widgetAccentable()
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
            Text(t.title).font(.system(size: 13, weight: .semibold, design: .monospaced)).lineLimit(1)
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
        Text("\(done)/\(total)").font(.system(size: size * 0.27, weight: .bold, design: .monospaced))
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
