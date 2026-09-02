# The Villa Dog: estado y flujo

Actualizado el 2 de septiembre de 2026. Repositorio indicado por el propietario: `thevilladog/The-villa-dog`.
Aplicación: https://the-villa-dog-backend-production.up.railway.app

## Flujo sencillo

1. Abrir la caja del turno.
2. Pulsar **Nuevo pedido** y escribir un nombre: Carlos, Familia Pérez, Carro rojo. No se selecciona número de mesa.
3. Agregar productos y enviar a cocina. La cuenta se crea en ese momento. Dos cuentas nuevas con el mismo nombre siguen siendo distintas; para ampliar una existente, usar **Agregar productos** dentro de esa cuenta.
4. Cocina prepara y marca listo. Las ediciones actualizan la tarjeta existente.
5. Cobrar el saldo completo: efectivo o transferencia con foto y validación de caja. No se implementaron abonos parciales de mesa.
6. La cuenta se cierra cuando está pagada y cocina terminó. Si se cobra antes, sigue abierta hasta completar la preparación.
7. Conciliar ventas, efectivo y transferencias y cerrar el turno.

## Correcciones realizadas

- Retirados Mesa 1–10 y el nombre numérico por defecto. Las plantillas vacías antiguas no aparecen ocupadas; las cuentas con pedidos se conservan.
- La política de producción permite imágenes temporales `blob:`. **Ver en grande** reconoce la foto local sin intentar descargarla desde la API.
- La foto se decodifica, convierte a JPEG, limita a 1800 píxeles y comprime antes de subir. Una imagen ilegible muestra un error; máximo de carga: 5 MB.
- Un comprobante por cobro se guarda en PostgreSQL y se descarga con autenticación. Las listas y eventos llevan metadatos, no fotos completas. Las fotos nuevas no dependen del disco efímero de Railway.
- Cuenta, pedido, pago inicial y comandas se crean en una transacción. Si cocina falla se revierte todo. Reintentos con el mismo identificador no duplican cuentas.
- El cobro y su validación afectan todos los pedidos pendientes de la cuenta en una transacción. Se comprueba el importe completo y se impiden decisiones contradictorias simultáneas.
- El comprobante rechazado conserva su historial al subir un reemplazo. La foto no se borra al cerrar caja: la retención predeterminada es de 30 días y se limpia al cerrar una caja posterior. `RECEIPT_RETENTION_DAYS=0` desactiva esa caducidad. Importes y decisiones permanecen.
- El menú público espera que se guarde el pedido antes de vaciar el carrito. El servidor filtra campos y calcula precios desde el catálogo, sin aceptar cortesías enviadas por visitantes.
- Login y dashboard mantienen el rediseño anterior, sin radar ni cifras de demostración.

## Railway y presupuesto

**Una aplicación Railway + PostgreSQL** es adecuada para un piloto. La aplicación sirve frontend, API y Socket.IO; Vercel no es necesario.

El saldo US$4,99/30 días de la captura es una prueba. Hobby tiene un mínimo mensual de US$5 aplicable al consumo; no garantiza que aplicación y base juntas consuman solo US$5. Se paga el consumo superior si se excede. Fuentes: [prueba de Railway](https://docs.railway.com/pricing/free-trial) y [facturación](https://docs.railway.com/pricing/understanding-your-bill).

Mantener inicialmente una réplica, conexión privada a PostgreSQL y alertas de gasto. Medir durante turnos reales. Para varias réplicas hacen falta estado compartido y adaptador de Socket.IO; aumentar réplicas por sí solo no comparte presencia ni eventos.

## Validaciones y límites

- Compilaciones Nest y Vite y revisión de tipos completadas. Auditoría de dependencias de producción: 0 vulnerabilidades conocidas en cliente y servidor.
- Migraciones ejecutadas en una base PostgreSQL local separada; comparación con el esquema sin diferencias.
- 26 pruebas automáticas aprobadas en 6 suites, incluyendo cuentas por nombre, reintentos simultáneos, reversión por fallo de cocina, cobros con varios pedidos, importes incorrectos, comprobantes inválidos y revisiones concurrentes.
- Inicio de sesión y formulario por nombre comprobados localmente. La imagen seleccionada mediante el control de cámara mostró vista previa correcta a 390 × 844. No se probó una cámara física de teléfono.
- No se crearon pedidos ni cobros de prueba en la base publicada.

Usuarios y contraseñas actuales conservados por decisión del propietario. Verificación por correo y endurecimiento de esas cuentas aplazados.

Antes de depender del sistema como único registro del negocio: verificar backups y restauración de PostgreSQL, completar un turno piloto con dos dispositivos y probar cámara física, pérdida de conexión e impresora. El cierre de caja y los endpoints heredados de domicilios requieren revisión adicional de concurrencia antes de escalar. El arranque heredado usa `prisma db push`; pasar a migraciones versionadas exige una línea base revisada de la base ya publicada.

## Próximas mejoras útiles

- Conciliación del turno clara y diferencias de caja visibles.
- Configuración de módulos compartida entre dispositivos.
- Backups verificados y retención de logs y notificaciones.
- Autorización por acción y recuperación de cuentas al retomar seguridad.
- Dejar IA, campañas y reportes grandes fuera del flujo principal hasta completar el piloto.
