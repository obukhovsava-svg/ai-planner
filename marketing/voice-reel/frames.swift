import AVFoundation
import AppKit
let a = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
let g = AVAssetImageGenerator(asset: a); g.appliesPreferredTrackTransform = true
g.requestedTimeToleranceBefore = .zero; g.requestedTimeToleranceAfter = .zero
g.maximumSize = CGSize(width: 360, height: 640)
let step = Double(CommandLine.arguments[3])!, dur = Double(CommandLine.arguments[4])!
var t = 0.0, i = 0
while t < dur {
  if let cg = try? g.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 600), actualTime: nil) {
    let rep = NSBitmapImageRep(cgImage: cg)
    try! rep.representation(using: .jpeg, properties: [.compressionFactor: 0.7])!.write(to: URL(fileURLWithPath: String(format: "%@/f%03d.jpg", CommandLine.arguments[2], i)))
  }
  t += step; i += 1
}
print(i)
