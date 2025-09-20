# dwnldr-tun-helper

Flask app that detects your tunnel IP (`tun0`/`wg0`/`tailscale0`), lists files from a mounted folder, and generates Windows download commands. Includes an **on-the-fly file listener** you can start/stop on any port and a **live request log**.

## Quick start (Docker, Linux host networking)

```bash
docker build -t dwnldr-tun-helper .
docker run --rm --network=host \
  -e PORT=3000 \
  -e FILE_ROOT=/data \
  -e SERVE_FILES=1 \
  -e FILE_URL_PREFIX=/files \
  -v /YOURhost/YOURfilesfolder:/data \
  dwnldr-tun-helper
# open http://localhost:3000
```

- Click **Start** next to the File listener (e.g., port `8443`). With `--network=host`, the listener is on `host:8443` immediately.
- Choose a file from the dropdown or type a filename; copy a command.
- The **Logs** panel shows requests to the file listener in real time.

## Docker Compose (Linux)

```bash
docker compose up --build
# open http://localhost:3000
```

Compose file uses `network_mode: host`. On macOS/Windows use ports instead of host network:
```yaml
services:
  app:
    build: .
    ports:
      - "8443:3000"
```

## Notes

- Run **one Gunicorn worker** (the Dockerfile already does) so the file-listener state and log buffer are shared.
- On Windows PowerShell, use `curl.exe` (not `curl`) — the template already does this.
- Interface detection tries: `psutil` → `ip` → `ifconfig`. You can set `STATIC_IP` to override.

## Env vars

- `PORT` — UI server port (default 3000).
- `FILE_ROOT` — directory to list/serve (default `/data`). Mount your folder to this path.
- `SERVE_FILES` — if `1/true`, Flask serves `/files/<name>` from `FILE_ROOT`.
- `FILE_URL_PREFIX` — URL prefix used when `SERVE_FILES=1` (default `/files`).

## Dev (no Docker)
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export PORT=3000 FILE_ROOT=./data SERVE_FILES=1 FILE_URL_PREFIX=/files
python app.py
```

Then open http://localhost:3000 and use the **Start** button to run the file listener on another port.
