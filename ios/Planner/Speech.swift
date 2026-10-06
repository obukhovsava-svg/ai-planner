import AVFoundation
import Speech

/// Russian speech-to-text for the assistant's microphone (Apple's recognizer, on-device when
/// available). Streams partial text, finishes by itself after a short pause, like dictation.
final class Speech {
  enum Event {
    case interim(String)
    case final(String)
    case error(String)
    case end
  }

  private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "ru-RU"))
  private let engine = AVAudioEngine()
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var text = ""
  private var silence: Timer?
  private var finished = true
  private let emit: (Event) -> Void

  init(emit: @escaping (Event) -> Void) { self.emit = emit }

  func start() {
    cancel()
    Task {
      let speechOK = await withCheckedContinuation { c in SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0 == .authorized) } }
      let micOK = await AVAudioApplication.requestRecordPermission()
      guard speechOK, micOK else {
        emit(.error("Нет доступа к микрофону — разрешите его в Настройках"))
        emit(.end)
        return
      }
      guard let recognizer, recognizer.isAvailable else {
        emit(.error("Распознавание речи сейчас недоступно"))
        emit(.end)
        return
      }
      do { try begin(recognizer) } catch {
        emit(.error("Микрофон занят"))
        emit(.end)
      }
    }
  }

  private func begin(_ recognizer: SFSpeechRecognizer) throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.record, mode: .measurement, options: .duckOthers)
    try session.setActive(true, options: .notifyOthersOnDeactivation)

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
    request.addsPunctuation = false
    self.request = request
    text = ""
    finished = false

    let input = engine.inputNode
    Speech.installTap(on: input, feeding: request)
    engine.prepare()
    try engine.start()

    task = recognizer.recognitionTask(with: request, resultHandler: Speech.handler { [weak self] text, isFinal, failed in
      guard let self, !self.finished else { return }
      if let text, !text.isEmpty {
        self.text = text
        self.emit(.interim(text))
        self.armSilenceTimer()
      }
      if isFinal || failed { self.finish() }
    })
    armSilenceTimer(seconds: 6) // nothing said at all → give up after a while
  }

  /// Stop listening and deliver what was heard.
  func stop() {
    guard !finished else { return }
    request?.endAudio()
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in self?.finish() }
  }

  func cancel() {
    finished = true
    teardown()
  }

  private func armSilenceTimer(seconds: Double = 1.4) {
    silence?.invalidate()
    silence = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in
      MainActor.assumeIsolated { self?.stop() }
    }
  }

  private func finish() {
    guard !finished else { return }
    finished = true
    teardown()
    emit(.final(text))
    emit(.end)
  }

  private func teardown() {
    silence?.invalidate()
    silence = nil
    if engine.isRunning { engine.stop() }
    engine.inputNode.removeTap(onBus: 0)
    request?.endAudio()
    task?.cancel()
    request = nil
    task = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  // Audio and recognition callbacks arrive off the main thread: built outside the actor.
  nonisolated private static func installTap(on input: AVAudioInputNode, feeding request: SFSpeechAudioBufferRecognitionRequest) {
    input.removeTap(onBus: 0)
    input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
      request.append(buffer)
    }
  }

  nonisolated private static func handler(_ main: @escaping @MainActor (String?, Bool, Bool) -> Void) -> @Sendable (SFSpeechRecognitionResult?, (any Error)?) -> Void {
    { result, error in
      let text = result?.bestTranscription.formattedString
      let isFinal = result?.isFinal ?? false
      let failed = error != nil
      DispatchQueue.main.async { main(text, isFinal, failed) }
    }
  }
}
