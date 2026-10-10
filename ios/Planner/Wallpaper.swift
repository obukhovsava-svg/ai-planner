import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit

/// The lock-screen wallpaper: today's plans on the left, tasks on the right, drawn over the
/// user's photo (or the brand background). Rendered to an image by the «Обои ПЛАН» action;
/// the user's Shortcut then sets it with «Установить обои».
enum WallpaperStore {
  private static var dir: URL {
    let d = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
    return d
  }
  static var photoURL: URL { dir.appendingPathComponent("wallpaper-photo.jpg") }
  static var hasPhoto: Bool { FileManager.default.fileExists(atPath: photoURL.path) }
  static func photo() -> UIImage? { UIImage(contentsOfFile: photoURL.path) }

  /// Keeps the chosen photo at screen size (enough for the wallpaper, small on disk).
  static func save(_ image: UIImage) {
    let size = WallpaperRenderer.screenSize
    let scaled = UIGraphicsImageRenderer(size: size, format: { let f = UIGraphicsImageRendererFormat(); f.scale = WallpaperRenderer.screenScale; return f }())
      .image { _ in aspectFill(image, in: CGRect(origin: .zero, size: size)) }
    try? scaled.jpegData(compressionQuality: 0.9)?.write(to: photoURL, options: .atomic)
  }

  static func reset() { try? FileManager.default.removeItem(at: photoURL) }

  static func aspectFill(_ image: UIImage, in rect: CGRect) {
    let s = max(rect.width / image.size.width, rect.height / image.size.height)
    let w = image.size.width * s, h = image.size.height * s
    image.draw(in: CGRect(x: rect.midX - w / 2, y: rect.midY - h / 2, width: w, height: h))
  }
}

@MainActor
enum WallpaperRenderer {
  static var screenSize: CGSize { UIScreen.main.bounds.size }
  static var screenScale: CGFloat { UIScreen.main.scale }

  static func render(now: Date = .now, scale: CGFloat? = nil) -> UIImage? {
    let size = screenSize
    let photo = WallpaperStore.photo()
    let view = WallpaperView(snapshot: WidgetStore.load(), now: now, photo: photo, blurred: photo.flatMap { blur($0, size: size) })
      .frame(width: size.width, height: size.height)
      .environment(\.colorScheme, .dark)
    let r = ImageRenderer(content: view)
    r.scale = scale ?? screenScale
    return r.uiImage
  }

  /// A blurred copy of the photo — the frosted glass behind the two cards.
  private static func blur(_ image: UIImage, size: CGSize) -> UIImage? {
    let small = CGSize(width: size.width / 2, height: size.height / 2)
    let base = UIGraphicsImageRenderer(size: small).image { _ in WallpaperStore.aspectFill(image, in: CGRect(origin: .zero, size: small)) }
    guard let ci = CIImage(image: base) else { return nil }
    let f = CIFilter.gaussianBlur()
    f.inputImage = ci.clampedToExtent()
    f.radius = 14
    guard let out = f.outputImage?.cropped(to: ci.extent), let cg = CIContext().createCGImage(out, from: ci.extent) else { return nil }
    return UIImage(cgImage: cg)
  }
}

/// Layout in points of a 402-pt-wide screen, scaled to the real width.
struct WallpaperView: View {
  let snapshot: WidgetSnapshot
  let now: Date
  let photo: UIImage?
  let blurred: UIImage?

  private let maxPlans = 7, maxTasks = 9

  var body: some View {
    GeometryReader { geo in
      let k = geo.size.width / 402
      let top = 262 * k, cardW = 182 * k, cardH = 428 * k, gap = 10 * k, side = 14 * k
      ZStack(alignment: .topLeading) {
        background(geo.size)
        card(x: side, y: top, w: cardW, h: cardH, k: k, size: geo.size) { plans(k) }
        card(x: side + cardW + gap, y: top, w: cardW, h: cardH, k: k, size: geo.size) { tasks(k) }
        Text("ПЛАН · обновлено \(now.formatted(.dateTime.hour().minute()))")
          .font(.system(size: 9 * k, weight: .semibold))
          .foregroundStyle(.white.opacity(0.6))
          .shadow(color: .black.opacity(0.5), radius: 3 * k)
          .frame(width: geo.size.width - 20 * k, alignment: .trailing)
          .offset(y: top + cardH + 6 * k)
      }
    }
  }

