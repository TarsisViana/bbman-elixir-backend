FROM python:3.11.9-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY . ./

RUN pip install websockets -y

EXPOSE 8080
ENTRYPOINT python server/server.py