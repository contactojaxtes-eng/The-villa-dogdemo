# WhatsApp y CRM

## Identidad y aislamiento

- La sesión pertenece estrictamente al número remitente `phone`.
- No relaciones indistintamente `customerPhone` y `phone`, ni reutilices un pedido o sesión por coincidencias parciales.
- Toda acción desde el frontend debe enviar el `sessionId` explícito. En servidor valida que el destinatario pertenezca a esa sesión.
- Una edición modifica el mismo pedido; no debe crear silenciosamente otro pedido ni enlazar otro chat.

## Tiempo real

- Aplica mensajes, estados de lectura, asignaciones y cambios de pedido mediante eventos Socket.IO idempotentes.
- La carga HTTP inicial establece el estado base. Después usa los eventos; vuelve a sincronizar al reconectar, detectar un salto o por acción manual.
- No marques mensajes como leídos si la configuración del negocio lo desactiva.
- Evita notificaciones automáticas que no aporten valor operativo, especialmente al entregar o cancelar.
- Una derivación humana debe persistir en `waitingForAdvisor` hasta que alguien reclame o libere el chat, o el cliente pida explícitamente volver al bot; no la borres por un temporizador.
- Texto, audio e imágenes deben usar el mismo contrato de derivación: reserva primero el estado persistente, intenta confirmar al cliente y emite un delta Socket.IO suficiente para actualizar filtro, contador y conversación sin recargar listas. Si Meta falla, conserva la solicitud humana.
- Mantén visible y priorizada toda conversación que espera asesor, y notifica a cada rol operativo que tenga permiso `whatsapp.view`, respetando sus preferencias de silencio.

## Meta y multimedia

- Usa la API oficial de Meta y conserva el aislamiento de credenciales y números por negocio o sede.
- No registres tokens, payloads sensibles ni URLs firmadas completas.
- Para audio o multimedia, verifica tipo MIME, descarga autorizada, caché privada y reproducción real en navegador y móvil.
