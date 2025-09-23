# docker-dwnldr (Windows/Linux tabs, English, external CSS/JS)

Flask app that detects your tunnel IP (`tun0`/`wg0`/`tailscale0`), lists files from a mounted folder, and generates Windows/Linux download commands. Includes an **on-the-fly file listener** you can start/stop on any port and a **live request log**.

- Click **Start** next to the File listener (e.g., port `8443`). With `--network=host`, the listener is on `host:8443` immediately.
- Choose a file from the dropdown or type a filename; copy a command.
- The **Logs** panel shows requests to the file listener in real time.


## template files
Added Command template files so one can change/add commands easily.




## Build & Run
```bash
docker build -t docker-dwnldr .
docker run --rm --network=host \
  -e PORT=3000 \
  -e FILE_ROOT=/data \
  -e SERVE_FILES=1 \
  -e FILE_URL_PREFIX=/files \
  -e COMMANDS_FILE_WINDOWS=/app/commands.windows.json \
  -e COMMANDS_FILE_LINUX=/app/commands.linux.json \
  -v /host/downloads:/data \
  --name docker-dwnldr \
  docker-dwnldr

# open http://localhost:3000
```

Or with compose:
```bash
docker compose up --build
```
