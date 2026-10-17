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
        #if targetEnvironment(macCatalyst)
        // flexible both ways, so the Mac window can be dragged to any size
        .frame(minWidth: 390, maxWidth: .infinity, minHeight: 600, maxHeight: .infinity)
        #endif
        // Edge to edge (the page handles the notch and home indicator itself), but the keyboard
        // still shrinks the view — so the page fits above it instead of growing a scrollable gap.
        .ignoresSafeArea(.container)
        .background(Color(uiColor: .systemGroupedBackground))
        .preferredColorScheme(theme == "dark" ? .dark : theme == "light" ? .light : nil)
        // A tap on the home-screen widget: planerapp://d/2026-10-06 → that day's plan.
        .onOpenURL { url in
          if url.host == "d" { Bridge.shared.open("d:" + url.lastPathComponent) }
        }
        #if targetEnvironment(macCatalyst)
        // On the Mac the window is free to grow up to full screen: from 960 pt wide the page shows
        // the calendar and tasks side by side with the assistant on its own tab; narrower, it's the phone layout.
        .onAppear {
          for case let scene as UIWindowScene in UIApplication.shared.connectedScenes {
            scene.sizeRestrictions?.minimumSize = CGSize(width: 390, height: 600)
            // any width, but never taller than the screen minus the menu bar and the Dock: a taller window
            // runs under the Dock and hides the bottom of the page (the assistant's input, the tab bar)
            let screen = scene.screen.bounds.size
            scene.sizeRestrictions?.maximumSize = CGSize(width: max(1600, screen.width * 2), height: max(700, screen.height - 150))
            scene.titlebar?.titleVisibility = .hidden
          }
        }
        #endif
    }
    #if targetEnvironment(macCatalyst)
    .defaultSize(width: 1280, height: 780)
    .windowResizability(.contentMinSize)
    #endif
  }
}
