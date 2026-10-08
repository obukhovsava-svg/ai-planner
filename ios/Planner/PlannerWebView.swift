import SwiftUI
import UIKit
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
    let boot = "window.PlannerNative = { platform: 'ios', deviceKey: '\(DeviceKey.value)', version: '\(version)' };"
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
