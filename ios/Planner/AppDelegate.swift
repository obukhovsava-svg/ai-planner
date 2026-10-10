import UIKit
import UserNotifications

/// Shows reminders while the app is open and opens the right screen when one is tapped.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    #if DEBUG
    // PLANNER_TEST_INTENT=wallpaper|add — runs a Shortcuts action in-process and prints the outcome.
    if let which = ProcessInfo.processInfo.environment["PLANNER_TEST_INTENT"] {
      Task { @MainActor in
        do {
          if which == "wallpaper" {
            let image = WallpaperRenderer.render()
            print("PLANNER_INTENT_RESULT: wallpaper", image.map { "\($0.size) jpeg=\($0.jpegData(compressionQuality: 0.9)?.count ?? -1)" } ?? "nil")
            _ = try await UpdateWallpaperIntent().perform()
            print("PLANNER_INTENT_RESULT: wallpaper perform ok")
          } else {
            var intent = AddToPlanIntent()
            intent.text = ProcessInfo.processInfo.environment["PLANNER_TEST_TEXT"] ?? "проверка завтра в 10"
            _ = try await intent.perform()
            print("PLANNER_INTENT_RESULT: add perform ok")
          }
        } catch {
          print("PLANNER_INTENT_RESULT: error", error)
        }
        fflush(stdout)
      }
    }
    #endif
    return true
  }

  nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
    [.banner, .list, .sound]
  }

  nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
    guard let target = response.notification.request.content.userInfo["open"] as? String else { return }
    await MainActor.run { Bridge.shared.open(target) }
  }
}
