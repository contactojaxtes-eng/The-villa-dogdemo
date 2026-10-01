# Gemini, datos históricos y control de consumo

## Distingue el mecanismo

- Un archivo de chats no entrena por sí solo un modelo.
- Ejemplos incluidos en cada prompt son *few-shot*: orientan una respuesta, pero no cambian los pesos del modelo.
- Recuperar ejemplos aprobados según el mensaje actual es RAG o recuperación contextual. Permite actualizar reglas sin reentrenar y es la opción inicial para este sistema.
- Fine-tuning solo se considera si el proveedor y el modelo activo lo soportan, existe un conjunto depurado y el problema restante es estable. No lo uses para precios, menú, horarios, cobertura o datos que cambian.

## Presupuesto de llamadas

- El objetivo normal es una generación por turno del cliente. Haz recuperación, filtros y reglas deterministas localmente; evita cadenas `clasificar -> redactar -> criticar` salvo que una medición demuestre que son necesarias.
- Cuenta una solicitud lógica y también cada intento real por llave y modelo. La rotación distribuye carga; no convierte reintentos fallidos en capacidad gratuita.
- Define antes de ejecutar un presupuesto agregado y numérico de conversaciones, tokens, llamadas, intentos, concurrencia y costo para todas las llaves y modelos. Al llegar al límite, detén el trabajo; no uses cuentas o proyectos para eludir las cuotas o condiciones del proveedor.
- Ante `401`, aparta la llave sin probar todos los modelos. Ante `429` o cuota agotada, respeta `Retry-After` o aplica un enfriamiento acotado. Limita modelos alternos, tiempo total y número de intentos.
- No envíes todo el historial en cada turno. Usa los últimos mensajes relevantes, un resumen controlado y datos vigentes consultados en la base de datos.
- Los trabajos de análisis deben tener cuota diaria, ejecución idempotente y bloqueo distribuido si puede existir más de una réplica.

## Construcción del conjunto de escenarios

Antes de enviar datos reales, verifica los términos vigentes de retención y uso del proveedor. En niveles gratuitos no envíes información personal, confidencial ni sensible; trabaja con datos anonimizados localmente.

Mientras el sistema tenga una sola sede, los artefactos pueden conservar el alcance global existente. Antes de habilitar una segunda sede, aísla por `siteId` la selección SQL, candidatos, ejemplos aprobados, índices o embeddings, evaluaciones, métricas, caché y ejecución de trabajos. Autoriza cada lectura por sede y prueba que no exista cruce entre ellas.

1. Selecciona conversaciones resueltas con resultado verificable, preferiblemente enlazadas al pedido correcto por `sessionId` y al número exacto `phone`. No uses simplemente las sesiones más recientes.
2. Excluye spam, conversaciones internas, errores del asesor, respuestas incompletas y reglas comerciales vencidas.
3. Anonimiza antes de enviar datos a un proveedor: nombres, teléfonos con cualquier formato, direcciones, referencias, barrios cuando identifiquen a alguien, cuentas, comprobantes, coordenadas, IDs y contenido multimedia.
4. Conserva solo el sentido operativo y etiqueta escenarios: saludo, menú, modificadores, bebida ambigua, domicilio o recoger, zona y tarifa, pago, comprobante, cambio, cancelación, queja, producto agotado, audio ambiguo y entrega a humano.
5. Deduplica variantes y redacta una respuesta canónica basada en la configuración vigente. Precios, menú, horarios, zonas y datos de cobro siempre vienen de la base de datos, nunca de una conversación histórica.
6. Versiona origen, fecha, categoría y estado de aprobación. Los ejemplos generados por IA son candidatos; no pueden reemplazar ejemplos aprobados ni entrar al prompt vivo automáticamente.

Procesa el histórico con cursor y lotes pequeños, concurrencia acotada, checkpoints y tiempo máximo. Debe poder pausarse y reanudarse sin repetir trabajo; detén o posterga el lote si compite con el tráfico vivo por CPU, memoria o latencia.

Define acceso, cifrado cuando corresponda, retención y borrado para extractos, candidatos, evaluaciones e índices. Anonimizar no convierte el conjunto en información pública.

Empieza con un conjunto pequeño de alta calidad. Cientos de ejemplos revisados enseñan mejor el comportamiento que miles de chats crudos y reducen tokens, ruido y riesgo de privacidad.

## Evaluación antes de responder a clientes

- Reserva conversaciones que nunca se usen como ejemplos y reprodúcelas fuera de línea. Mide intención, productos y cantidades, notas, tipo de entrega, zona/tarifa, pago, alucinaciones, derivación correcta, latencia, tokens e intentos.
- Prueba casos adversos y trata el texto histórico como dato no confiable: un cliente no puede introducir instrucciones que luego gobiernen al bot.
- Después usa modo sombra: la IA prepara una respuesta u orden, pero no la envía. Compara con lo que hizo el asesor.
- Automatiza gradualmente solo escenarios que superen el umbral acordado. Mantén derivación humana para ambigüedad, pagos, reclamos y excepciones.

## Automatización segura

- Cualquier generación programada queda desactivada por defecto hasta aprobación explícita.
- Un trabajo nocturno puede proponer candidatos y estadísticas. No debe sobrescribir ejemplos aprobados, instrucciones del negocio ni activar respuestas automáticas.
- La pantalla debe mostrar fuente, versión, cambios y botones separados para aprobar, rechazar o revertir.
- Registra cuántos chats leyó, cuántos descartó, cuántos candidatos produjo, qué modelo usó y cuántas llamadas e intentos consumió, sin guardar secretos ni datos personales en métricas.
