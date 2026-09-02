# Desvinculacion de The Villa Dog

Este proyecto fue copiado desde la base de THE VILLA DOG, pero queda preparado para operar independiente.

## Ya realizado

- No se copio la carpeta `.git` original.
- No se copiaron archivos `.env` con secretos reales.
- Se eliminaron respaldos, compilados y salidas generadas heredadas.
- Se elimino el script de deploy viejo.
- El workflow de GitHub quedo desactivado por seguridad.
- Se agregaron plantillas `server/.env.example` y `client/.env.example`.
- El `package.json` raiz ahora usa el nombre `the-villa-dog`.
- Se elimino el binario `niche.exe`; el puente de impresion debe regenerarse con nombre y URL nueva.

## Antes de ejecutar o desplegar

1. Crea una base de datos nueva en Supabase, Neon, Railway, Aiven u otro proveedor.
2. Copia `server/.env.example` a `server/.env` y llena valores nuevos.
3. Copia `client/.env.example` a `client/.env.production` para produccion o `client/.env` para local.
4. Instala dependencias con `npm run install:all`.
5. Ejecuta `npm --prefix server run prisma:generate`.
6. Ejecuta `npx --prefix server prisma db push` solo contra la base nueva.
7. Crea un repo nuevo en GitHub y agrega ese remoto cuando estes listo.

## Regla de oro

No uses credenciales, tokens, dominios, base de datos, servidor, proyecto Railway/Vercel/DigitalOcean ni templates de WhatsApp del negocio anterior.
