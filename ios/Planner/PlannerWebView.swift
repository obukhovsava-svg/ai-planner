import SwiftUI
import UIKit
import PhotosUI
import EventKit
import WebKit

/// The connection between the interface and iOS: messages from the page
/// (`webkit.messageHandlers.native`) and calls back into it (`window.__planner…`).
final class Bridge: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
  static let shared = Bridge()

  weak var webView: WKWebView?
  private var loaded = false
  private var pendingOpen: String?
  private lazy var speech = Speech { [weak self] event in self?.send(speech: event) }

  /// A notification was tapped: open its item (after the page has loaded, if it's still loading).
  func open(_ target: String) {
    guard loaded else {
      pendingOpen = target
      return
    }
    call("window.__plannerOpen && window.__plannerOpen(\(json(target)))")
  }

  // MARK: messages from the page

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
    switch type {
    case "haptic":
      haptic(kind: body["kind"] as? String ?? "impact", style: body["style"] as? String)
    case "open":
      if let s = body["url"] as? String, let url = URL(string: s) { UIApplication.shared.open(url) }
    case "reminders":
      if let raw = body["items"], let data = try? JSONSerialization.data(withJSONObject: raw),
         let items = try? JSONDecoder().decode([Reminders.Item].self, from: data) {
        Reminders.schedule(items)
      }
    case "widget":
      if let raw = body["snapshot"], let data = try? JSONSerialization.data(withJSONObject: raw, options: .sortedKeys) {
        WidgetStore.save(data)
      }
    case "wallpaper":
      switch body["action"] as? String {
      case "pick": pickWallpaperPhoto()
      case "reset":
        WallpaperStore.reset()
        sendWallpaperState()
      default: sendWallpaperState()
      }
    case "accent":
      if let accent = body["accent"] as? String {
        let tone = body["tone"] as? String ?? "pastel"
        WidgetStore.saveAccent(accent)
        WidgetStore.saveTone(tone)
        // The page reports its colours on every launch; the icon follows only a real choice — not
        // the very first report (iOS would greet a new user with an "icon changed" note).
        let icon = "\(accent)\(tone == "dark" ? "-dark" : "")"
        let defaults = UserDefaults(suiteName: WidgetStore.group)
        if let last = defaults?.string(forKey: "icon"), last != icon { setAppIcon(accent: accent, dark: tone == "dark") }
        defaults?.set(icon, forKey: "icon")
      }
    case "calendar":
      readCalendars(prompt: body["prompt"] as? Bool ?? false, hidden: Set(body["hidden"] as? [String] ?? []), ops: body["ops"] as? [[String: Any]] ?? [])
    case "aiConsent":
      WidgetStore.saveAiConsent(body["on"] as? Bool ?? false)
    case "theme":
      // Read by PlannerApp (@AppStorage) → the window starts in this theme next time, no flash.
      UserDefaults.standard.set(body["mode"] as? String ?? "", forKey: "theme")
    case "speech":
      switch body["action"] as? String {
      case "start": speech.start()
      case "stop": speech.stop()
      default: speech.cancel()
      }
    default:
      break
    }
  }

  private func haptic(kind: String, style: String?) {
    switch kind {
    case "notify":
      let type: UINotificationFeedbackGenerator.FeedbackType = style == "success" ? .success : style == "error" ? .error : .warning
      UINotificationFeedbackGenerator().notificationOccurred(type)
    case "selection":
      UISelectionFeedbackGenerator().selectionChanged()
    default:
      let s: UIImpactFeedbackGenerator.FeedbackStyle = switch style {
      case "medium": .medium
      case "heavy": .heavy
      case "rigid": .rigid
      case "soft": .soft
      default: .light
      }
      UIImpactFeedbackGenerator(style: s).impactOccurred()
    }
  }

  private func send(speech event: Speech.Event) {
    let payload: [String: Any] = switch event {
    case .level(let v): ["type": "level", "value": (v * 100).rounded() / 100]
    case .interim(let t): ["type": "interim", "text": t]
    case .final(let t): ["type": "final", "text": t]
    case .error(let m): ["type": "error", "message": m]
    case .end: ["type": "end"]
    }
    guard let data = try? JSONSerialization.data(withJSONObject: payload), let s = String(data: data, encoding: .utf8) else { return }
    call("window.__plannerSpeech && window.__plannerSpeech(\(s))")
  }

  // MARK: navigation — our pages stay inside, everything else opens in Safari

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
    guard let url = action.request.url else { return .cancel }
    if url.scheme == "planner" || url.scheme == "about" { return .allow }
    await UIApplication.shared.open(url)
    return .cancel
  }

  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url { UIApplication.shared.open(url) }
    return nil
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    loaded = true
    webView.hideInputAccessoryBar()
    #if DEBUG
    // Development only: `PLANNER_TEST_JS` (passed with `simctl launch`) runs a script inside the
    // page and prints its result — lets the app be tested end to end from the command line.
    if let script = ProcessInfo.processInfo.environment["PLANNER_TEST_JS"] {
      webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
        switch result {
        case .success(let value): print("PLANNER_TEST_RESULT:", value as Any)
        case .failure(let error): print("PLANNER_TEST_ERROR:", error)
        }
        fflush(stdout)
      }
    }
    #endif
    if let target = pendingOpen {
      pendingOpen = nil
      open(target)
    }
  }

  /// The web process can be killed in the background — reload instead of showing a blank page.
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    loaded = false
    webView.reload()
  }

  fileprivate func sendCalendars(_ json: String) {
    call("window.__plannerCalendar && window.__plannerCalendar(\(json))")
  }

  fileprivate func calendarsChanged() {
    call("window.__plannerCalendarChanged && window.__plannerCalendarChanged()")
  }

  private func call(_ js: String) {
    webView?.evaluateJavaScript(js, completionHandler: nil)
  }

  private func json(_ s: String) -> String {
    let data = try? JSONSerialization.data(withJSONObject: [s])
    let arr = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
    return String(arr.dropFirst().dropLast())
  }
}

