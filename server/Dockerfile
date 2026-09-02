# Build Stage
FROM node:20-slim AS builder

# Instalar dependencias del sistema necesarias para Prisma
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./
COPY prisma ./prisma/

# Instalar todas las dependencias
RUN npm ci

COPY . .

# Generar el cliente de Prisma y compilar NestJS
RUN npx prisma generate
RUN npm run build

# Eliminar dependencias de desarrollo y mantener solo producción
RUN npm prune --production

# Production Stage
FROM node:20-slim

# Instalar openssl para producción
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/prisma ./prisma
COPY --from=builder /usr/src/app/start.sh ./start.sh
COPY --from=builder /usr/src/app/*.js ./
COPY --from=builder /usr/src/app/20241224-niche-menu-full-1-1.pdf ./20241224-niche-menu-full-1-1.pdf

# Hacer ejecutable el script de inicio
RUN chmod +x ./start.sh

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD ["./start.sh"]
