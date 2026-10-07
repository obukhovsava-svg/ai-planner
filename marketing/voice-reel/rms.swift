import AVFoundation
let f = try AVAudioFile(forReading: URL(fileURLWithPath: CommandLine.arguments[1]))
let buf = AVAudioPCMBuffer(pcmFormat: f.processingFormat, frameCapacity: AVAudioFrameCount(f.length))!
try f.read(into: buf)
let sr = f.processingFormat.sampleRate, n = Int(buf.frameLength), d = buf.floatChannelData![0]
let hop = Int(sr / 30)
var out: [Float] = []
var i = 0
while i < n { let e = min(n, i + hop); var s: Float = 0; for k in i..<e { s += d[k]*d[k] }; out.append(sqrt(s / Float(e - i))); i += hop }
let mx = out.max()!
print("[" + out.map { String(format: "%.3f", $0 / mx) }.joined(separator: ",") + "]")
