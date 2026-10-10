import AppIntents
import Foundation
import UIKit

/// «Обои ПЛАН»: draws the lock-screen wallpaper (today's plans + tasks) and hands it to the
/// Shortcut, whose next step is the built-in «Установить обои».
struct UpdateWallpaperIntent: AppIntent {
  static let title: LocalizedStringResource = "Обои ПЛАН"
  static let description = IntentDescription("Рисует обои экрана блокировки: слева планы на сегодня, справа задачи.")
  static let openAppWhenRun = false

  @MainActor
  func perform() async throws -> some IntentResult & ReturnsValue<IntentFile> {
    // Fresh data first (changes from Telegram, the voice button…), then draw. Offline → last known.
    await BackgroundSync.refresh(timeout: 6)
    // JPEG: ~7× smaller than PNG — «Установить обои» running in the background copes better.
    guard let image = WallpaperRenderer.render(), let data = image.jpegData(compressionQuality: 0.9) else {
      throw IntentError.message("Не получилось нарисовать обои")
    }
    return .result(value: IntentFile(data: data, filename: "plan-wallpaper.jpg", type: .jpeg))
  }
}

/// «Добавить в ПЛАН»: a phrase like «созвон завтра в три, напомни за час» goes to the assistant;
/// works with the app closed (Siri, the Action button, a Home-screen icon).
struct AddToPlanIntent: AppIntent {
  static let title: LocalizedStringResource = "Добавить в ПЛАН"
  static let description = IntentDescription("Скажите дело — ассистент сам поставит его в календарь или задачи и напомнит.")
  static let openAppWhenRun = false

  @Parameter(title: "Что добавить", requestValueDialog: "Что добавить в план?")
  var text: String

  @MainActor
  func perform() async throws -> some IntentResult & ProvidesDialog {
    var request = URLRequest(url: URL(string: "https://ai-planner-brain.savelyobuhov.workers.dev/shortcut/device")!)
    request.httpMethod = "POST"
    request.timeoutInterval = 25
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(DeviceKey.value, forHTTPHeaderField: "X-Device-Key")
    let tz = -TimeZone.current.secondsFromGMT() / 60 // same sign as JS getTimezoneOffset()
    request.httpBody = try JSONSerialization.data(withJSONObject: ["text": text, "tz": tz])
    do {
      let (data, _) = try await URLSession.shared.data(for: request)
      guard let reply = try JSONSerialization.jsonObject(with: data) as? [String: Any], let answer = reply["answer"] as? String else {
        return .result(dialog: "Нет связи с сервером — попробуйте ещё раз.")
      }
      // New reminders become the app's own notifications right away, and the widgets update,
      // even if the app isn't opened.
      BackgroundSync.apply(snapshot: reply["snapshot"].flatMap { $0 is NSNull ? nil : $0 }, reminders: reply["reminders"].flatMap { $0 is NSNull ? nil : $0 })
      return .result(dialog: IntentDialog(stringLiteral: answer))
    } catch {
      return .result(dialog: "Нет связи с сервером — попробуйте ещё раз.")
    }
  }
}

enum IntentError: Error, CustomLocalizedStringResourceConvertible {
  case message(String)
  var localizedStringResource: LocalizedStringResource {
    switch self {
    case .message(let m): LocalizedStringResource(stringLiteral: m)
    }
  }
}

/// Both actions show up in «Команды», Siri and Spotlight as soon as the app is installed.
struct PlannerShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: AddToPlanIntent(),
      phrases: ["Добавь в \(.applicationName)", "Запиши в \(.applicationName)", "\(.applicationName)"],
      shortTitle: "Добавить в план",
      systemImageName: "mic.fill"
    )
    AppShortcut(
      intent: UpdateWallpaperIntent(),
      phrases: ["Обнови обои \(.applicationName)"],
      shortTitle: "Обои ПЛАН",
      systemImageName: "photo.on.rectangle"
    )
  }
}