  // MARK: background + glass

  @ViewBuilder private func background(_ size: CGSize) -> some View {
    if let photo {
      Image(uiImage: photo).resizable().scaledToFill().frame(width: size.width, height: size.height).clipped()
    } else {
      // Default: the brand night sky.
      ZStack {
        LinearGradient(colors: [rgb(0x0d1025), rgb(0x141433), rgb(0x1d1230)], startPoint: .top, endPoint: .bottom)
        RadialGradient(colors: [rgb(0x3b3a8f), .clear], center: UnitPoint(x: 0.8, y: 0), startRadius: 0, endRadius: size.height * 0.55)
        RadialGradient(colors: [rgb(0x7a3d6e), .clear], center: UnitPoint(x: 0, y: 1), startRadius: 0, endRadius: size.height * 0.45)
      }
      .frame(width: size.width, height: size.height)
    }
  }

  private func card<Content: View>(x: CGFloat, y: CGFloat, w: CGFloat, h: CGFloat, k: CGFloat, size: CGSize, @ViewBuilder content: () -> Content) -> some View {
    let shape = RoundedRectangle(cornerRadius: 22 * k, style: .continuous)
    return ZStack(alignment: .topLeading) {
      if let blurred {
        Image(uiImage: blurred).resizable().frame(width: size.width, height: size.height).offset(x: -x, y: -y)
          .frame(width: w, height: h, alignment: .topLeading).clipped()
        Color.black.opacity(0.48)
      } else {
        Color(red: 0.07, green: 0.07, blue: 0.1).opacity(0.62)
      }
      content().padding(.init(top: 12 * k, leading: 12 * k, bottom: 10 * k, trailing: 10 * k))
    }
    .frame(width: w, height: h, alignment: .topLeading)
    .clipShape(shape)
    .overlay(shape.strokeBorder(photo == nil ? rgb(0xa48bfa).opacity(0.4) : .white.opacity(0.14), lineWidth: 0.75 * k))
    .offset(x: x, y: y)
  }

  private func header(_ icon: String, _ title: String, _ count: String, _ k: CGFloat) -> some View {
    HStack(spacing: 6 * k) {
      Image(systemName: icon).font(.system(size: 13 * k, weight: .semibold))
      Text(title).font(.system(size: 14 * k, weight: .bold))
      Spacer(minLength: 0)
      Text(count).font(.system(size: 12 * k, weight: .bold)).monospacedDigit()
        .padding(.horizontal, 8 * k).padding(.vertical, 2 * k)
        .background(.white.opacity(0.16), in: Capsule())
    }
    .foregroundStyle(.white)
    .padding(.bottom, 8 * k)
  }

  // MARK: left — today's plans

  private func plans(_ k: CGFloat) -> some View {
    let day = Calendar.current.startOfDay(for: now)
    let events = snapshot.day(WidgetStore.key(now))?.events ?? []
    let left = events.filter { WidgetStore.time($0.end, on: day) > now }.count
    return VStack(alignment: .leading, spacing: 4 * k) {
      header("calendar", "Планы", "\(left)", k)
      if events.isEmpty {
        Text("Свободный день").font(.system(size: 13.5 * k, weight: .semibold)).foregroundStyle(.white.opacity(0.7))
      }
      ForEach(Array(events.prefix(maxPlans).enumerated()), id: \.offset) { _, e in
        let start = WidgetStore.time(e.start, on: day), end = WidgetStore.time(e.end, on: day)
        let past = end <= now, current = start <= now && now < end
        let color = eventColor(e.color)
        HStack(spacing: 7 * k) {
          RoundedRectangle(cornerRadius: 2 * k).fill(color).frame(width: 3.5 * k)
          VStack(alignment: .leading, spacing: 1 * k) {
            Text(e.title).font(.system(size: 13.5 * k, weight: .semibold)).lineLimit(1)
            Group {
              if current { Text("сейчас").foregroundStyle(color).bold() + Text(" · до \(e.end)") } else { Text("\(e.start) – \(e.end)") }
            }
            .font(.system(size: 11 * k, weight: .medium)).foregroundStyle(.white.opacity(0.75))
          }
          Spacer(minLength: 0)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.vertical, 5 * k).padding(.leading, 4 * k)
        .background(current ? color.opacity(0.22) : .clear, in: RoundedRectangle(cornerRadius: 10 * k))
        .padding(.leading, -4 * k)
        .opacity(past ? 0.45 : 1)
        .foregroundStyle(.white)
      }
      if events.count > maxPlans { more(events.count - maxPlans, k) }
    }
  }

