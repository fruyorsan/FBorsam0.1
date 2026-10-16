# =============================================================
# PaperBot — Sanal (paper) kripto/DeFi işlem sistemi
# =============================================================
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY paperbot ./paperbot
COPY .env.example ./

# Veri, log ve SQLite kalıcı olsun diye volume
VOLUME ["/app/data", "/app/logs"]

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/status', timeout=4).status==200 else 1)"

CMD ["uvicorn", "paperbot.main:app", "--host", "0.0.0.0", "--port", "8000"]
