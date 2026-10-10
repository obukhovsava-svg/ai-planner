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
    guard let image = WallpaperRenderer.render(), let data = image.pngData() else {
      throw IntentError.message("Не получилось нарисовать обои")
    }
    return .result(value: IntentFile(data: data, filename: "plan-wallpaper.png", type: .png))
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
    struct Reply: Decodable {
      let answer: String
      let reminders: [Reminders.Item]?
    }
    do {
      let (data, _) = try await URLSession.shared.data(for: request)
      let reply = try JSONDecoder().decode(Reply.self, from: data)
      // New reminders become the app's own notifications right away, even if it isn't opened.
      if let items = reply.reminders { Reminders.schedule(items) }
      return .result(dialog: IntentDialog(stringLiteral: reply.answer))
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
