import WebKit

/// Serves the bundled interface as planner://app/… — a real origin (localStorage, CORS to
/// the server) without a web server. Every path gets the single-page app.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
  private lazy var page: Data = {
    guard let url = Bundle.main.url(forResource: "index", withExtension: "html"), let data = try? Data(contentsOf: url) else {
      return Data("<h1>Интерфейс не найден</h1>".utf8)
    }
    return data
  }()

  func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
    guard let url = task.request.url else { return }
    let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": String(page.count),
      "Cache-Control": "no-cache",
    ])!
    task.didReceive(response)
    task.didReceive(page)
    task.didFinish()
  }

  func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {}
}
