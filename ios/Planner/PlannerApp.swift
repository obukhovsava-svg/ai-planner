import SwiftUI

/// Планер — the planner as an iOS app. The interface is the same one the Telegram Mini App
/// uses (bundled in Web/index.html, works offline); notifications, speech recognition,
/// haptics and the account (a device key in the Keychain, no sign-up) are native.
@main
struct PlannerApp: App {
  @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
  /// The theme chosen in the planner ("light" / "dark"; empty = follow the system).
  @AppStorage("theme") private var theme = ""

  var body: some Scene {
    WindowGroup {
      PlannerWebView()
        // Edge to edge (the page handles the notch and home indicator itself), but the keyboard
        // still shrinks the view — so the page fits above it instead of growing a scrollable gap.
        .ignoresSafeArea(.container)
        .background(Color(uiColor: .systemGroupedBackground))
        .preferredColorScheme(theme == "dark" ? .dark : theme == "light" ? .light : nil)
        // A tap on the home-screen widget: planerapp://d/2026-10-06 → that day's plan.
        .onOpenURL { url in
          if url.host == "d" { Bridge.shared.open("d:" + url.lastPathComponent) }
        }
    }
  }
}
