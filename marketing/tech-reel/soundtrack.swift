// Original soundtrack for planner-tech-reel.mp4: a 120 BPM electronic beat plus UI sounds
// synced to the animation in tech.html, then muxed into the video (AAC).
//
// build: swiftc -O soundtrack.swift -o soundtrack
// run:   ./soundtrack <video.mp4> <out-with-music.mp4> <out-sfx-only.mp4>
import AVFoundation
import Foundation

let SR = 44_100.0
let DUR = 17.5
let N = Int(SR * DUR)
var music = [Float](repeating: 0, count: N * 2) // interleaved stereo
var sfx = [Float](repeating: 0, count: N * 2)

var seed: UInt32 = 7
func noise() -> Float {
  seed = seed &* 1_664_525 &+ 1_013_904_223
  return Float(Int32(bitPattern: seed)) / Float(Int32.max)
}
func add(_ buf: inout [Float], _ at: Double, _ len: Double, pan: Float = 0, _ gen: (Double, Double) -> Float) {
  let start = Int(at * SR)
  let count = Int(len * SR)
  let l = (1 - max(0, pan)), r = (1 + min(0, pan))
  for i in 0..<count {
    let n = start + i
    if n < 0 || n >= N { continue }
    let t = Double(i) / SR
    let v = gen(t, Double(i) / Double(count))
    buf[2 * n] += v * l
    buf[2 * n + 1] += v * r
  }
}
let tau = 2 * Double.pi
func note(_ midi: Double) -> Double { 440 * pow(2, (midi - 69) / 12) }

// ---------------------------------------------------------------- music (A minor: Am – F – C – G)
let beat = 0.5
let chords: [[Double]] = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]
let roots: [Double] = [45, 41, 48, 43]
func chord(at t: Double) -> Int { Int(max(0, t) / (beat * 4)) % 4 }

// pad: detuned saws softened (sum of a few harmonics), slow swell, whole track
for bar in 0..<9 {
  let at = Double(bar) * beat * 4
  let c = chords[bar % 4]
  add(&music, at, beat * 4 + 0.3) { t, x in
    let env = Float(min(1, t / 0.6) * min(1, (beat * 4 + 0.3 - t) / 0.4))
    var v: Float = 0
    for (k, m) in c.enumerated() {
      for d in [-0.08, 0.08] {
        let f = note(m + 12 + d)
        v += Float(sin(tau * f * t) + 0.35 * sin(tau * 2 * f * t) + 0.15 * sin(tau * 3 * f * t)) * (k == 0 ? 0.9 : 0.7)
      }
    }
    _ = x
    return v * env * 0.018
  }
}

