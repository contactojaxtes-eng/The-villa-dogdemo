# Tiempo real, caché y rendimiento

## Contrato de sincronización

- Al abrir un módulo, realiza una carga inicial consistente.
- Después, actualiza el estado local con payloads Socket.IO idempotentes; no descargues listas completas después de cada evento.
- Reconciliación permitida: al reconectar, recuperar una secuencia perdida o pulsar actualizar. No agregues intervalos fijos como sustituto de eventos.
- El `ping/pong` propio de Socket.IO solo comprueba la conexión; no debe ejecutar consultas de negocio.
- Comparte una conexión Socket.IO por pestaña y usa salas o eventos específicos por módulo cuando sea posible.

## Presupuesto antes de implementar

- Calcula la amplificación esperada: `usuarios x pestañas x ejecuciones por minuto x rutas o intentos`. Para IA separa solicitudes lógicas de intentos a llaves o modelos.
- Estima egress con `respuestas x tamaño medio del payload`; no uses solamente el número de solicitudes para juzgar el costo.
- Define un límite verificable para temporizadores, reintentos, historial, paginación, caché y tamaño de respuesta. Si el diseño no tiene límite, no está listo para producción.
- Un evento no debe provocar una cascada de recargas completas. Actualiza la entidad afectada o emite un delta suficiente e idempotente.

## Caché segura

- Cachea datos de referencia o respuestas costosas que cambian poco: menú, categorías, configuración pública y catálogos.
- Invalida o actualiza la caché al confirmar la escritura correspondiente. Define clave, alcance, TTL y evento de invalidación.
- No compartas caché entre usuarios, sedes o permisos sin incluir ese alcance en la clave.
- Pedidos activos, chats, pagos y turnos deben conservar una fuente de verdad en servidor; la caché acelera lecturas, no reemplaza validaciones.
- Multimedia y comprobantes deben cargarse al hacerse visibles, deduplicar solicitudes concurrentes y usar una caché LRU acotada por elementos y bytes. Cachea temporalmente fallos definitivos para evitar tormentas de `404`.
- Limpia cachés privadas al cerrar sesión o cambiar de usuario, sede o credencial. Nunca uses caché pública para información de clientes.

## Consultas y observabilidad

- Evita `include` amplios, historiales sin límite, conteos o agregaciones repetidos y escrituras de métricas por cada solicitud. Selecciona solo campos necesarios y pagina desde el servidor.
- Acumula métricas en memoria y persístelas por lotes con retención. Usa etiquetas de baja cardinalidad; no guardes teléfonos, IDs de mensajes, URLs firmadas ni secretos como etiquetas.
- Revisa dependencias de efectos, listeners duplicados, pestañas en segundo plano y reconexiones. Cada montaje debe tener su limpieza correspondiente.
- No agregues índices por intuición: confirma la consulta problemática y su plan antes de cambiar la base de datos.

## Medición y aceptación

- Compara antes y después: solicitudes por ruta, bytes/egress, CPU, memoria, latencia y conexiones Socket.IO.
- Compara tasas por hora o por día y la pendiente del costo; el acumulado del ciclo por sí solo no demuestra una regresión.
- Conserva llegada inmediata de pedidos, mensajes y comandas sin recargar la página.
- Prefiere respuestas pequeñas, paginación, proyecciones específicas y compresión HTTP antes de subir recursos.
- Prueba reconexión, dos usuarios simultáneos y eventos duplicados o fuera de orden.