/// Avoids the retain cycle between WKUserContentController and the bridge.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
  weak var target: (any WKScriptMessageHandler)?
  init(_ target: any WKScriptMessageHandler) { self.target = target }
  func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
    target?.userContentController(c, didReceive: m)
  }
}

/// Keeps the page's own scroll view at the top (see makeUIView).
private var pin: NSKeyValueObservation?

struct PlannerWebView: UIViewRepresentable {
  func makeUIView(context: Context) -> WKWebView {
    let bridge = Bridge.shared
    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: "planner")
    config.allowsInlineMediaPlayback = true
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
    #if targetEnvironment(macCatalyst)
    // the Mac can't show iOS pickers (a native time / date field crashes the app): the page swaps them
    let platform = "mac"
    #else
    let platform = "ios"
    #endif
    let boot = "window.PlannerNative = { platform: '\(platform)', deviceKey: '\(DeviceKey.value)', version: '\(version)' };"
    config.userContentController.addUserScript(WKUserScript(source: boot, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    config.userContentController.add(WeakHandler(bridge), name: "native")

    let webView = WKWebView(frame: .zero, configuration: config)
    webView.navigationDelegate = bridge
    webView.uiDelegate = bridge
    webView.isOpaque = false
    webView.backgroundColor = .systemGroupedBackground
    webView.underPageBackgroundColor = .systemGroupedBackground
    // The page lays itself out with env(safe-area-inset-*) and scrolls inside its own panes.
    webView.scrollView.contentInsetAdjustmentBehavior = .never
    webView.scrollView.bounces = false
    // The page itself never scrolls (its lists scroll inside it): no dragging the whole interface
    // around, and WebKit's "scroll the focused field into view" can't shift it either.
    webView.scrollView.isScrollEnabled = false
    webView.scrollView.showsVerticalScrollIndicator = false
    webView.scrollView.showsHorizontalScrollIndicator = false
    pin = webView.scrollView.observe(\.contentOffset, options: [.new]) { scroll, _ in
      MainActor.assumeIsolated {
        if scroll.contentOffset != .zero { scroll.contentOffset = .zero }
      }
    }
    // iOS 26+: no "liquid glass" edge effect over the page — it bends our own header and tab bar.
    webView.hideScrollEdgeEffects()
    webView.allowsBackForwardNavigationGestures = false
    #if DEBUG
    webView.isInspectable = true
    #endif
    bridge.webView = webView
    webView.load(URLRequest(url: URL(string: "planner://app/index.html")!))
    return webView
  }

  func updateUIView(_ webView: WKWebView, context: Context) {}
}

extension WKWebView {
  /// iOS 26+ draws a "glass" pocket at the scroll view's edges; the page has its own translucent
  /// header and tab bar, so the page's scroll view shouldn't add one on top.
  func hideScrollEdgeEffects() {
    guard #available(iOS 26.0, *) else { return }
    scrollView.topEdgeEffect.isHidden = true
    scrollView.bottomEdgeEffect.isHidden = true
  }

