from __future__ import annotations
import os, re, json, socket, subprocess, atexit, time, threading, datetime
from typing import Optional, List, Dict, Any
from collections import deque
from functools import partial

try:
    import psutil  # type: ignore
except Exception:
    psutil = None

from flask import Flask, jsonify, render_template, send_from_directory, abort, request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class LogBuffer:
    def __init__(self, maxlen: int = 2000):
        self._buf = deque(maxlen=maxlen); self._lock = threading.Lock()
    def push(self, item: Dict[str, Any]):
        with self._lock: self._buf.append(item)
    def dump_latest(self, limit: int = 200) -> List[Dict[str, Any]]:
        with self._lock: return list(self._buf)[-limit:]
    def clear(self):
        with self._lock: self._buf.clear()

file_logs = LogBuffer(maxlen=4000)

def _now_iso(): return datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

class LoggedFileHandler(SimpleHTTPRequestHandler):
    server_version = "MiniFileSrv/1.0"
    def __init__(self, *args, directory=None, **kwargs):
        self._resp_code = None; super().__init__(*args, directory=directory, **kwargs)
    def send_response(self, code, message=None):
        self._resp_code = code; super().send_response(code, message)
    def log_message(self, format: str, *args):
        entry = {"time": _now_iso(),"client": self.client_address[0] if self.client_address else "","method": getattr(self, "command", ""),"path": getattr(self, "path", ""),"code": self._resp_code if self._resp_code is not None else "-","ua": self.headers.get("User-Agent", "") if hasattr(self, "headers") and self.headers else ""}
        file_logs.push(entry)

class FileServerManager:
    def __init__(self):
        self.server: Optional[ThreadingHTTPServer] = None; self.thread: Optional[threading.Thread] = None; self.port: Optional[int] = None; self.lock = threading.Lock()
    def is_running(self) -> bool:
        with self.lock: return self.server is not None
    def start(self, port: int, directory: str):
        with self.lock:
            if self.server is not None: return False, "already_running"
            if _is_port_in_use(port, "0.0.0.0"): return False, "port_in_use"
            handler = partial(LoggedFileHandler, directory=directory)
            try: srv = ThreadingHTTPServer(("0.0.0.0", port), handler); srv.daemon_threads = True
            except OSError as e: return False, f"bind_failed: {e}"
            t = threading.Thread(target=srv.serve_forever, name=f"file-srv:{port}", daemon=True); t.start(); time.sleep(0.1)
            self.server, self.thread, self.port = srv, t, port; return True, None
    def stop(self):
        with self.lock:
            if self.server is None: return
            try: self.server.shutdown(); self.server.server_close()
            except Exception: pass
            t = self.thread; self.server = None; self.thread = None; self.port = None
        if t:
            try: t.join(timeout=2.0)
            except Exception: pass

file_srv = FileServerManager()

app = Flask(__name__, template_folder="templates", static_folder="static")

APP_PORT = int(os.environ.get("PORT", 3000))
FILE_ROOT = os.environ.get("FILE_ROOT", "/data")
SERVE_FILES = os.environ.get("SERVE_FILES", "1").lower() in ("1", "true", "yes", "on")
FILE_URL_PREFIX = os.environ.get("FILE_URL_PREFIX", "/files")
COMMANDS_FILE = os.environ.get("COMMANDS_FILE", os.path.join(os.getcwd(), "commands.json"))
COMMANDS_FILE_WINDOWS = os.environ.get("COMMANDS_FILE_WINDOWS", os.path.join(os.getcwd(), "commands.windows.json"))
COMMANDS_FILE_LINUX = os.environ.get("COMMANDS_FILE_LINUX", os.path.join(os.getcwd(), "commands.linux.json"))

if not FILE_URL_PREFIX.startswith("/"): FILE_URL_PREFIX = "/" + FILE_URL_PREFIX
if not FILE_URL_PREFIX.endswith("/"): FILE_URL_PREFIX = FILE_URL_PREFIX + "/"

atexit.register(lambda: file_srv.stop())

_IP_RE = re.compile(r"inet (\d+\.\d+\.\d+\.\d+)(?:/\d+)?")
_IFCONFIG_RE = re.compile(r"inet(?: addr)?:\s*(\d+\.\d+\.\d+\.\d+)")

def _is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM); s.settimeout(0.15)
    try: return s.connect_ex((host, port)) == 0
    finally: s.close()

def _get_ipv4_from_psutil(ifname: str) -> Optional[str]:
    if psutil is None: return None
    try:
        addrs = psutil.net_if_addrs()
        if ifname not in addrs: return None
        for addr in addrs[ifname]:
            if addr.family == socket.AF_INET:
                ip = addr.address
                if ip and not ip.startswith("127."): return ip
    except Exception: return None
    return None

def _get_ipv4_from_ip_cmd(ifname: str) -> Optional[str]:
    try:
        res = subprocess.run(["ip", "-o", "-4", "addr", "show", "dev", ifname], capture_output=True, text=True, check=False)
        out = res.stdout or ""; m = _IP_RE.search(out); 
        if m: return m.group(1)
    except FileNotFoundError: return None
    except Exception: return None
    return None

