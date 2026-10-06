# Планер для iOS

Нативное приложение (Swift, Xcode 27) с тем же интерфейсом, что и мини-приложение в Telegram.
Интерфейс встроен в приложение (`Planner/Web/index.html`) и работает без интернета.

Нативное:
- **уведомления** — локальные, от имени приложения (`Reminders.swift`), нажатие открывает нужное дело;
- **распознавание речи** — Apple Speech, на устройстве (`Speech.swift`);
- **вибрация** — системная;
- **без регистрации** — при первом запуске создаётся секретный ключ устройства в Keychain
  (`DeviceKey.swift`); по нему работают синхронизация, нейросеть и команда iPhone.

## Сборка
1. Обновить интерфейс после изменений в `src/`: `python3 scripts/build-ios-web.py` (из корня репозитория).
2. Открыть `ios/Planner.xcodeproj`.
3. Planner → Signing & Capabilities → Team: выбрать свой Apple ID.
4. Выбрать iPhone и нажать ▶︎.

С бесплатным Apple ID приложение работает на своём iPhone 7 дней, потом нужно запустить из Xcode снова.
Для App Store и TestFlight нужен Apple Developer Program.

## Отладка
В сборке Debug переменная окружения `PLANNER_TEST_JS` выполняет скрипт внутри страницы
и печатает результат (`PLANNER_TEST_RESULT:`), например:
`SIMCTL_CHILD_PLANNER_TEST_JS='return document.title' xcrun simctl launch --console-pty booted com.obukhov.planner`
