// Sound for planner-tech-reel: the male voice-over plus UI sounds, synced to tech.html (no music).
//
// build: swiftc -O soundtrack.swift -o soundtrack
// run:   ./soundtrack <video.mp4> <voice.caf | -> <out.mp4>   ("-" = UI sounds only, no voice)
import AVFoundation
import Foundation

let SR = 44_100.0
// FAST=1: the opening typing runs twice as fast (no voice), the rest comes 2 s earlier.
let FAST = ProcessInfo.processInfo.environment["FAST"] == "1"
let DUR = FAST ? 18.0 : 20.0
/** Content time (as in tech.html) → time in the video. */
func T(_ x: Double) -> Double { !FAST || x < 0.5 ? x : x < 4.5 ? 0.5 + (x - 0.5) / 2 : x - 2 }
let N = Int(SR * DUR)
var sfx = [Float](repeating: 0, count: N * 2) // interleaved stereo
var voice = [Float](repeating: 0, count: N * 2)

var seed: UInt32 = 7
func noise() -> Float {
  seed = seed &* 1_664_525 &+ 1_013_904_223
  return Float(Int32(bitPattern: seed)) / Float(Int32.max)
}
func add(_ buf: inout [Float], _ at: Double, _ len: Double, pan: Float = 0, _ gen: (Double, Double) -> Float) {
  let start = Int(T(at) * SR), count = Int(len * SR)
  let l = 1 - max(0, pan), r = 1 + min(0, pan)
  for i in 0..<count {
    let n = start + i
    if n < 0 || n >= N { continue }
    let v = gen(Double(i) / SR, Double(i) / Double(count))
    buf[2 * n] += v * l
    buf[2 * n + 1] += v * r
  }
}
let tau = 2 * Double.pi
func note(_ midi: Double) -> Double { 440 * pow(2, (midi - 69) / 12) }
func tone(_ f: Double, decay: Double, gain: Float) -> (Double, Double) -> Float {
  { t, _ in Float((sin(tau * f * t) + 0.3 * sin(tau * 2 * f * t) * exp(-t * 12)) * exp(-t * decay)) * gain }
}
func whoosh(_ at: Double, _ len: Double = 0.7, gain: Float = 0.1) {
  add(&sfx, at, len) { t, x in
    let env = Float(sin(Double.pi * x))
    return noise() * env * env * gain * Float(0.6 + 0.4 * sin(tau * (300 + 900 * x) * t))
  }
}

// ---------------------------------------------------------------- the voice (0.5 … 4.5 s)
if CommandLine.arguments[2] != "-" {
let vfile = try AVAudioFile(forReading: URL(fileURLWithPath: CommandLine.arguments[2]))
let vbuf = AVAudioPCMBuffer(pcmFormat: vfile.processingFormat, frameCapacity: AVAudioFrameCount(vfile.length))!
try vfile.read(into: vbuf)
let vsr = vfile.processingFormat.sampleRate
let vdata = vbuf.floatChannelData![0]
let vlen = Int(vbuf.frameLength)
var vpeak: Float = 0.0001
for i in 0..<vlen { vpeak = max(vpeak, abs(vdata[i])) }
let VOICE_AT = 0.5
for n in 0..<N {
  let src = (Double(n) / SR - VOICE_AT) * vsr // resample to 44.1 kHz (linear)
  if src < 0 || src >= Double(vlen - 1) { continue }
  let i = Int(src), f = Float(src - Double(i))
  let v = (vdata[i] * (1 - f) + vdata[i + 1] * f) / vpeak * 0.9
  voice[2 * n] = v
  voice[2 * n + 1] = v
}
}

