# docker-dwnldr (Windows/Linux tabs, English, external CSS/JS)
- OS tabs under the Logs section switch between **Windows** and **Linux** command sets.
- Commands are defined in two files:
  - `commands.windows.json`
  - `commands.linux.json`
- Click **Reload templates** to re-read the current OS file (no restart).

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
