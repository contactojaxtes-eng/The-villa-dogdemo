---
name: villa-dog-safe-change
description: Implement or review nontrivial The Villa Dog changes that affect live WhatsApp, orders, kitchen, dispatch, printing, Socket.IO, caching, performance, Gemini usage, learning from chats, or production rollout. Use when live operation, cost, customer data, or multiple modules could be affected; skip for explanations and trivial edits.
---

# Cambio seguro en The Villa Dog

1. Lee `AGENTS.md`, revisa `git status` y confirma que el remoto o servicio involucrado pertenezca a The Villa Dog.
2. Delimita el flujo afectado y abre solo la referencia necesaria:
   - WhatsApp: `references/whatsapp.md`
   - Socket.IO, caché o rendimiento: `references/realtime-performance.md`
   - Gemini, consumo de IA o aprendizaje con chats: `references/ai-data-learning.md`
   - Pedidos, pagos o impresión: `references/orders-printing.md`
   - Git, migraciones o producción: `references/release.md`
3. Traza el flujo real de extremo a extremo antes de editar: entrada, persistencia, evento, estado del cliente y efecto operativo.
4. Haz el cambio mínimo completo. Conserva compatibilidad con datos existentes y evita duplicar conexiones, consultas, eventos o fuentes de verdad.
5. Verifica el escenario principal y el riesgo concreto de regresión. Compila únicamente los lados afectados, salvo que el cambio cruce cliente y servidor.
6. Informa qué cambió, cómo se comprobó y qué riesgo material queda. Si el usuario ya autorizó commit, push o despliegue, termina ese paso; de lo contrario deja el resultado local listo para revisar.
