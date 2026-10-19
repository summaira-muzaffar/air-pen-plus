import http.server, socketserver, webbrowser

PORT = 8123

class Handler(http.server.SimpleHTTPRequestHandler):
    pass

# Windows sometimes labels .js files wrongly, which stops the app from loading
Handler.extensions_map[".js"] = "text/javascript"
Handler.extensions_map[".mjs"] = "text/javascript"

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
    url = f"http://127.0.0.1:{PORT}"
    print("Open", url, "(press Ctrl+C to stop)")
    webbrowser.open(url)
    httpd.serve_forever()