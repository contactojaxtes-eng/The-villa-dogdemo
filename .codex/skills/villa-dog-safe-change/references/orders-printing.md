# Pedidos, pagos e impresión

## Pedidos y cobros

- En domicilio, exige una tarifa de entrega explícita; no uses `0` como valor silencioso.
- Una edición debe conservar la identidad del pedido, su chat y el historial de cambios.
- Mantén separados domicilio, recoger y mesa en filtros, estados y comandas.
- Los pagos mixtos deben conservar cada componente y cuadrar exactamente con el total.

## Impresión térmica

- No trunques notas de productos ni instrucciones del cliente.
- Elimina únicamente etiquetas internas como `(#id)` o `[PARA LLEVAR]`.
- Ajusta con `wrapText`: 32 columnas para 58 mm y 48 para 80 mm.
- Normaliza caracteres incompatibles en payloads ESC/POS crudos cuando la impresora lo requiera.
- Al cobrar en efectivo o transferencia, abre el cajón con `openCashDrawer` sin mostrar un PDF emergente.
- Una reimpresión debe ser explícita e idempotente; una alerta o reconciliación nunca debe volver a imprimir por sí sola.