// kick on every beat 4.5 … 15.0 (the drop comes when the AI starts parsing)
var kt = 4.5
while kt < 15.0 {
  add(&music, kt, 0.32) { t, _ in
    let f = 45 + 110 * exp(-t * 28)
    let ph = tau * (45 * t + 110 * (1 - exp(-t * 28)) / 28)
    _ = f
    return Float(sin(ph) * exp(-t * 9)) * 0.34
  }
  kt += beat
}
// clap/snare on beats 2 and 4
var st = 5.0
while st < 15.0 {
  add(&music, st, 0.18) { t, _ in Float(Double(noise()) * exp(-t * 26) + sin(tau * 190 * t) * exp(-t * 40) * 0.4) * 0.16 }
  st += beat * 2
}
// hats: off-beats from 1.0, sixteenths after the drop
var ht = 1.0
while ht < 15.2 {
  let dense = ht >= 4.5
  let pan: Float = Int(ht / 0.25) % 2 == 0 ? -0.35 : 0.35
  add(&music, ht, 0.05, pan: pan) { t, _ in
    var last: Float = 0
    let n = noise()
    let hp = n - last
    last = n
    return hp * Float(exp(-t * 90)) * (dense ? 0.05 : 0.035)
  }
  ht += dense ? beat / 2 : beat
}
// bass: rolling eighths on the chord root
var bt = 4.5
while bt < 15.0 {
  let r = note(roots[chord(at: bt)] - 12 + 12)
  let octave = Int((bt - 4.5) / (beat / 2)) % 2 == 1
  add(&music, bt, beat / 2) { t, x in
    let f = r * (octave ? 2 : 1)
    let env = Float(min(1, t / 0.005) * (1 - x) * (1 - x))
    return Float(sin(tau * f * t) + 0.3 * sin(tau * 2 * f * t)) * env * 0.13
  }
  bt += beat / 2
}
// pluck arpeggio in the "result" scene (9.0 … 15.0)
var at = 9.0
var step = 0
while at < 15.0 {
  let c = chords[chord(at: at)]
  let m = c[step % 3] + 24 + (step % 6 >= 3 ? 12 : 0)
  add(&music, at, 0.3, pan: step % 2 == 0 ? -0.4 : 0.4) { t, _ in
    let f = note(m)
    return Float((sin(tau * f * t) + 0.25 * sin(tau * 3 * f * t)) * exp(-t * 14)) * 0.05
  }
  at += beat / 2
  step += 1
}
// final impact + shimmer for the CTA (15.3)
add(&music, 15.3, 2.2) { t, _ in
  let ph = tau * (38 * t + 140 * (1 - exp(-t * 14)) / 14)
  return Float(sin(ph) * exp(-t * 2.2)) * 0.6 + Float(Double(noise()) * exp(-t * 7)) * 0.12
}
for (k, m) in [69.0, 72, 76, 81].enumerated() {
  add(&music, 15.45 + Double(k) * 0.07, 2.0, pan: Float(k % 2 == 0 ? -0.3 : 0.3)) { t, _ in
    Float(sin(tau * note(m + 12) * t) * exp(-t * 1.6)) * 0.05
  }
}

// ---------------------------------------------------------------- UI sounds (same timeline as tech.html)
func ease(_ x: Double) -> Double { 1 - pow(1 - x, 3) }
// typing: one tick per character typed (0.4 … 3.2 s, eased like the text)
let phraseLength = 53
var lastTyped = 0
var tt = 0.4
while tt <= 3.2 {
  let typed = Int(Double(phraseLength) * ease((tt - 0.4) / 2.8))
  if typed > lastTyped {
    let pitch = 2400 + Double(noise()) * 500
    add(&sfx, tt, 0.03, pan: Float(noise()) * 0.3) { t, _ in Float(sin(tau * pitch * t) * exp(-t * 260)) * 0.16 + noise() * Float(exp(-t * 400)) * 0.08 }
    lastTyped = typed
  }
  tt += 1 / 30
}
// whooshes on scene changes
for w in [3.55, 9.25, 12.65, 15.2] {
  add(&sfx, w, 0.7) { t, x in
    let env = Float(sin(Double.pi * x))
    return noise() * env * env * 0.11 * Float(0.6 + 0.4 * sin(tau * (300 + 900 * x) * t))
  }
}
// pops for each highlighted part of the phrase, rising notes
for (k, tm) in [5.0, 5.6, 6.2, 6.8].enumerated() {
  let base = note([84.0, 88, 91, 96][k])
  add(&sfx, tm, 0.18) { t, _ in
    let f = base * (0.7 + 0.3 * (1 - exp(-t * 60)))
    return Float(sin(tau * f * t) * exp(-t * 22)) * 0.2
  }
}
// "code" reveal: three digital blips
for (k, tm) in [7.5, 7.58, 7.66].enumerated() {
  let f = [1760.0, 2093, 2637][k]
  add(&sfx, tm, 0.06) { t, _ in Float(sin(tau * f * t) > 0 ? 1 : -1) * Float(exp(-t * 60)) * 0.05 }
}
// the event lands in the day
add(&sfx, 10.35, 0.3) { t, _ in Float(sin(tau * (70 + 90 * exp(-t * 35)) * t) * exp(-t * 14)) * 0.35 }
// Telegram-like notification: two bell tones
for (k, m) in [88.0, 95].enumerated() {
  add(&sfx, 10.95 + Double(k) * 0.13, 0.9) { t, _ in
    let f = note(m)
    return Float((sin(tau * f * t) + 0.4 * sin(tau * 2.76 * f * t) * exp(-t * 6)) * exp(-t * 5)) * 0.12
  }
}
// numbers appear
for tm in [12.85, 13.25] {
  add(&sfx, tm, 0.25) { t, _ in Float(sin(tau * note(91) * t) * exp(-t * 16)) * 0.12 }
}
// phrase chips pop in
for i in 0..<6 {
  let tm = 13.6 + Double(i) * 0.12
  let f = note(84 + Double([0, 2, 4, 7, 9, 12][i]))
  add(&sfx, tm, 0.12, pan: i % 2 == 0 ? -0.3 : 0.3) { t, _ in Float(sin(tau * f * t) * exp(-t * 30)) * 0.1 }
}

