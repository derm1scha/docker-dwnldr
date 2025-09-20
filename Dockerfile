FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=3000

WORKDIR /app

# optional tools for IP detection fallbacks
RUN apt-get update && apt-get install -y --no-install-recommends iproute2 net-tools \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
COPY templates ./templates

EXPOSE 3000

# Single worker to keep in-process file-listener state consistent
CMD ["bash", "-lc", "exec gunicorn -w 1 -k gthread -b 0.0.0.0:${PORT} app:app"]
