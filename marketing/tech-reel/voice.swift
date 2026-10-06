// Speaks the reel's phrase with the Russian male neural voice into an audio file.
// usage: swift voice.swift <out.caf> [rate 0…1]
import AVFoundation

let out = URL(fileURLWithPath: CommandLine.arguments[1])
let rate = Float(CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "0.5")!
let u = AVSpeechUtterance(string: "Созвон с командой завтра с пятнадцати до шестнадцати и напомни за час")
u.voice = AVSpeechSynthesisVoice(identifier: "com.apple.ttsbundle.gryphon-neural_Aleksei_ru-RU_premium")
u.rate = rate
let synth = AVSpeechSynthesizer()
var file: AVAudioFile?
var frames: AVAudioFramePosition = 0
var finished = false
synth.write(u) { buffer in
  guard let pcm = buffer as? AVAudioPCMBuffer else { return }
  if pcm.frameLength == 0 { finished = true; return }
  if file == nil { file = try? AVAudioFile(forWriting: out, settings: pcm.format.settings, commonFormat: pcm.format.commonFormat, interleaved: pcm.format.isInterleaved) }
  try? file?.write(from: pcm)
  frames += AVAudioFramePosition(pcm.frameLength)
}
// The synthesizer delivers audio on the main queue — keep the run loop turning while it does.
let deadline = Date().addingTimeInterval(60)
while !finished && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
file = nil // closes the file
print("finished:", finished, "frames:", frames)
