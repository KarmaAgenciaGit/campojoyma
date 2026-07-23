#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly FRONTEND_URL="https://campojoyma.multiplicaxfuego.com"

cd "$SCRIPT_DIR"

for required_file in docker-compose.yml docker-compose.traefik.yml; do
  if [[ ! -f "$required_file" ]]; then
    echo "Error: no se encuentra $required_file en $SCRIPT_DIR" >&2
    exit 1
  fi
done

if ! command -v git >/dev/null 2>&1; then
  echo "Error: git no está instalado o no está disponible en PATH." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker no está instalado o no está disponible en PATH." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Error: Docker Compose no está disponible." >&2
  exit 1
fi

compose=(
  docker compose
  -f docker-compose.yml
  -f docker-compose.traefik.yml
)

echo "Actualizando el repositorio..."
git pull --ff-only

echo "Validando la configuración de Docker Compose..."
"${compose[@]}" config --quiet

echo "Construyendo y desplegando el frontend..."
"${compose[@]}" up -d --build

echo
echo "Estado del servicio:"
"${compose[@]}" ps

echo
echo "Últimas 100 líneas del log:"
"${compose[@]}" logs --tail=100 agroiris

echo
echo "Despliegue terminado: $FRONTEND_URL"
