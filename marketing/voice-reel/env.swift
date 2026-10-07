import AVFoundation
let f = try AVAudioFile(forReading: URL(fileURLWithPath: CommandLine.arguments[1]))
let fmt = f.processingFormat
let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(f.length))!
try f.read(into: buf)
let sr = fmt.sampleRate, n = Int(buf.frameLength), d = buf.floatChannelData![0]
print("sr", sr, "ch", fmt.channelCount, "dur", Double(n)/sr)
let win = Int(sr * 0.02)
var rms: [Float] = []
var i = 0
while i + win <= n { var s: Float = 0; for k in i..<(i+win) { s += d[k]*d[k] }; rms.append(sqrt(s/Float(win))); i += win }
let sorted = rms.sorted(); let noise = sorted[sorted.count/10], peak = sorted[sorted.count*98/100]
let th = noise + (peak - noise) * 0.12
print("noise", noise, "peak", peak, "th", th)
// segments: speech where rms>th, merge gaps < 0.18s
var segs: [(Double, Double)] = []
var start: Int? = nil, lastOn = 0
for (k, v) in rms.enumerated() {
  if v > th { if start == nil { start = k }; lastOn = k }
  else if let s = start, k - lastOn > 9 { segs.append((Double(s)*0.02, Double(lastOn+1)*0.02)); start = nil }
}
if let s = start { segs.append((Double(s)*0.02, Double(lastOn+1)*0.02)) }
for s in segs where s.1 - s.0 > 0.08 { print(String(format: "%.2f–%.2f (%.2f)", s.0, s.1, s.1-s.0)) }