  /// Native apps don't show Safari's "up / down / ✓" bar above the keyboard.
  func hideInputAccessoryBar() {
    guard let content = scrollView.subviews.first(where: { String(describing: type(of: $0)).hasPrefix("WKContent") }),
          let base: AnyClass = object_getClass(content) else { return }
    let name = "\(NSStringFromClass(base))_NoAccessoryBar"
    var subclass: AnyClass? = NSClassFromString(name)
    if subclass == nil, let made = objc_allocateClassPair(base, name, 0) {
      let none: @convention(block) (AnyObject) -> AnyObject? = { _ in nil }
      class_addMethod(made, #selector(getter: UIResponder.inputAccessoryView), imp_implementationWithBlock(none), "@@:")
      objc_registerClassPair(made)
      subclass = made
    }
    if let subclass { object_setClass(content, subclass) }
  }
}


// MARK: - Meetings from the device's calendars

/// Outlook, iCloud, Google… whatever is connected to the device. The page turns the meetings into
/// planner events (a month back, three ahead, or the synced document grows too big) and sends back
/// what was moved, edited or deleted there.
private let eventStore = EKEventStore()
private var watchingCalendars = false

extension Bridge {
  func readCalendars(prompt: Bool, hidden: Set<String>, ops: [[String: Any]] = []) {
    Task { @MainActor in
      var granted = EKEventStore.authorizationStatus(for: .event) == .fullAccess
      if !granted && prompt { granted = (try? await eventStore.requestFullAccessToEvents()) ?? false }
      if granted && !watchingCalendars {
        watchingCalendars = true
        NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: eventStore, queue: .main) { [weak self] _ in
          MainActor.assumeIsolated { self?.calendarsChanged() }
        }
      }
      if granted && !ops.isEmpty { Self.apply(ops) }
      let payload = granted ? await Task.detached { Self.calendarPayload(hidden: hidden) }.value : ["granted": false, "calendars": [], "events": []]
      guard let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
      sendCalendars(json)
    }
  }

  /// Moves, edits and deletes from the planner. One occurrence only, never the whole series.
  private static func apply(_ ops: [[String: Any]]) {
    let parse = DateFormatter()
    parse.locale = Locale(identifier: "en_US_POSIX")
    parse.dateFormat = "yyyy-MM-dd HH:mm"
    for op in ops {
      guard let ref = op["ref"] as? [String: Any], let eid = ref["eid"] as? String, let stamp = ref["at"] as? Double else { continue }
      let at = Date(timeIntervalSince1970: stamp)
      let near = eventStore.predicateForEvents(withStart: at.addingTimeInterval(-1), end: at.addingTimeInterval(1), calendars: nil)
      guard let ev = eventStore.events(matching: near).first(where: { $0.eventIdentifier == eid && $0.startDate == at }) else { continue }
      if op["op"] as? String == "remove" {
        try? eventStore.remove(ev, span: .thisEvent, commit: false)
        continue
      }
      guard let date = op["date"] as? String, let start = op["start"] as? String, let end = op["end"] as? String,
            let from = parse.date(from: "\(date) \(start)"), let to = parse.date(from: "\(date) \(end)") else { continue }
      ev.title = op["title"] as? String ?? ev.title
      ev.startDate = from
      ev.endDate = to
      if let note = op["note"] as? String { ev.notes = note.isEmpty ? nil : note }
      try? eventStore.save(ev, span: .thisEvent, commit: false)
    }
    try? eventStore.commit()
  }

