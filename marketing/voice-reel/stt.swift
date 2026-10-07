import Foundation
import Speech
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let done = DispatchSemaphore(value: 0)
SFSpeechRecognizer.requestAuthorization { st in
  print("auth", st.rawValue)
  guard st == .authorized, let r = SFSpeechRecognizer(locale: Locale(identifier: "ru-RU")) else { done.signal(); return }
  let req = SFSpeechURLRecognitionRequest(url: url)
  req.requiresOnDeviceRecognition = r.supportsOnDeviceRecognition
  req.shouldReportPartialResults = false
  req.addsPunctuation = true
  r.recognitionTask(with: req) { res, err in
    if let err { print("ERR", err); done.signal(); return }
    guard let res, res.isFinal else { return }
    for s in res.bestTranscription.segments { print(String(format: "%.2f\t%.2f\t%@", s.timestamp, s.duration, s.substring)) }
    done.signal()
  }
}
while done.wait(timeout: .now() + 0.1) == .timedOut { RunLoop.main.run(until: Date().addingTimeInterval(0.1)) }
