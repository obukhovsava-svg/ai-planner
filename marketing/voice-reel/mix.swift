// Sound for the voice reel: the user's voice (cleaned up) + UI sound effects synced to reel.html. No music.
//
// build: swiftc -O mix.swift -o mix
// run:   ./mix <voice.m4a> <video.mp4> <out.mp4>
import AVFoundation
import Foundation

let SR = 48_000.0
let DUR = 43.2
let N = Int(SR * DUR)
var sfx = [Float](repeating: 0, count: N * 2)
var voice = [Float](repeating: 0, count: N * 2)
let tau = 2 * Double.pi

var seed: UInt32 = 11
func noise() -> Float {
  seed = seed &* 1_664_525 &+ 1_013_904_223
  return Float(Int32(bitPattern: seed)) / Float(Int32.max)
}
func note(_ m: Double) -> Double { 440 * pow(2, (m - 69) / 12) }

/// Adds a generated sound; gen(t seconds, x 0…1) → sample.
func add(_ at: Double, _ len: Double, pan: Float = 0, gain: Float = 1, _ gen: (Double, Double) -> Float) {
  let start = Int(at * SR), count = Int(len * SR)
  let l = 1 - max(0, pan), r = 1 + min(0, pan)
  for i in 0..<count {
    let n = start + i
    if n < 0 || n >= N { continue }
    let v = gen(Double(i) / SR, Double(i) / Double(count)) * gain
    sfx[2 * n] += v * l
    sfx[2 * n + 1] += v * r
  }
}