// ---------------------------------------------------------------- UI sounds
// mic on
add(&sfx, 0.3, 0.2, tone(note(79), decay: 18, gain: 0.12))
add(&sfx, 0.38, 0.25, tone(note(86), decay: 14, gain: 0.12))
// soft keys under the voice: one per character, evenly 0.5 … 4.35 s
let chars = 52
for i in 0..<chars {
  let at = 0.5 + 3.85 * Double(i) / Double(chars - 1)
  let pitch = 2300 + Double(noise()) * 400
  // quiet under the voice-over; on their own the keys carry the opening, so they're louder
  let k: Float = CommandLine.arguments[2] == "-" ? 3 : 1
  add(&sfx, at, 0.025, pan: noise() * 0.3) { t, _ in (Float(sin(tau * pitch * t) * exp(-t * 300)) * 0.05 + noise() * Float(exp(-t * 500)) * 0.03) * k }
}
// scene changes
for w in [4.65, 9.6, 12.95] { whoosh(w) }
// the four parts of the phrase light up — rising pops
for (k, at) in [5.5, 6.1, 6.7, 7.3].enumerated() {
  let base = note([84.0, 88, 91, 96][k])
  add(&sfx, at, 0.2) { t, _ in Float(sin(tau * base * (0.7 + 0.3 * (1 - exp(-t * 60))) * t) * exp(-t * 20)) * 0.2 }
}
// the "code" appears: digital blips
for (k, at) in [8.0, 8.08, 8.16].enumerated() {
  let f = [1760.0, 2093, 2637][k]
  add(&sfx, at, 0.06) { t, _ in Float(sin(tau * f * t) > 0 ? 1 : -1) * Float(exp(-t * 60)) * 0.05 }
}
// the event lands in the day, then the notification
add(&sfx, 10.9, 0.3) { t, _ in Float(sin(tau * (70 + 90 * exp(-t * 35)) * t) * exp(-t * 14)) * 0.4 }
for (k, m) in [88.0, 95].enumerated() {
  add(&sfx, 11.45 + Double(k) * 0.13, 0.9) { t, _ in
    let f = note(m)
    return Float((sin(tau * f * t) + 0.4 * sin(tau * 2.76 * f * t) * exp(-t * 6)) * exp(-t * 5)) * 0.13
  }
}
// numbers, then the three phrases
for at in [13.25, 13.65] { add(&sfx, at, 0.3, tone(note(91), decay: 14, gain: 0.12)) }
for (k, at) in [14.35, 14.8, 15.25].enumerated() { add(&sfx, at, 0.2, pan: [-0.3, 0.3, 0][k], tone(note(84 + [0.0, 4, 7][k]), decay: 22, gain: 0.13)) }
// finale: a swell into the impact, rings, the sparkle, letters, the handle and its shine
add(&sfx, 15.9, 0.6) { t, x in noise() * Float(x * x) * 0.12 + Float(sin(tau * (200 + 600 * x) * t)) * Float(x * x) * 0.03 }
add(&sfx, 16.5, 2.4) { t, _ in
  let ph = tau * (38 * t + 140 * (1 - exp(-t * 14)) / 14)
  return Float(sin(ph) * exp(-t * 2.4)) * 0.55 + noise() * Float(exp(-t * 8)) * 0.1
}
for (k, m) in [81.0, 84, 88, 93].enumerated() {
  add(&sfx, 16.55 + Double(k) * 0.06, 1.8, pan: Float(k % 2 == 0 ? -0.35 : 0.35)) { t, _ in Float(sin(tau * note(m) * t) * exp(-t * 2)) * 0.045 }
}
add(&sfx, 17.35, 1.2) { t, _ in // sparkle chime
  Float((sin(tau * note(100) * t) + 0.5 * sin(tau * note(107) * t)) * exp(-t * 4)) * 0.09
}
for i in 0..<9 { add(&sfx, 17.5 + Double(i) * 0.05, 0.05, tone(note(96 + Double(i % 3) * 2), decay: 60, gain: 0.035)) }
whoosh(18.7, 0.45, gain: 0.07)
add(&sfx, 18.95, 0.3, tone(note(79), decay: 12, gain: 0.12))
add(&sfx, 19.3, 1.0) { t, _ in // glassy shine
  Float((sin(tau * 3520 * t) + 0.6 * sin(tau * 5280 * t)) * exp(-t * 5)) * 0.05
}

// ---------------------------------------------------------------- mix, write, mux
var mix = [Float](repeating: 0, count: N * 2)
for i in 0..<(N * 2) { mix[i] = tanh(voice[i] * 0.95 + sfx[i] * 1.1) }
let fo = Int(0.5 * SR)
for n in (N - fo)..<N {
  let g = Float(N - n) / Float(fo)
  mix[2 * n] *= g
  mix[2 * n + 1] *= g
}
let peak = mix.map { abs($0) }.max() ?? 1
mix = mix.map { $0 / peak * 0.72 } // headroom for the AAC encoder

let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("reel-sound.m4a")
try? FileManager.default.removeItem(at: tmp)
let fmt = AVAudioFormat(standardFormatWithSampleRate: SR, channels: 2)!
do {
  let file = try AVAudioFile(forWriting: tmp, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: SR, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 192_000])
  let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(N))!
  buf.frameLength = AVAudioFrameCount(N)
  for n in 0..<N {
    buf.floatChannelData![0][n] = mix[2 * n]
    buf.floatChannelData![1][n] = mix[2 * n + 1]
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
  if ex.status != .completed { throw NSError(domain: "mux", code: 1) }
}

let sem = DispatchSemaphore(value: 0)
Task {
  do {
    try await mux(video: URL(fileURLWithPath: CommandLine.arguments[1]), audio: tmp, out: URL(fileURLWithPath: CommandLine.arguments[3]))
    print("ok")
  } catch { print("failed: \(error)") }
  sem.signal()
}
sem.wait()
