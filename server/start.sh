#!/bin/sh
set -eu

# Usa el mismo arranque seguro de Railway: primero ejecuta el preflight
# idempotente y `prisma db push`; si algo falla, el proceso se detiene antes
# de cargar NestJS. No se permiten migraciones fallidas ocultas con `|| true`.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(dirname -- "$SCRIPT_DIR")

if [ ! -f "$REPO_ROOT/server.js" ]; then
  echo "[Startup Error] No se encontro $REPO_ROOT/server.js" >&2
  exit 1
fi

cd "$REPO_ROOT"
exec node server.js
