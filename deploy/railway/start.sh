#!/bin/bash
# Starts the single-container Railway deploy (deploy/railway/Dockerfile):
# database migrations first, then uvicorn on 127.0.0.1:8000 and nginx on
# Railway's $PORT. If either process stops, the container exits so Railway
# restarts it, instead of serving pages whose API is gone.
set -uo pipefail
cd /app

PORT="${PORT:-8080}"
sed "s/__PORT__/${PORT}/g" deploy/railway/nginx.conf.template > /etc/nginx/nginx.conf
nginx -t -q || exit 1

python tools/migrate.py || exit 1

# nginx asks the backend for /health as "localhost" (nginx.conf.template), so
# it stays allowed whatever ALLOWED_HOSTS the service sets — otherwise setting
# only the public domain would fail Railway's health check.
case ",${ALLOWED_HOSTS:-}," in
    *,localhost,*) ;;
    *) export ALLOWED_HOSTS="localhost${ALLOWED_HOSTS:+,$ALLOWED_HOSTS}" ;;
esac

# One worker: the rate limiter, guest quota and session locks live in memory.
# The only proxy in front of uvicorn is nginx in this container.
uvicorn main:app --host 127.0.0.1 --port 8000 \
    --proxy-headers --forwarded-allow-ips 127.0.0.1 &
nginx -g 'daemon off;' &

trap 'kill -TERM $(jobs -p) 2>/dev/null' TERM INT
wait -n
status=$?
kill -TERM $(jobs -p) 2>/dev/null
wait
exit "$status"
