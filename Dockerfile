FROM python:3.13-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY . .

EXPOSE 8088

CMD ["sh", "-c", "python server.py --host 0.0.0.0 --port ${PORT:-8088}"]
