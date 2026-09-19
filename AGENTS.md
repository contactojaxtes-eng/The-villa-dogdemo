# The Villa Dog - Agent Notes & System Architecture Guidelines

Este archivo es la guía central de contexto, reglas y arquitectura para cualquier agente de Inteligencia Artificial (Antigravity, Codex, Claude, Cursor, Copilot) que trabaje en este repositorio.

---

## 1. Regla de Oro e Independencia de Infraestructura

> [!CAUTION]
> **INDEPENDENCIA TOTAL DE NICHE**:
> Este proyecto fue bifurcado originalmente de NICHE, pero es un sistema 100% INDEPENDIENTE bajo la marca **THE VILLA DOG**.
> - **NUNCA** utilices infraestructura, remotos de GitHub, bases de datos PostgreSQL, plantillas de WhatsApp Meta, dominios, proyectos de Railway/Vercel/DigitalOcean ni secretos de entorno pertenecientes a NICHE.
> - **Destinos Autorizados**:
>   - Remoto Git: `https://github.com/thevilladog/The-villa-dog.git` (rama `main`).
>   - Hosting / Producción: Proyecto Railway configurado para **THE VILLA DOG**.
> - Consulta `DESVINCULACION_THE_VILLA_DOG.md` para el historial de separación.

---

## 2. Stack Tecnológico & Arquitectura

El proyecto es un monorepo dividido en `client` y `server`:

### Frontend (`client/`)
* **Framework**: React 19 + Vite 8 + TypeScript.
* **Estilos**: Tailwind CSS v4 + Radix UI primitives (`@radix-ui/*`).
* **Enrutamiento**: `react-router-dom` v7.
* **Iconografía**: `lucide-react`.
* **Tiempo Real**: `socket.io-client` para sincronización instantánea de comandas, pedidos y chat de WhatsApp.
* **Comandos Clave**:
  * Desarrollo: `npm run dev` (ejecuta Vite en puerto 5173).
  * Compilación de prueba: `npm run build` (`npx vite build`).
  * Validación de tipos: `npm run typecheck` (`tsc --noEmit -p tsconfig.app.json`).

### Backend (`server/`)
* **Framework**: NestJS 11 + Express + TypeScript.
* **ORM & Base de Datos**: Prisma ORM v5 + PostgreSQL.
* **WebSockets**: `@nestjs/websockets` con Socket.io para eventos de pedidos, caja y mensajería.
* **Autenticación**: JWT + Passport con roles (`SUPERADMIN`, `ADMIN`, `CASHIER`, `KITCHEN`, `WAITER`, `DRIVER`).
* **Comandos Clave**:
  * Desarrollo: `npm run start:dev` (ejecuta Nest en modo watch, puerto 3000).
  * Compilación: `npm run build` (`npx prisma generate && npx nest build`).
  * Migraciones Prisma: `npx prisma migrate dev` / `npx prisma studio`.

---

## 3. Módulos Críticos & Reglas de Negocio

### A. Impresión Térmica & Comandas (ESC/POS)
* **Archivos clave**: `client/src/lib/printer.ts`, `server/src/print/print.service.ts`, `client/src/components/orders/ComandaPrint.tsx`.
* **Reglas de Impresión**:
  * Las notas de productos e instrucciones del cliente **NUNCA** deben truncarse. Solo deben removerse etiquetas internas de metadatos (como `(#id)` o `[PARA LLEVAR]`).
  * Los textos largos deben ajustarse con la función `wrapText` para evitar cortes en impresoras térmicas de 58mm (32 columnas) u 80mm (48 columnas).
  * Caracteres especiales: Convertir tildes y caracteres incompatibles (á->a, é->e, ñ->n) en los payloads crudos para evitar símbolos extraños en impresoras genéricas.
  * Al cobrar en efectivo o transferencias, **no generar cuadros emergentes de PDF** molestos; únicamente activar apertura de cajón monedero (`openCashDrawer`).

### B. Módulo de WhatsApp & CRM
* **Archivos clave**: `server/src/whatsapp/whatsapp.service.ts`, `server/src/whatsapp/whatsapp.controller.ts`, `client/src/pages/ChatPage.tsx`.
* **Reglas de WhatsApp**:
  * **Aislamiento de Sesión**: La sesión se identifica estrictamente por el número remitente (`phone`). Jamás cruzar sesiones ni comparar indistintamente `customerPhone` con `phone`.
  * **Envío de Mensajes**: Desde el frontend siempre se debe enviar el `sessionId` explícito a `/whatsapp/send` para asegurar que el mensaje llegue al destinatario correcto.
  * Evitar notificaciones automáticas innecesarias en eventos como pedidos entregados o cancelados si no aportan valor operativo.

### C. Pedidos & Domicilios
* **Archivos clave**: `client/src/pages/NewOrderPage.tsx`, `client/src/pages/ActiveDeliveriesPage.tsx`, `client/src/pages/OrdersPage.tsx`.
* **Reglas de Pedidos**:
  * En pedidos tipo domicilio, la tarifa de domicilio es **obligatoria** y no debe tener un valor por defecto en `0` que induzca a cobros erróneos por descuido del operador.

---

## 4. Guía de Trabajo para Agentes (Antigravity / Codex / Claude)

1. **Verificación de Compilación**:
   Tras realizar modificaciones en el código, siempre valida la compilación antes de considerar finalizada la tarea:
   * Cliente: `npm run build` en `client/`.
   * Servidor: `npm run build` en `server/`.
2. **Entorno Operativo**:
   * Sistema Operativo: Windows (PowerShell).
   * Rutas absolutas o comandos ejecutados dentro del directorio correspondiente (`client` o `server`).
3. **Manejo de Git**:
   * Siempre inspeccionar el estado (`git status`) antes de hacer commits o push.
   * Mensajes de commit convencionales: `feat(...)`, `fix(...)`, `refactor(...)`, etc.
   * Subir cambios a `origin main` cuando el usuario lo apruebe.
4. **Seguridad**:
   * Nunca incluir archivos `.env` reales en el control de versiones.
