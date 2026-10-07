import AVFoundation
import AppKit
// Real iPhone screen recording → one frame per reel frame of the phone scene, retimed to the voice.
let KEYS: [(Double, Double)] = [ // (reel time, recording time)
  (26.24, 1.75), (26.92, 2.35), (27.40, 4.30), (27.70, 4.60), (28.00, 4.80), (28.35, 5.40), (28.47, 5.60),
  (28.62, 5.80), (29.25, 6.60), (29.45, 6.80), (29.65, 7.00), (29.85, 7.55), (30.00, 7.85), (30.001, 9.22),
  (30.18, 9.40), (33.45, 11.55),
]
func rec(_ v: Double) -> Double {
  if v <= KEYS[0].0 { return KEYS[0].1 }
  for k in 1..<KEYS.count where v <= KEYS[k].0 {
    let (v0, r0) = KEYS[k - 1], (v1, r1) = KEYS[k]
    return r0 + (r1 - r0) * (v - v0) / (v1 - v0)
  }
  return KEYS.last!.1
}
let a = AVURLAsset(url: URL(fileURLWithPath: "iphone.mp4"))
let g = AVAssetImageGenerator(asset: a); g.appliesPreferredTrackTransform = true
g.requestedTimeToleranceBefore = .zero; g.requestedTimeToleranceAfter = .zero
g.maximumSize = CGSize(width: 640, height: 1392)
try? FileManager.default.createDirectory(atPath: "ipf", withIntermediateDirectories: true)
for i in 785...1004 {
  let r = rec(Double(i) / 30)
  if let cg = try? g.copyCGImage(at: CMTime(seconds: r, preferredTimescale: 600), actualTime: nil) {
    try! NSBitmapImageRep(cgImage: cg).representation(using: .jpeg, properties: [.compressionFactor: 0.9])!.write(to: URL(fileURLWithPath: String(format: "ipf/v%04d.jpg", i)))
  }
}
print("ok")
