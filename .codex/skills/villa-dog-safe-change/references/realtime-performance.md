# Tiempo real, caché y rendimiento

## Contrato de sincronización

- Al abrir un módulo, realiza una carga inicial consistente.
- Después, actualiza el estado local con payloads Socket.IO idempotentes; no descargues listas completas después de cada evento.
- Reconciliación permitida: al reconectar, recuperar una secuencia perdida o pulsar actualizar. No agregues intervalos fijos como sustituto de eventos.
- El `ping/pong` propio de Socket.IO solo comprueba la conexión; no debe ejecutar consultas de negocio.
- Comparte una conexión Socket.IO por pestaña y usa salas o eventos específicos por módulo cuando sea posible.

## Caché segura

- Cachea datos de referencia o respuestas costosas que cambian poco: menú, categorías, configuración pública y catálogos.
- Invalida o actualiza la caché al confirmar la escritura correspondiente. Define clave, alcance, TTL y evento de invalidación.
- No compartas caché entre usuarios, sedes o permisos sin incluir ese alcance en la clave.
- Pedidos activos, chats, pagos y turnos deben conservar una fuente de verdad en servidor; la caché acelera lecturas, no reemplaza validaciones.

## Medición y aceptación

- Compara antes y después: solicitudes por ruta, bytes/egress, CPU, memoria, latencia y conexiones Socket.IO.
- Conserva llegada inmediata de pedidos, mensajes y comandas sin recargar la página.
- Prefiere respuestas pequeñas, paginación, proyecciones específicas y compresión HTTP antes de subir recursos.
- Prueba reconexión, dos usuarios simultáneos y eventos duplicados o fuera de orden.
