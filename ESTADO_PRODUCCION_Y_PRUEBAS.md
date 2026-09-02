# The Villa Dog: estado y pruebas

Revisión del 2 de septiembre de 2026.

**Estado: interfaz y flujo de entrada preparados para pruebas locales supervisadas. Todavía no aprobado para producción ni para usar como único registro de cobros reales.** No se realizó ningún despliegue ni se conectó infraestructura del negocio anterior.

## Cambios realizados

- Login con tipografía del sistema, fondos neutros, acento naranja, formulario legible en celular y escritorio, contraseña visible a petición y recuperación de cuenta conservada.
- Eliminados el radar, los operadores supuestamente conectados, las cifras de demostración, sus animaciones y las consultas públicas periódicas. Eliminado también el endpoint público de esas estadísticas.
- Dashboard enfocado en mesas abiertas, tickets de cocina, pagos por validar, domicilios y caja; accesos filtrados por permisos y módulos visibles. Quitados rankings de operadores, gráficos y métricas heredadas que no ayudaban a trabajar.
- Corregido el contrato entre servidor y dashboard: antes el servidor respondía `totalOrders` y la pantalla intentaba leer `today.orders`. Las estadísticas ahora se calculan en PostgreSQL, respetan el día de Colombia y distinguen pedidos entregados de ventas con pago confirmado.
- Los datos pendientes son actuales; el selector Hoy/Ayer/7 días afecta el resumen de pedidos. Una respuesta inválida o una caída del servidor muestra un error y permite reintentar, sin inventar ceros.
- Conexiones de tiempo real autenticadas con JWT. El servidor obtiene identidad y rol desde la base, rechaza conexiones anónimas y tokens de refresco, y bloquea suscripciones arbitrarias a salas. Las pestañas múltiples ya no desconectan falsamente al mismo usuario.
- Corregido el proxy WebSocket local. Actualizaciones del dashboard agrupadas, sin consultas superpuestas, con reconciliación cada minuto y al volver a la pestaña. El login no abre conexiones de personal sin sesión.
- Caché limitada a 500 entradas con limpieza de vencidos; cierre de contextos de audio; deduplicación temporal de errores repetidos; carga de páginas bajo demanda.
- Corregidos avisos inexistentes de cocina/mesas, referencias de caja y errores de tipos encontrados durante la revisión.
- Comprobantes accesibles con autenticación, previsualización mediante descarga autorizada y liberación de URLs temporales. Límite de carga de un comprobante: 5 MB.
- Puente de impresión protegido con `PRINT_BRIDGE_TOKEN`; se requiere regenerar/configurar el puente nuevo. La impresión por USB en el navegador sigue siendo una opción independiente.
- Configuración de producción exige secreto JWT nuevo, HTTPS y orígenes explícitos. Swagger solo en desarrollo. El servidor comprueba la base en `/api/ready` y atiende rutas del frontend y errores 404 correctamente.
- Eliminada la renumeración automática de pedidos al reiniciar y el endpoint heredado de borrado masivo `/api/system/clean`. El arranque de producción no modifica el esquema ni ejecuta las reparaciones históricas de datos. El seed de demostración se bloquea en producción.
- Añadidos Dockerfile, exclusiones de secretos y plantilla de variables nuevas. No son evidencia de un despliegue probado.

## Lo que todavía bloquea producción

1. **Cobros y concurrencia.** `TablesService.submitPayment` actualiza pago y pedido antes de terminar de guardar el comprobante; `reviewPayment` tampoco agrupa todos sus cambios en una transacción. Debe garantizarse que un fallo no deje estados parciales, que el importe cubra lo cobrado y que dos cajeros no validen/rechacen simultáneamente el mismo pago. El cobro actual toma el primer pedido no confirmado de la mesa: probar y resolver expresamente mesas con varios pedidos y pagos parciales. La liberación automática tampoco debe cerrar una mesa con trabajo de cocina pendiente.
2. **Menú público.** El controlador público aún acepta demasiados campos del cliente y requiere una lista explícita de campos permitidos, control de cantidades y límites contra abuso. La pantalla pública confirma el pedido antes de esperar su persistencia. No habilitar ventas públicas hasta corregir y probar ese recorrido.
3. **Dependencias.** `npm audit --omit=dev` detectó 14 alertas en servidor (11 altas) y 9 en cliente (7 altas). Los conteos incluyen dependencias transitivas y no equivalen a vulnerabilidades explotables comprobadas. `xlsx` aparece sin arreglo automático; `localtunnel` debe salir de la imagen de producción o moverse a desarrollo. Actualizar/reemplazar y repetir compilación y pruebas antes de publicar. No se aplicaron actualizaciones mayores automáticas.
4. **Base y migraciones.** Crear una base completamente nueva y ensayar todas las migraciones desde cero; contrastarlas con el esquema actual. Hasta ahora parte de la compatibilidad dependía de SQL ejecutado al arrancar. No se ejecutaron migraciones, seeds ni borrados contra la base existente durante esta revisión.
5. **Cuentas y recuperación.** Reemplazar usuarios de demostración y contraseñas débiles; configurar un proveedor de correo nuevo y probar recuperar/desbloquear una cuenta. Los tokens de refresco nuevos tienen propósito explícito; las sesiones antiguas pueden necesitar iniciar sesión otra vez. Falta una política completa de revocación de sesiones y autorización por acción en todos los endpoints/eventos.
6. **Archivos y retención.** Montar almacenamiento persistente para `DATA_DIR`. La rutina existente `purgeProofsForClosing` elimina fotos al cerrar caja: definir cuánto conservar comprobantes antes de utilizar dinero real. No confundir comprobantes, pagos ni auditoría con basura. Falta una política acordada para logs, notificaciones y archivos huérfanos, con limpieza por lotes y respaldo.
7. **Operación.** Configurar backups automáticos y probar una restauración. Probar impresora real, dos dispositivos simultáneos, pérdida de internet y un turno completo. Medir latencia, CPU, memoria y reconexiones bajo la carga esperada. Las pruebas automáticas de esta revisión no sustituyen estas pruebas.