// ---------------------------------------------------------------- mix, write, mux
func master(_ a: [Float], _ b: [Float]?, gainA: Float, gainB: Float) -> [Float] {
  var out = [Float](repeating: 0, count: a.count)
  for i in 0..<a.count { out[i] = tanh((a[i] * gainA + (b?[i] ?? 0) * gainB) * 1.4) }
  // fade in / out
  let fi = Int(0.03 * SR), fo = Int(0.6 * SR)
  for n in 0..<N {
    var g: Float = 1
    if n < fi { g = Float(n) / Float(fi) }
    if n > N - fo { g = Float(N - n) / Float(fo) }
    out[2 * n] *= g
    out[2 * n + 1] *= g
  }
  let peak = out.map { abs($0) }.max() ?? 1
  // headroom for the AAC encoder (no clipping on phones)
  return out.map { $0 / peak * 0.72 }
}

func writeAAC(_ samples: [Float], to url: URL) throws {
  try? FileManager.default.removeItem(at: url)
  let fmt = AVAudioFormat(standardFormatWithSampleRate: SR, channels: 2)!
  let file = try AVAudioFile(forWriting: url, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: SR, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 192_000])
  let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(N))!
  buf.frameLength = AVAudioFrameCount(N)
  for n in 0..<N {
    buf.floatChannelData![0][n] = samples[2 * n]
    buf.floatChannelData![1][n] = samples[2 * n + 1]
  }
  try file.write(from: buf)
}

func mux(video: URL, audio: URL, out: URL) async throws {
  try? FileManager.default.removeItem(at: out)
  let comp = AVMutableComposition()
  let v = AVURLAsset(url: video), a = AVURLAsset(url: audio)
  let vt = try await v.loadTracks(withMediaType: .video)[0]
  let at = try await a.loadTracks(withMediaType: .audio)[0]
  let dur = try await v.load(.duration)
  let cv = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)!
  try cv.insertTimeRange(CMTimeRange(start: .zero, duration: dur), of: vt, at: .zero)
  let ca = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)!
  let ad = try await a.load(.duration)
  try ca.insertTimeRange(CMTimeRange(start: .zero, duration: min(dur, ad)), of: at, at: .zero)
  let ex = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetPassthrough)!
  ex.outputURL = out
  ex.outputFileType = .mp4
  await ex.export()
  if ex.status != .completed { throw ex.error ?? NSError(domain: "mux", code: 1) }
}

let args = CommandLine.arguments
let video = URL(fileURLWithPath: args[1])
let tmp = FileManager.default.temporaryDirectory
let full = master(music, sfx, gainA: 1, gainB: 1.4)
let ui = master(sfx, nil, gainA: 1, gainB: 0)
try writeAAC(full, to: tmp.appendingPathComponent("full.m4a"))
try writeAAC(ui, to: tmp.appendingPathComponent("sfx.m4a"))
let sem = DispatchSemaphore(value: 0)
Task {
  do {
    try await mux(video: video, audio: tmp.appendingPathComponent("full.m4a"), out: URL(fileURLWithPath: args[2]))
    try await mux(video: video, audio: tmp.appendingPathComponent("sfx.m4a"), out: URL(fileURLWithPath: args[3]))
    print("ok")
  } catch { print("failed: \(error)") }
  sem.signal()
}
sem.wait()
