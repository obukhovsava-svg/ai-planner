import SwiftUI

/// Планер — the planner as an iOS app. The interface is the same one the Telegram Mini App
/// uses (bundled in Web/index.html, works offline); notifications, speech recognition,
/// haptics and the account (a device key in the Keychain, no sign-up) are native.
@main
struct PlannerApp: App {
  @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

  var body: some Scene {
    WindowGroup {
      PlannerWebView()
        .ignoresSafeArea()
        .background(Color(uiColor: .systemGroupedBackground))
    }
  }
}