## Alojamiento propuesto

Recomiendo **un proyecto nuevo en Railway**, inicialmente con una sola instancia Node/Nest que sirva API, Socket.IO y frontend compilado, más PostgreSQL en la misma región y un volumen persistente para comprobantes. La base se conecta por red privada. Se evita pagar y mantener un servidor separado para el frontend al comenzar.

La tarifa consultada es por uso: Hobby tiene un mínimo de US$5/mes; Pro, orientado a producción y equipos, US$20/mes, ambos aplicables al consumo. RAM: US$10/GB-mes, CPU: US$20/vCPU-mes, disco: US$0,15/GB-mes y egreso: US$0,05/GB. Fuente: [precios oficiales de Railway](https://docs.railway.com/pricing).

**Presupuesto estimado, no cotización:** US$10–20/mes para un piloto pequeño en Hobby; prever US$20–35/mes para el inicio en Pro. Puede superar ese rango. Dominio, correo, WhatsApp, backups y otros servicios pueden agregar costos. Elegir región y tamaño con mediciones desde Montería, activar alertas de gasto y evitar suspensión por inactividad durante el horario de atención.

Para empezar, una sola instancia simplifica la operación. Aumentar CPU/RAM según métricas. **No activar varias réplicas todavía:** operadores y caché viven en memoria, y los comprobantes están en disco local. Para crecer horizontalmente harán falta estado compartido, adaptador de Socket.IO, almacenamiento de objetos y pruebas de concurrencia. Más instancias por sí solas no resuelven esos problemas.

Preparación disponible: `Dockerfile`, `.dockerignore` y `server/.env.production.example`. Docker Desktop estaba detenido, por lo que la imagen no se construyó ni se probó en este equipo. Ejecutar las migraciones revisadas como paso independiente de lanzamiento: el contenedor de ejecución no incluye herramientas de desarrollo. No copiar archivos `.env` dentro de la imagen.

Antes de publicar: repositorio Git nuevo, remoto nuevo, proyecto de hosting nuevo, PostgreSQL nuevo, secretos nuevos, dominio nuevo, volumen y backups nuevos. Seguir también `DESVINCULACION_THE_VILLA_DOG.md`.

## Flujo sencillo para probar

1. **Preparación:** configurar productos/precios, estaciones de cocina y usuarios por rol. Verificar la visibilidad de módulos en cada dispositivo; actualmente es una preferencia local del navegador, no una configuración compartida del negocio.
2. **Caja:** abrir turno con base inicial. Trabajar con un usuario administrador/cajero para operación y reservar SuperAdmin para configuración técnica.
3. **Mesa:** tomar el pedido, agregar observaciones y enviarlo a cocina. Comprobar en otro dispositivo que aparece una sola vez y en la estación correcta.
4. **Cocina:** preparar, marcar listo y entregar. La mesera recibe el aviso.
5. **Pago de prueba:** efectivo o transferencia con comprobante. Transferencias pasan por revisión en caja; comprobar aprobación, rechazo y corrección. Incluir varias órdenes en una mesa y dos revisores simultáneos como casos obligatorios pendientes.
6. **Cierre:** comprobar que las mesas estén pagadas y la cocina sin pendientes; conciliar efectivo/transferencias y cerrar turno. Confirmar conservación de evidencias conforme a la política que se defina.
7. **Domicilios, después:** registrar dirección/tarifa, asignar domiciliario, despachar, marcar entrega y comprobar el cobro. Activar WhatsApp solo después de configurar credenciales nuevas y verificar el recorrido manual.

No borrar la base de pruebas actual para empezar: contiene mesas y operaciones previas. Para una jornada de aceptación limpia, usar otra base aislada, identificada como pruebas y sin credenciales del despliegue anterior.

## Validación realizada

- Login visual revisado en escritorio y a 390 × 844; inicio de sesión local exitoso y llegada al dashboard.
- Dashboard revisado en escritorio/celular, con datos existentes y estado «Conectado en vivo».
- 19 pruebas automáticas de servidor aprobadas en 5 suites: reglas existentes, fechas de Colombia, contrato de estadísticas, autenticación WebSocket, salas, presencia de varias pestañas y orígenes CORS.
- Revisión de tipos del frontend (`npm --prefix client run typecheck`) aprobada tras corregir los errores detectados.
- Compilación Nest y frontend Vite verificadas por separado. El comando completo con regeneración Prisma encontró el bloqueo de DLL de Windows causado por el servidor local en ejecución; no se detuvo la sesión del usuario para regenerarla. No es una prueba de la imagen Linux.
- Verificación HTTP: raíz y rutas de frontend 200; readiness 200; dashboard y comprobantes sin sesión 401; estadísticas públicas retiradas y rutas API inexistentes 404; puente sin configurar 404. Socket anónimo rechazado.
- No se realizaron cobros, envíos de WhatsApp, cambios de contraseña, publicaciones ni pruebas de carga contra infraestructura externa.

## Próximas mejoras prioritarias

Primero: cerrar los bloqueos de pagos, menú público, dependencias y migraciones. Después: configuración de módulos compartida por negocio, pruebas de reconexión sin duplicados, comprobantes comprimidos con retención definida, conciliación clara de caja y una cola de impresión con reintentos e identificación única. Posponer IA, rankings, campañas y reportes grandes hasta que un turno completo funcione sin intervención técnica.