  private nonisolated static func calendarPayload(hidden: Set<String>) -> [String: Any] {
    // Not the planner's own subscription (its events are already here) and not birthdays.
    let calendars = eventStore.calendars(for: .event).filter { $0.type != .birthday && !($0.type == .subscription && $0.title == "Планер") }
    let shown = calendars.filter { !hidden.contains($0.calendarIdentifier) }
    var events: [[String: Any]] = []
    let cal = Calendar.current
    let today = cal.startOfDay(for: Date())
    if !shown.isEmpty, let from = cal.date(byAdding: .month, value: -1, to: today), let to = cal.date(byAdding: .month, value: 3, to: today) {
      let day = DateFormatter(), time = DateFormatter()
      day.locale = Locale(identifier: "en_US_POSIX")
      time.locale = day.locale
      day.dateFormat = "yyyy-MM-dd"
      time.dateFormat = "HH:mm"
      for ev in eventStore.events(matching: eventStore.predicateForEvents(withStart: from, end: to, calendars: shown)).sorted(by: { $0.startDate < $1.startDate }) {
        if ev.status == .canceled || ev.attendees?.first(where: \.isCurrentUser)?.participantStatus == .declined { continue }
        // A meeting over several days becomes one piece per day.
        // Stays the same when the meeting is moved, so a move isn't a delete and a new meeting.
        let base = "device:\(ev.calendarItemExternalIdentifier ?? ev.eventIdentifier ?? UUID().uuidString)"
        let id = ev.hasRecurrenceRules || ev.isDetached ? "\(base):\(ev.occurrenceDate.timeIntervalSince1970)" : base
        let multiDay = cal.startOfDay(for: ev.startDate) != cal.startOfDay(for: ev.endDate.addingTimeInterval(-1))
        // Invitations belong to the organizer; whole-day and multi-day ones don't fit the planner's fields.
        let invited = ev.hasAttendees && ev.organizer?.isCurrentUser != true
        let readOnly = !ev.calendar.allowsContentModifications || invited || ev.isAllDay || multiDay
        var d = cal.startOfDay(for: ev.startDate)
        while d < ev.endDate || d == cal.startOfDay(for: ev.startDate), events.count < 400 {
          guard let next = cal.date(byAdding: .day, value: 1, to: d) else { break }
          let key = day.string(from: d)
          var item: [String: Any] = [
            "id": id + (multiDay ? ":\(key)" : ""),
            "title": ev.title?.isEmpty == false ? ev.title! : "Без названия",
            "date": key,
            "start": ev.startDate > d ? time.string(from: ev.startDate) : "00:00",
            "end": ev.endDate < next ? time.string(from: ev.endDate) : "23:59",
            "color": "violet",
            "ref": ["eid": ev.eventIdentifier ?? "", "at": ev.startDate.timeIntervalSince1970],
            "modified": (ev.lastModifiedDate ?? .distantPast).timeIntervalSince1970 * 1000,
          ]
          var device: [String: Any] = ["calendar": ev.calendar.title, "allDay": ev.isAllDay, "readOnly": readOnly, "noteCut": (ev.notes?.count ?? 0) > 20000]
          if let place = ev.location, !place.isEmpty { device["location"] = place }
          // whole: the page cuts it down, and the link to join is often at the very end
          if let notes = ev.notes, !notes.isEmpty { item["note"] = String(notes.prefix(20000)) }
          if let url = ev.url { item["url"] = url.absoluteString }
          item["device"] = device
          events.append(item)
          d = next
        }
      }
    }
    return [
      "granted": true,
      "calendars": calendars.map { ["id": $0.calendarIdentifier, "title": $0.title, "source": $0.source?.title ?? ""] },
      "events": events,
    ]
  }
}


// MARK: - Wallpaper photo

extension Bridge: PHPickerViewControllerDelegate {
  func pickWallpaperPhoto() {
    var config = PHPickerConfiguration()
    config.filter = .images
    config.selectionLimit = 1
    let picker = PHPickerViewController(configuration: config)
    picker.delegate = self
    var top = webView?.window?.rootViewController
    while let presented = top?.presentedViewController { top = presented }
    top?.present(picker, animated: true)
  }

  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    picker.dismiss(animated: true)
    guard let provider = results.first?.itemProvider, provider.canLoadObject(ofClass: UIImage.self) else { return }
    provider.loadObject(ofClass: UIImage.self) { object, _ in
      guard let image = object as? UIImage else { return }
      Task { @MainActor in
        WallpaperStore.save(image)
        self.sendWallpaperState()
      }
    }
  }

  /// Tells the page whether a photo is set and sends a small preview of the wallpaper.
  func sendWallpaperState() {
    let preview = WallpaperRenderer.render(scale: 1)?.jpegData(compressionQuality: 0.8).map { "data:image/jpeg;base64,\($0.base64EncodedString())" }
    var payload: [String: Any] = ["hasPhoto": WallpaperStore.hasPhoto]
    if let preview { payload["preview"] = preview }
    guard let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
    call("window.__plannerWallpaper && window.__plannerWallpaper(\(json))")
  }
}


/// The home-screen icon in the widget's colours: the accent, pastel or dark (Настройки → Фон
/// виджета). The main icon is light blue («Голубой»), and every colour is an alternate «AppIcon-<accent>[-dark]».
/// iOS shows its own "icon changed" note — so this runs only on a real change.
@MainActor
func setAppIcon(accent: String, dark: Bool) {
  let app = UIApplication.shared
  guard app.supportsAlternateIcons else { return }
  let known = ["blue", "sage", "lime", "mist", "pink", "red", "yellow", "milk"]
  guard known.contains(accent) else { return }
  let wanted = "AppIcon-\(accent)\(dark ? "-dark" : "")"
  guard app.alternateIconName != wanted else { return }
  app.setAlternateIconName(wanted) { error in
    if let error { print("app icon:", error.localizedDescription) }
  }
}