// ---------------------------------------------------------------- sound kinds
/// Air moving past: band-passed noise sweeping up or down.
func whoosh(_ at: Double, _ len: Double = 0.45, up: Bool = true, gain: Float = 0.22) {
  var lp: Float = 0, bp: Float = 0
  add(at - len * 0.6, len, gain: gain) { _, x in
    let f = up ? 300 + 2600 * x * x : 2900 - 2600 * x
    let k = Float(2 * sin(Double.pi * f / SR))
    let hp = noise() - lp - 0.6 * bp
    bp += k * hp; lp += k * bp
    let env = Float(sin(Double.pi * pow(x, up ? 1.4 : 0.7)))
    return bp * env * env
  }
}
/// Low thump.
func impact(_ at: Double, gain: Float = 0.5) {
  add(at, 0.7, gain: gain) { t, _ in
    let ph = tau * (42 * t + 110 * (1 - exp(-t * 26)) / 26)
    return Float(sin(ph) * exp(-t * 6.5)) + noise() * Float(exp(-t * 60)) * 0.3
  }
}
/// Bubble pop with a pitch glide.
func pop(_ at: Double, _ f: Double, gain: Float = 0.2, pan: Float = 0) {
  add(at, 0.16, pan: pan, gain: gain) { t, _ in
    Float(sin(tau * f * (1 + 0.6 * exp(-t * 40)) * t) * exp(-t * 26))
  }
}
/// "Delete": a falling blip.
func bloop(_ at: Double, _ f: Double, gain: Float = 0.2) {
  add(at, 0.22, gain: gain) { t, x in
    Float(sin(tau * f * (1 - 0.45 * x) * t) * exp(-t * 14)) + Float(sin(tau * f * 2 * t) * exp(-t * 40)) * 0.25
  }
}
/// Clock tick (alternating tick / tock).
func tick(_ at: Double, tock: Bool, gain: Float = 0.16) {
  let f = tock ? 1900.0 : 2600.0
  add(at, 0.04, gain: gain) { t, _ in Float(sin(tau * f * t) * exp(-t * 180)) + noise() * Float(exp(-t * 400)) * 0.4 }
}
/// Screen tap: a soft click with a hint of pitch.
func tap(_ at: Double, _ pitch: Double, gain: Float = 0.24) {
  add(at, 0.09, gain: gain) { t, _ in
    noise() * Float(exp(-t * 700)) * 0.6 + Float(sin(tau * pitch * t) * exp(-t * 55)) * 0.7
  }
}
/// Keyboard key.
func key(_ at: Double, gain: Float = 0.07) {
  let p = 1500 + Double(noise()) * 500
  add(at, 0.035, pan: noise() * 0.25, gain: gain) { t, _ in Float(sin(tau * p * t) * exp(-t * 260)) * 0.6 + noise() * Float(exp(-t * 520)) }
}
/// Bell-ish chime.
func chime(_ at: Double, _ midi: [Double], step: Double = 0.09, gain: Float = 0.13, decay: Double = 5) {
  for (i, m) in midi.enumerated() {
    let f = note(m)
    add(at + Double(i) * step, 1.0, pan: i % 2 == 0 ? -0.15 : 0.15, gain: gain) { t, _ in
      Float((sin(tau * f * t) + 0.35 * sin(tau * 2.76 * f * t) * exp(-t * 7)) * exp(-t * decay))
    }
  }
}
/// Glittery sparkle.
func sparkle(_ at: Double, count: Int = 8, gain: Float = 0.05) {
  for i in 0..<count {
    let f = note(96 + Double((i * 5) % 9))
    add(at + Double(i) * 0.04, 0.12, pan: (i % 2 == 0 ? -0.4 : 0.4), gain: gain) { t, _ in Float(sin(tau * f * t) * exp(-t * 45)) }
  }
}
/// Rising tension into the "quick capture" pill.
func riser(_ at: Double, _ len: Double, gain: Float = 0.12) {
  add(at, len, gain: gain) { t, x in
    let f = 220 + 900 * x * x
    return (Float(sin(tau * f * t)) * 0.35 + noise() * 0.5) * Float(x * x)
  }
}
/// Error buzz.
func buzz(_ at: Double, gain: Float = 0.13) {
  for k in 0..<2 {
    add(at + Double(k) * 0.12, 0.09, gain: gain) { t, _ in Float(sin(tau * 140 * t) > 0 ? 1 : -1) * Float(exp(-t * 18)) * 0.5 }
  }
}
/// Hardware button click.
func button(_ at: Double, gain: Float = 0.35) {
  add(at, 0.12, gain: gain) { t, _ in noise() * Float(exp(-t * 900)) + Float(sin(tau * 180 * t) * exp(-t * 60)) * 0.6 }
}
/// Listening starts / stops: two soft tones.
func listen(_ at: Double, start: Bool, gain: Float = 0.14) {
  let notes: [Double] = start ? [76, 83] : [83, 76]
  for (i, m) in notes.enumerated() {
    let f = note(m)
    add(at + Double(i) * 0.1, 0.35, gain: gain) { t, _ in Float(sin(tau * f * t) * (1 - exp(-t * 200)) * exp(-t * 9)) }
  }
}
/// Glassy tag tick.
func glass(_ at: Double, _ midi: Double, gain: Float = 0.12) {
  let f = note(midi)
  add(at, 0.4, gain: gain) { t, _ in Float((sin(tau * f * t) + 0.5 * sin(tau * 3 * f * t) * exp(-t * 30)) * exp(-t * 11)) }
}
/// Send: a short upward swoosh.
func swooshUp(_ at: Double, gain: Float = 0.14) {
  add(at, 0.25, gain: gain) { t, x in Float(sin(tau * (500 + 1500 * x) * t)) * Float(sin(Double.pi * x)) * 0.4 + noise() * Float(sin(Double.pi * x)) * 0.2 }
}