def _get_ipv4_from_ifconfig(ifname: str) -> Optional[str]:
    try:
        res = subprocess.run(["ifconfig", ifname], capture_output=True, text=True, check=False)
        out = res.stdout or ""; m = _IFCONFIG_RE.search(out)
        if m: return m.group(1)
    except FileNotFoundError: return None
    except Exception: return None
    return None

def get_ipv4_for_interface(ifname: str) -> Optional[str]:
    return (_get_ipv4_from_psutil(ifname) or _get_ipv4_from_ip_cmd(ifname) or _get_ipv4_from_ifconfig(ifname))

def detect_tunnel_ip() -> Optional[str]:
    static_ip = os.environ.get("STATIC_IP")
    if static_ip: return static_ip
    order = ["tun0", "wg0", "tailscale0"]
    env_list = [i.strip() for i in os.environ.get("TUN_INTERFACES", "").split(",") if i.strip()]
    for name in env_list + [i for i in order if i not in env_list]:
        ip = get_ipv4_for_interface(name)
        if ip: return ip
    return None

def list_files(root: str, max_items: int = 2000) -> List[str]:
    try:
        entries = []
        with os.scandir(root) as it:
            for d in it:
                if d.is_file():
                    entries.append(d.name)
                    if len(entries) >= max_items: break
        entries.sort(key=str.lower); return entries
    except (FileNotFoundError, PermissionError): return []

@app.get("/api/ip")
def api_ip(): return jsonify({"ip": detect_tunnel_ip()})

@app.get("/api/files")
def api_files():
    files = list_files(FILE_ROOT)
    return jsonify({"files": files, "root": FILE_ROOT, "serving": SERVE_FILES, "prefix": FILE_URL_PREFIX})

@app.get("/files/<path:filename>")
def serve_file(filename: str):
    if not SERVE_FILES: abort(404)
    try: return send_from_directory(FILE_ROOT, filename, as_attachment=False)
    except FileNotFoundError: abort(404)

def _load_commands_from(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict) or "groups" not in data:
        raise ValueError("Invalid commands format")
    return data

@app.get("/api/commands")
def api_commands():
    os_param = (request.args.get("os") or "").strip().lower()
    path = COMMANDS_FILE
    if os_param == "windows":
        path = COMMANDS_FILE_WINDOWS if os.path.exists(COMMANDS_FILE_WINDOWS) else COMMANDS_FILE
    elif os_param == "linux":
        path = COMMANDS_FILE_LINUX if os.path.exists(COMMANDS_FILE_LINUX) else COMMANDS_FILE

    try:
        data = _load_commands_from(path)
        return jsonify(data)
    except Exception as e:
        fallback = {"groups":[{"title":"cmd.exe (HTTP)","tag":"HTTP","items":[
            {"id":"curl","template":"curl.exe -o \"{{filename}}\" \"{{url}}\""},
            {"id":"certutil","template":"certutil -urlcache -split -f \"{{url}}\" \"{{filename}}\""},
            {"id":"bitsadmin","template":"bitsadmin /transfer dl /download /priority normal \"{{url}}\" \"{{filename}}\""}
        ]}],"error":str(e), "path": path}
        return jsonify(fallback), 200

@app.get("/api/file-listener")
def file_listener_status():
    running = file_srv.is_running(); port = file_srv.port if running else None
    return jsonify({"running": running, "port": port})

@app.post("/api/file-listener/start")
def file_listener_start():
    try: data = (request.json or {})
    except Exception: data = {}
    port_param = request.args.get("port", "")
    try: port = int(port_param or data.get("port") or 8443)
    except Exception: port = 8443
    if port < 1 or port > 65535: return jsonify(error="invalid_port"), 400
    ok, err = file_srv.start(port, FILE_ROOT)
    if not ok:
        code = 409 if err in ("already_running", "port_in_use") else 500
        return jsonify(error=err or "failed"), code
    return jsonify(status="started", port=port)

@app.post("/api/file-listener/stop")
def file_listener_stop(): file_srv.stop(); return jsonify(status="stopped")

@app.get("/api/file-listener/logs")
def file_listener_logs():
    try: limit = int(request.args.get("limit") or 200)
    except Exception: limit = 200
    return jsonify({"logs": file_logs.dump_latest(limit)})

@app.post("/api/file-listener/logs/clear")
def file_listener_logs_clear(): file_logs.clear(); return jsonify({"status": "cleared"})

@app.get("/")
def index():
    env_static_ip = os.environ.get("STATIC_IP")
    env_tun_if = os.environ.get("TUN_INTERFACES", "tun0,wg0,tailscale0")
    download_base_path = FILE_URL_PREFIX if SERVE_FILES else "/"
    return render_template("index.html", env_static_ip=env_static_ip, env_tun_if=env_tun_if, serve_files=SERVE_FILES, download_base_path=download_base_path, app_port=APP_PORT)

if __name__ == "__main__": app.run(host="0.0.0.0", port=APP_PORT, debug=False)
