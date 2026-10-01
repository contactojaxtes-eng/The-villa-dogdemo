# The Villa Dog — instrucciones permanentes

Estas reglas son comunes para Codex, Antigravity y Claude. Mantén este archivo corto: lee documentación adicional solo cuando la tarea toque ese módulo.

## Infraestructura y seguridad

- **The Villa Dog es independiente de NICHE y de SistemaCandela.** Nunca uses sus repositorios, bases de datos, proyectos de Railway, dominios, plantillas de Meta ni secretos.
- Remoto autorizado: `https://github.com/thevilladog/The-villa-dog.git`, rama `main`.
- Producción autorizada: proyecto Railway de **The Villa Dog**.
- Nunca muestres, copies a documentación ni confirmes en Git secretos reales, tokens o archivos `.env`.

## Forma de trabajar

- El monorepo tiene `client/` (React/Vite) y `server/` (NestJS/Prisma/PostgreSQL). Consulta los manifiestos y el código real cuando necesites más detalle; no cargues un mapa completo del repositorio por defecto.
- Antes de editar, revisa `git status` y el diff actual. Conserva cambios ajenos o del usuario.
- Busca primero con `rg` y abre solo los archivos relacionados con la solicitud. Los planes e informes históricos no son contexto obligatorio.
- Completa todo el trabajo local reversible que ya esté autorizado. No hagas commit, push o despliegue hasta que el usuario lo solicite o ya lo haya autorizado en la conversación.
- Valida solo lo afectado. Para código de cliente ejecuta `npm run build` en `client/`; para servidor, `npm run build` en `server/`; ejecuta ambos cuando el cambio cruce los dos lados. Amplía las pruebas únicamente para cubrir un riesgo concreto.
- Usa mensajes de commit convencionales (`feat(...)`, `fix(...)`, `refactor(...)`, etc.).

## Invariantes operativos

- WhatsApp: identifica cada conversación por `phone`; nunca mezcles `customerPhone` con `phone`. El frontend debe enviar siempre el `sessionId` explícito a `/whatsapp/send`.
- Tiempo real: conserva Socket.IO como fuente de actualizaciones inmediatas. No introduzcas sondeos periódicos de listas completas para simular tiempo real.
- Rendimiento y costo: antes de agregar intervalos, recargas de listas, reintentos, multimedia o llamadas a proveedores, calcula su amplificación por usuarios, pestañas y frecuencia. Usa payloads acotados, caché aislada e invalidación explícita; no reduzcas costo sacrificando el tiempo real.
- IA con chats reales: no conviertas chats crudos ni respuestas generadas por otra IA en instrucciones activas. Anonimiza, depura, separa entrenamiento/evaluación y exige aprobación humana antes de incorporar ejemplos al prompt de producción.
- Impresión: nunca trunques notas o instrucciones del cliente. Elimina solo metadatos internos, ajusta texto al ancho térmico y evita abrir PDF al cobrar.
- Domicilios: la tarifa de entrega es obligatoria y no debe iniciar silenciosamente en `0`.

## Contexto condicional

Lee únicamente la referencia que corresponda:

- WhatsApp y CRM: `.codex/skills/villa-dog-safe-change/references/whatsapp.md`
- Socket.IO, caché, rendimiento o Railway: `.codex/skills/villa-dog-safe-change/references/realtime-performance.md`
- Gemini, aprendizaje con chats o control de consumo de IA: `.codex/skills/villa-dog-safe-change/references/ai-data-learning.md`
- Pedidos, pagos e impresión: `.codex/skills/villa-dog-safe-change/references/orders-printing.md`
- Commit, push, migraciones o despliegue: `.codex/skills/villa-dog-safe-change/references/release.md`

Para cambios delicados o que crucen módulos, aplica la skill `villa-dog-safe-change`.
