#!/usr/bin/env python3
import http.server
import socketserver
import webbrowser
import os
import sys
from urllib.parse import urlparse


class CORSHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def guess_type(self, path):
        mimetype = super().guess_type(path)
        if path.endswith(".css"):
            return "text/css"
        elif path.endswith(".js"):
            return "application/javascript"
        elif path.endswith(".html"):
            return "text/html"
        return mimetype


def main(port):
    PORT = port

    frontend_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(frontend_dir)

    try:
        with socketserver.TCPServer(("", PORT), CORSHTTPRequestHandler) as httpd:
            print(f"🌐 Frontend server starting on port {PORT}")
            print(f"📁 Serving files from: {os.getcwd()}")
            print(f"🔗 Frontend URL: http://localhost:{PORT}")
            print(f"🎵 TTS Server should be running on: http://localhost:8085")
            print("\n" + "="*60)
            print("🚀 TTS PROJECT - FRONTEND INTERFACE")
            print("="*60)
            print("📋 Available Features:")
            print("   • Text-to-Speech synthesis")
            print("   • Real-time WebSocket streaming")
            print("   • AI Chat integration")
            print("   • Server status monitoring")
            print("="*60)
            print("\n💡 Make sure your TTS server is running:")
            print("   cargo run --release -p server")
            print("\n🌐 Opening browser...")
            
            webbrowser.open(f"http://localhost:{PORT}")

            print(f"\n🔄 Server running... Press Ctrl+C to stop")
            httpd.serve_forever()

    except OSError as e:
        if e.errno == 48:
            print(f"❌ Port {PORT} is already in use!")
            print("💡 Try one of these solutions:")
            print(f"   1. Kill the process using port {PORT}: lsof -ti:{PORT} | xargs kill -9")
            print(f"   2. Use a different port: python3 serve_frontend.py --port 8083")
            print(f"   3. Check what's running: lsof -i:{PORT}")
        else:
            print(f"❌ Error starting server: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n👋 Server stopped by user")
        sys.exit(0)


if __name__ == "__main__":
    # Default port
    port = 8082

    # Optional --port argument
    if len(sys.argv) > 1 and sys.argv[1] == "--port":
        try:
            port = int(sys.argv[2])
        except (IndexError, ValueError):
            print("❌ Invalid port number")
            sys.exit(1)

    main(port)
