#!/usr/bin/env bash
# Vergrendelt + bouwt de JRES-solver microservice op de 3sm-docker host.
# Vereisten: de jres_solver_cpp-repo (met cxxopts-submodule) en dit build-script
# moeten naar de host worden gekopieerd; daarna `bash build_jres_on_docker.sh`.
#
# Context:  ops/jres-solver/  (Dockerfile, wrapper.js)  +  jres_solver_cpp/ (extern)
#
# Draait op 3sm-docker als root (docker direct, geen sudo).
set -e
cd /tmp/jres-build

echo "=== docker build (HiGHS compileert van source; eerste keer ~5-6 min) ==="
docker build -t jres-solver:canary . 2>&1 | tail -8

echo "=== (her)start container jres-canary op 127.0.0.1:8090 ==="
docker rm -f jres-canary 2>/dev/null || true
docker run -d --name jres-canary -p 127.0.0.1:8090:8080 jres-solver:canary
sleep 2
docker logs jres-canary 2>&1 | tail -2

echo "=== smoke: POST /solve (short_race) ==="
curl -s -X POST http://127.0.0.1:8090/solve \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/short_race.json 2>/dev/null | head -c 200 || echo "(curl niet beschikbaar op host)"
echo
echo "Let op: deze container draait als lokale microservice (127.0.0.1:8090)."