// ---------------------------------------------------------------- the score (seconds, same clock as reel.html)
impact(0.04, gain: 0.45); whoosh(0.3, 0.35, up: false, gain: 0.12)
for (i, d) in [0.86, 1.14, 1.36, 1.62, 1.9, 2.2].enumerated() { bloop(d + 0.05, 720 - Double(i) * 55, gain: 0.17) }
whoosh(2.72, 0.35, gain: 0.15); pop(2.95, 900, gain: 0.14)
whoosh(3.62, 0.4, gain: 0.2); sparkle(3.66, count: 4, gain: 0.03)
var tt = 3.82, gap = 0.24, tock = false
while tt < 5.5 { tick(tt, tock: tock); tock.toggle(); tt += gap; gap = max(0.075, gap * 0.85) }
impact(4.8, gain: 0.22)
whoosh(5.58, 0.4, up: false, gain: 0.18)
pop(5.92, 620, gain: 0.16)
for i in 0..<5 { pop(6.6 + Double(i) * 0.08, 520 + Double(i) * 90, gain: 0.09, pan: Float(i - 2) * 0.15) }
whoosh(7.3, 0.3, gain: 0.1)
whoosh(8.32, 0.35, up: false, gain: 0.12)
for (i, at) in [8.4, 9.4, 10.08, 11.04, 11.45, 11.95, 12.8].enumerated() { tap(at, 900 + Double(i) * 110) }
for i in 0..<6 { key(10.18 + Double(i) * 0.075) }
for i in 0..<3 { tick(11.1 + Double(i) * 0.05, tock: i % 2 == 1, gain: 0.07) }
pop(11.97, 480, gain: 0.08)
chime(12.95, [84, 88], step: 0.08, gain: 0.11, decay: 8)
whoosh(13.5, 0.4, gain: 0.2)
for i in 0..<7 { glass(14.4 + Double(i) * 0.065, [72, 74, 76, 79, 81, 84, 86][i], gain: 0.07) }
impact(14.85, gain: 0.5)
whoosh(15.7, 0.45, up: false, gain: 0.18)
for (i, d) in [16.2, 16.64, 17.14].enumerated() { bloop(d + 0.04, [600, 520, 450][i], gain: 0.15) }
chime(17.95, [91, 98], step: 0.05, gain: 0.12, decay: 3.5); sparkle(18.05, count: 7, gain: 0.04)
whoosh(18.68, 0.4, gain: 0.18)
for (i, at) in [19.0, 19.54, 20.5].enumerated() { pop(at, [420, 540, 680][i], gain: 0.2) }
riser(20.55, 0.55); impact(21.1, gain: 0.25); sparkle(21.15, count: 5, gain: 0.04)
whoosh(21.95, 0.4, up: false, gain: 0.18)
glass(22.4, 79, gain: 0.07)
pop(23.32, 700, gain: 0.12)
buzz(24.45); impact(24.62, gain: 0.3)
whoosh(25.2, 0.4, gain: 0.18); chime(25.3, [79, 86, 91], step: 0.06, gain: 0.08, decay: 4)
whoosh(26.24, 0.35, up: false, gain: 0.12)
button(26.42)
listen(26.92, start: true)
listen(29.78, start: false)
chime(30.2, [88, 84, 91], step: 0.11, gain: 0.12, decay: 6); impact(30.22, gain: 0.2)
for (i, at) in [31.56, 32.16, 32.66].enumerated() { glass(at, [81, 84, 88][i], gain: 0.12) }
whoosh(33.4, 0.4, gain: 0.16)
for i in 0..<7 { tick(33.6 + Double(i) * 0.19, tock: i % 2 == 0, gain: 0.06) }
whoosh(35.1, 0.35, up: false, gain: 0.12)
for (a, b, n) in [(35.18, 35.95, 9), (36.18, 36.75, 6), (36.8, 37.45, 8)] { for i in 0..<n { key(a + (b - a) * Double(i) / Double(n), gain: 0.06) } }
whoosh(37.45, 0.25, gain: 0.08)
whoosh(37.92, 0.4, gain: 0.18)
pop(39.22, 560, gain: 0.2); sparkle(39.3, count: 6, gain: 0.04)
for i in 0..<4 { key(39.47 + Double(i) * 0.09, gain: 0.08) }
tap(39.88, 1200, gain: 0.16); swooshUp(39.95)
chime(40.52, [86, 91], step: 0.09, gain: 0.1, decay: 6)
sparkle(42.2, count: 6, gain: 0.025)

