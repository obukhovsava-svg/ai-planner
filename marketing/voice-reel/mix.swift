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

// ---------------------------------------------------------------- sound kinds (modern Reels palette)
/// One-pole low-pass / high-pass helpers for shaping noise.
struct LP { var y: Float = 0; mutating func run(_ x: Float, _ k: Float) -> Float { y += k * (x - y); return y } }
func coef(_ f: Double) -> Float { Float(1 - exp(-tau * f / SR)) }

/// Deep air whoosh: noise through an opening low-pass, doppler-ish swell, long tail.
func whoosh(_ at: Double, _ len: Double = 0.55, gain: Float = 0.3) {
  var lp1 = LP(), lp2 = LP(), hp = LP()
  add(at - len * 0.55, len, gain: gain) { _, x in
    let f = 180 + 2200 * pow(sin(Double.pi * x), 2.2)
    let n = lp2.run(lp1.run(noise(), coef(f)), coef(f))
    let h = n - hp.run(n, coef(90))
    return h * Float(pow(sin(Double.pi * pow(x, 0.8)), 1.6)) * 2.2
  }
}
/// Sub-bass boom (the "bass drop" hit under title slams).
func boom(_ at: Double, gain: Float = 0.6, len: Double = 1.4) {
  var lp = LP()
  add(at, len, gain: gain) { t, _ in
    let ph = tau * (38 * t + 70 * (1 - exp(-t * 18)) / 18)
    let body = tanh(sin(ph) * 1.8 * exp(-t * 3.2))
    let click = lp.run(noise(), coef(2500)) * Float(exp(-t * 90)) * 0.8
    return Float(body) + click
  }
}
/// Punchy short impact (kick + snare noise), for text slams.
func hit(_ at: Double, gain: Float = 0.4) {
  var lp = LP()
  add(at, 0.45, gain: gain) { t, _ in
    let kick = sin(tau * (55 * t + 160 * (1 - exp(-t * 40)) / 40)) * exp(-t * 11)
    let snare = lp.run(noise(), coef(5000)) * Float(exp(-t * 22)) * 0.55
    return Float(tanh(kick * 1.5)) + snare
  }
}
/// Digital glitch: chopped, bit-crushed bursts.
func glitch(_ at: Double, gain: Float = 0.16, bursts: Int = 5) {
  for i in 0..<bursts {
    let f = [1800.0, 600, 3200, 900, 2400, 1200][i % 6]
    let len = 0.018 + Double(i % 3) * 0.012
    add(at + Double(i) * 0.034, len, pan: i % 2 == 0 ? -0.3 : 0.3, gain: gain) { t, _ in
      let sq: Float = sin(tau * f * t) > 0 ? 1 : -1
      let crushed = (noise() * 0.6 + sq * 0.4)
      return Float(Int(crushed * 4)) / 4
    }
  }
}
/// Dry UI tick (iOS-like): a tiny high-passed click, no pitch slide.
func click(_ at: Double, gain: Float = 0.22, bright: Double = 4000) {
  var lp = LP()
  add(at, 0.03, gain: gain) { t, _ in
    let n = noise()
    let h = n - lp.run(n, coef(bright))
    return h * Float(exp(-t * 600)) * 1.6
  }
}
/// Screen tap: click + soft low body.
func tap(_ at: Double, gain: Float = 0.26) {
  click(at, gain: gain)
  add(at, 0.06, gain: gain * 0.5) { t, _ in Float(sin(tau * 160 * t) * exp(-t * 70)) }
}
/// Mechanical keyboard key (ASMR typing).
func key(_ at: Double, gain: Float = 0.09) {
  var lp = LP()
  let b = 3000 + Double(noise()) * 1500
  add(at, 0.05, pan: noise() * 0.25, gain: gain) { t, _ in
    let n = noise(); let h = n - lp.run(n, coef(b))
    return h * Float(exp(-t * 380)) * 1.4 + Float(sin(tau * 220 * t) * exp(-t * 90)) * 0.35
  }
}
/// Clock tick: filtered click with a wooden knock.
func tick(_ at: Double, tock: Bool, gain: Float = 0.16) {
  click(at, gain: gain, bright: tock ? 2200 : 3500)
  add(at, 0.05, gain: gain * 0.4) { t, _ in Float(sin(tau * (tock ? 900 : 1300) * t) * exp(-t * 120)) }
}
/// Reverse swell into an accent (noise rising, filter opening).
func swell(_ at: Double, _ len: Double = 0.7, gain: Float = 0.2) {
  var lp = LP()
  add(at - len, len, gain: gain) { _, x in lp.run(noise(), coef(200 + 6000 * x * x)) * Float(pow(x, 2.4)) * 1.6 }
}
/// Riser: swell + rising filtered saw.
func riser(_ at: Double, _ len: Double, gain: Float = 0.15) {
  swell(at, len, gain: gain)
  var lp = LP(), ph = 0.0
  add(at - len, len, gain: gain * 0.5) { _, x in
    ph += (80 + 500 * x * x) / SR
    let saw = Float(2 * (ph - floor(ph)) - 1)
    return lp.run(saw, coef(300 + 3000 * x)) * Float(x * x)
  }
}
/// Camera shutter.
func shutter(_ at: Double, gain: Float = 0.2) {
  click(at, gain: gain, bright: 2500); click(at + 0.07, gain: gain * 0.8, bright: 3500)
  var lp = LP()
  add(at, 0.12, gain: gain * 0.5) { t, _ in lp.run(noise(), coef(3000)) * Float(exp(-t * 40)) }
}
/// One clean modern "ding" (soft sine bell with a short attack).
func ding(_ at: Double, _ midi: Double, gain: Float = 0.12) {
  let f = note(midi)
  add(at, 1.6, gain: gain) { t, _ in
    Float((sin(tau * f * t) + 0.25 * sin(tau * 2 * f * t) * exp(-t * 4)) * (1 - exp(-t * 300)) * exp(-t * 2.6))
  }
}
/// Hardware button press.
func button(_ at: Double, gain: Float = 0.4) {
  click(at, gain: gain, bright: 1500)
  add(at, 0.09, gain: gain * 0.6) { t, _ in Float(sin(tau * 120 * t) * exp(-t * 60)) }
}
/// Listening starts / stops (iOS dictation-like soft blips).
func listen(_ at: Double, start: Bool, gain: Float = 0.12) {
  let notes: [Double] = start ? [79, 86] : [86, 79]
  for (i, m) in notes.enumerated() {
    let f = note(m)
    add(at + Double(i) * 0.085, 0.3, gain: gain) { t, _ in Float(sin(tau * f * t) * (1 - exp(-t * 400)) * exp(-t * 12)) }
  }
}
/// Send: short airy swoosh up.
func swooshUp(_ at: Double, gain: Float = 0.16) {
  var lp = LP()
  add(at, 0.28, gain: gain) { _, x in lp.run(noise(), coef(800 + 5000 * x)) * Float(sin(Double.pi * x)) * 1.5 }
}

