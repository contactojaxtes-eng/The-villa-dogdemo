#!/bin/sh

# Ejecutar migraciones de Prisma
echo "Ejecutando npx prisma migrate deploy..."
npx prisma migrate deploy || true

# Iniciar la aplicación con selector seguro de ruta
echo "Iniciando NestJS..."
if [ -f "dist/main.js" ]; then
  exec node dist/main.js
elif [ -f "dist/src/main.js" ]; then
  exec node dist/src/main.js
elif [ -f "server.js" ]; then
  exec node server.js
else
  exec node dist/main
fi