// ---------------------------------------------------------------- the voice: high-pass, compressor, level
let vf = try AVAudioFile(forReading: URL(fileURLWithPath: CommandLine.arguments[1]))
let vfmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: vf.processingFormat.sampleRate, channels: vf.processingFormat.channelCount, interleaved: false)!
let vbuf = AVAudioPCMBuffer(pcmFormat: vf.processingFormat, frameCapacity: AVAudioFrameCount(vf.length))!
try vf.read(into: vbuf)
let vsr = vf.processingFormat.sampleRate
let vlen = Int(vbuf.frameLength)
let ch = Int(vbuf.format.channelCount)
var mono = [Float](repeating: 0, count: vlen)
for c in 0..<ch { let d = vbuf.floatChannelData![c]; for i in 0..<vlen { mono[i] += d[i] / Float(ch) } }
// high-pass ~90 Hz
let a = Float(exp(-tau * 90 / vsr))
var prevX: Float = 0, prevY: Float = 0
for i in 0..<vlen { let y = a * (prevY + mono[i] - prevX); prevX = mono[i]; prevY = y; mono[i] = y }
// compressor: −22 dB threshold, 3:1, fast attack
var env: Float = 0
let att = Float(exp(-1 / (0.004 * vsr))), rel = Float(exp(-1 / (0.12 * vsr)))
let th: Float = pow(10, -22 / 20)
var peak: Float = 0
for i in 0..<vlen {
  let x = abs(mono[i])
  env = x > env ? att * env + (1 - att) * x : rel * env + (1 - rel) * x
  let g: Float = env > th ? pow(env / th, 1 / 3 - 1) : 1
  mono[i] *= g
  peak = max(peak, abs(mono[i]))
}
let vg = 0.92 / max(peak, 1e-4)
var vEnv = [Float](repeating: 0, count: N) // for ducking the effects
var e2: Float = 0
for n in 0..<N {
  let src = Double(n) / SR * vsr
  if src >= Double(vlen - 1) { break }
  let i = Int(src), f = Float(src - Double(i))
  let v = (mono[i] * (1 - f) + mono[i + 1] * f) * vg
  voice[2 * n] = v; voice[2 * n + 1] = v
  e2 = max(abs(v), e2 * 0.9995)
  vEnv[n] = e2
}

// ---------------------------------------------------------------- mix, write, mux
var mix = [Float](repeating: 0, count: N * 2)
for n in 0..<N {
  let duck = 1 - 0.4 * min(1, vEnv[n] / 0.5)
  for c in 0..<2 { mix[2 * n + c] = tanh(voice[2 * n + c] * 0.95 + sfx[2 * n + c] * 1.1 * duck) }
}
let fo = Int(0.6 * SR)
for n in (N - fo)..<N { let g = Float(N - n) / Float(fo); mix[2 * n] *= g; mix[2 * n + 1] *= g }
let mpeak = mix.map { abs($0) }.max() ?? 1
mix = mix.map { $0 / mpeak * 0.89 }

let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("voice-reel.m4a")
try? FileManager.default.removeItem(at: tmp)
do {
  let fmt = AVAudioFormat(standardFormatWithSampleRate: SR, channels: 2)!
  let file = try AVAudioFile(forWriting: tmp, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: SR, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 256_000])
  let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(N))!
  buf.frameLength = AVAudioFrameCount(N)
  for n in 0..<N { buf.floatChannelData![0][n] = mix[2 * n]; buf.floatChannelData![1][n] = mix[2 * n + 1] }
  try file.write(from: buf)
}

func mux(video: URL, audio: URL, out: URL) async throws {
  try? FileManager.default.removeItem(at: out)
  let comp = AVMutableComposition()
  let v = AVURLAsset(url: video), au = AVURLAsset(url: audio)
  let vt = try await v.loadTracks(withMediaType: .video)[0]
  let at = try await au.loadTracks(withMediaType: .audio)[0]
  let dur = try await v.load(.duration)
  let cv = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)!
  try cv.insertTimeRange(CMTimeRange(start: .zero, duration: dur), of: vt, at: .zero)
  let ca = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)!
  let ad = try await au.load(.duration)
  try ca.insertTimeRange(CMTimeRange(start: .zero, duration: min(dur, ad)), of: at, at: .zero)
  let ex = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetPassthrough)!
  ex.outputURL = out
  ex.outputFileType = .mp4
  await ex.export()
  if ex.status != .completed { throw NSError(domain: "mux", code: 1, userInfo: [NSLocalizedDescriptionKey: "\(String(describing: ex.error))"]) }
}

var finished = false
Task {
  do {
    try await mux(video: URL(fileURLWithPath: CommandLine.arguments[2]), audio: tmp, out: URL(fileURLWithPath: CommandLine.arguments[3]))
    print("ok")
  } catch { print("failed: \(error)") }
  finished = true
}
while !finished { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