// ---------------------------------------------------------------- the score (seconds, same clock as reel.html)
boom(0.02, gain: 0.55); glitch(0.02, gain: 0.08, bursts: 3)
for (i, d) in [0.86, 1.14, 1.36, 1.62, 1.9, 2.2].enumerated() { glitch(d + 0.04, gain: 0.07, bursts: 2 + i % 2); click(d + 0.04, gain: 0.12) }
whoosh(2.72, 0.5, gain: 0.25); hit(2.75, gain: 0.25)
whoosh(3.62, 0.55, gain: 0.3)
var tt = 3.82, gap = 0.24, tock = false
while tt < 5.5 { tick(tt, tock: tock); tock.toggle(); tt += gap; gap = max(0.075, gap * 0.85) }
hit(4.8, gain: 0.3)
whoosh(5.58, 0.5, gain: 0.28)
click(5.92, gain: 0.16)
for i in 0..<5 { click(6.6 + Double(i) * 0.07, gain: 0.1) }
swell(7.3, 0.45, gain: 0.12); hit(7.32, gain: 0.22)
whoosh(8.32, 0.45, gain: 0.2)
for at in [8.4, 9.4, 10.08, 11.04, 11.45, 11.95, 12.8] { tap(at) }
for i in 0..<6 { key(10.18 + Double(i) * 0.075) }
for i in 0..<3 { click(11.1 + Double(i) * 0.05, gain: 0.07, bright: 5000) }
shutter(12.85, gain: 0.16)
whoosh(13.5, 0.55, gain: 0.3)
for i in 0..<7 { click(14.4 + Double(i) * 0.065, gain: 0.12 + Float(i) * 0.015) }
swell(14.85, 0.5, gain: 0.14); boom(14.85, gain: 0.6)
whoosh(15.7, 0.55, gain: 0.28)
for d in [16.2, 16.64, 17.14] { glitch(d + 0.04, gain: 0.08, bursts: 3); click(d + 0.04, gain: 0.12) }
swell(17.95, 0.6, gain: 0.16); ding(17.95, 88, gain: 0.1); hit(17.97, gain: 0.25)
whoosh(18.68, 0.5, gain: 0.26)
for at in [19.0, 19.54, 20.5] { hit(at, gain: 0.2); click(at, gain: 0.12) }
riser(21.1, 0.6); boom(21.1, gain: 0.45)
whoosh(21.95, 0.55, gain: 0.28)
click(23.32, gain: 0.14)
glitch(24.45, gain: 0.14, bursts: 6); hit(24.62, gain: 0.45)
whoosh(25.2, 0.5, gain: 0.26); swell(25.25, 0.4, gain: 0.12); boom(25.25, gain: 0.4)
whoosh(26.24, 0.45, gain: 0.18)
button(26.42)
listen(26.92, start: true)
listen(29.78, start: false)
ding(30.2, 84, gain: 0.12); hit(30.22, gain: 0.3)
for at in [31.56, 32.16, 32.66] { click(at, gain: 0.16); hit(at, gain: 0.1) }
whoosh(33.4, 0.5, gain: 0.24)
for i in 0..<7 { click(33.6 + Double(i) * 0.19, gain: 0.07) }
whoosh(35.1, 0.45, gain: 0.18)
for (a, b, n) in [(35.18, 35.95, 9), (36.18, 36.75, 6), (36.8, 37.45, 8)] { for i in 0..<n { key(a + (b - a) * Double(i) / Double(n), gain: 0.08) } }
swell(37.45, 0.3, gain: 0.1); hit(37.47, gain: 0.18)
whoosh(37.92, 0.55, gain: 0.28)
swell(39.22, 0.4, gain: 0.12); boom(39.22, gain: 0.45)
for i in 0..<4 { key(39.47 + Double(i) * 0.09, gain: 0.09) }
tap(39.88, gain: 0.18); swooshUp(39.95)
ding(40.52, 91, gain: 0.08)

// ---------------------------------------------------------------- room: a light Schroeder reverb on the effects
do {
  let combs = [1557, 1617, 1491, 1422].map { Int(Double($0) * SR / 44_100) }
  let aps = [225, 556].map { Int(Double($0) * SR / 44_100) }
  for c in 0..<2 {
    var wet = [Float](repeating: 0, count: N)
    for (k, d) in combs.enumerated() {
      let dl = d + c * 23 + k * 7
      var buf = [Float](repeating: 0, count: dl); var idx = 0; var lpv: Float = 0
      for n in 0..<N {
        let y = buf[idx]
        lpv = y * 0.6 + lpv * 0.4
        buf[idx] = sfx[2 * n + c] + lpv * 0.78
        idx = (idx + 1) % dl
        wet[n] += y * 0.25
      }
    }
    for d in aps {
      var buf = [Float](repeating: 0, count: d); var idx = 0
      for n in 0..<N { let b = buf[idx]; let y = -wet[n] + b; buf[idx] = wet[n] + b * 0.5; idx = (idx + 1) % d; wet[n] = y }
    }
    for n in 0..<N { sfx[2 * n + c] += wet[n] * 0.22 }
  }
}

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
