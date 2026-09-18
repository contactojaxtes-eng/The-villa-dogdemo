# Desvinculacion de The Villa Dog

Este proyecto fue copiado originalmente desde la base de NICHE y fue preparado
para operar como THE VILLA DOG de forma independiente.

La infraestructura actual de THE VILLA DOG (su repositorio GitHub, Railway,
PostgreSQL y variables propias) es el destino autorizado de este proyecto.

## Ya realizado

- No se copio la carpeta `.git` original.
- No se copiaron archivos `.env` con secretos reales.
- Se eliminaron respaldos, compilados y salidas generadas heredadas.
- Se elimino el script de deploy viejo.
- El workflow de GitHub quedo desactivado por seguridad.
- Se agregaron plantillas `server/.env.example` y `client/.env.example`.
- El `package.json` raiz ahora usa el nombre `the-villa-dog`.
- Se elimino el binario `niche.exe`; el puente de impresion debe regenerarse con nombre y URL nueva.

## Configuracion inicial ya realizada

1. Se creo una base PostgreSQL propia para THE VILLA DOG.
2. Se configuraron variables propias para servidor y cliente.
3. Se instalaron las dependencias y se genero Prisma.
4. Se creo el repositorio independiente de GitHub.
5. Se configuro Railway como destino de produccion de THE VILLA DOG.

## Regla de oro

No uses credenciales, tokens, dominios, base de datos, servidores, proyectos de
hosting ni plantillas de WhatsApp de NICHE. Los recursos actuales de THE VILLA
DOG si pertenecen a este proyecto y se pueden usar para sus despliegues.
