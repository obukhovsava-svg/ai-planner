import AVFoundation
let a = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
let s = DispatchSemaphore(value: 0)
Task {
  let d = try await a.load(.duration)
  let t = try await a.loadTracks(withMediaType: .video)[0]
  let sz = try await t.load(.naturalSize), fps = try await t.load(.nominalFrameRate), tr = try await t.load(.preferredTransform)
  print("dur", d.seconds, "size", sz, "fps", fps, "tr", tr)
  s.signal()
}
s.wait()