  // MARK: right — tasks (overdue first, then today's; done ones last)

  private func tasks(_ k: CGFloat) -> some View {
    let today = snapshot.day(WidgetStore.key(now))?.tasks ?? []
    let rows: [(title: String, detail: String?, late: Bool, hi: Bool, done: Bool)] =
      snapshot.late.map { ($0.title, lateLabel($0.date), true, $0.hi ?? false, false) }
        + today.filter { !$0.done }.map { ($0.title, $0.time, false, $0.hi ?? false, false) }
        + today.filter(\.done).map { ($0.title, nil, false, false, true) }
    let done = today.filter(\.done).count
    return VStack(alignment: .leading, spacing: 0) {
      header("checkmark.square", "Задачи", "\(done)/\(rows.count)", k)
      if rows.isEmpty {
        Text("Задач нет").font(.system(size: 13.5 * k, weight: .semibold)).foregroundStyle(.white.opacity(0.7))
      }
      ForEach(Array(rows.prefix(maxTasks).enumerated()), id: \.offset) { i, t in
        HStack(spacing: 7 * k) {
          ZStack {
            if t.done {
              Circle().fill(photo == nil ? rgb(0xa48bfa) : .white)
              Image(systemName: "checkmark").font(.system(size: 8 * k, weight: .heavy)).foregroundStyle(photo == nil ? .white : .black)
            } else {
              Circle().strokeBorder(t.late ? rgb(0xff453a) : .white.opacity(0.7), lineWidth: 1.8 * k)
            }
          }
          .frame(width: 16 * k, height: 16 * k)
          (t.hi && !t.done ? Text("! ").foregroundStyle(rgb(0xff453a)).bold() : Text(""))
            .font(.system(size: 13.5 * k)) + Text(t.title).font(.system(size: 13.5 * k, weight: .medium)).strikethrough(t.done)
          Spacer(minLength: 0)
          if let d = t.detail {
            Text(d).font(.system(size: 11.5 * k, weight: .semibold)).foregroundStyle(t.late ? rgb(0xff453a) : .white.opacity(0.6))
          }
        }
        .lineLimit(1)
        .foregroundStyle(.white)
        .frame(height: 40 * k)
        .opacity(t.done ? 0.45 : 1)
        .overlay(alignment: .bottom) {
          if i < min(rows.count, maxTasks) - 1 { Rectangle().fill(.white.opacity(0.1)).frame(height: 0.5 * k) }
        }
      }
      if rows.count > maxTasks { more(rows.count - maxTasks, k) }
    }
  }

  private func more(_ n: Int, _ k: CGFloat) -> some View {
    Text("+\(n) ещё").font(.system(size: 12 * k, weight: .semibold)).foregroundStyle(.white.opacity(0.5)).padding(.top, 4 * k)
  }

  private func lateLabel(_ key: String) -> String {
    let p = key.split(separator: "-").compactMap { Int($0) }
    guard p.count == 3, let d = Calendar.current.date(from: DateComponents(year: p[0], month: p[1], day: p[2])) else { return key }
    if Calendar.current.isDateInYesterday(d) { return "вчера" }
    return d.formatted(.dateTime.day().month(.abbreviated).locale(Locale(identifier: "ru_RU"))).replacingOccurrences(of: ".", with: "")
  }

  private func eventColor(_ name: String) -> Color {
    switch name {
    case "red": rgb(0xff453a)
    case "violet": rgb(0xbf5af2)
    case "green": rgb(0x30d158)
    case "amber": rgb(0xff9f0a)
    default: rgb(0x0a84ff)
    }
  }
}

private func rgb(_ v: UInt32) -> Color {
  Color(red: Double(v >> 16 & 0xff) / 255, green: Double(v >> 8 & 0xff) / 255, blue: Double(v & 0xff) / 255)
}
