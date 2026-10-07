import AVFoundation
import AppKit
// frames2 <video> <outdir> <from> <to> <step>
let a = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
let g = AVAssetImageGenerator(asset: a); g.appliesPreferredTrackTransform = true
g.requestedTimeToleranceBefore = .zero; g.requestedTimeToleranceAfter = .zero
g.maximumSize = CGSize(width: 300, height: 650)
let from = Double(CommandLine.arguments[3])!, to = Double(CommandLine.arguments[4])!, step = Double(CommandLine.arguments[5])!
var t = from
while t <= to + 1e-6 {
  if let cg = try? g.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 600), actualTime: nil) {
    try! NSBitmapImageRep(cgImage: cg).representation(using: .jpeg, properties: [:])!.write(to: URL(fileURLWithPath: String(format: "%@/t%06.2f.jpg", CommandLine.arguments[2], t)))
  }
  t += step
}
