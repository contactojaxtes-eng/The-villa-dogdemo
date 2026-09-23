# Guía práctica para Codex, Antigravity y Claude

Las skills y los archivos de instrucciones ayudan a reducir repeticiones y errores, pero no crean un descuento automático de tokens. La mayor mejora viene de cargar solo el contexto necesario y evitar conversaciones que acumulen muchos objetivos distintos.

## Estructura de este repositorio

- `AGENTS.md`: pocas reglas permanentes que todos los agentes deben conocer.
- `GEMINI.md` y `CLAUDE.md`: apuntan a la misma fuente para evitar tres copias que se desactualicen.
- `.codex/skills/villa-dog-safe-change/`: flujo bajo demanda para cambios con riesgo operativo. Codex carga su contenido cuando la tarea lo necesita.
- Los planes e informes históricos siguen disponibles, pero no deben leerse automáticamente.

## Cómo gastar menos contexto

1. Abre una tarea nueva por objetivo grande: rendimiento, nueva sede, IA, diseño o impresión.
2. Entrega una sola meta, restricciones y criterio de terminado. Agrega capturas o audios únicamente cuando aporten evidencia nueva.
3. Para continuar trabajo anterior, pega un resumen corto con commit actual, qué está terminado, qué falta y decisiones ya aprobadas.
4. Pide búsquedas dirigidas y validación del módulo afectado. Evita solicitar una revisión total del repositorio para un cambio pequeño.
5. Usa subagentes solo cuando existan investigaciones independientes que puedan correr en paralelo. Su trabajo también consume uso.
6. Conserva un chat largo para un mismo objetivo. Cuando el objetivo cambie, crea otra tarea.

## Plantilla recomendada

```text
Objetivo: [resultado concreto].
Estado actual: [qué funciona y commit si lo sabes].
No debe cambiar: [flujos críticos].
Criterio de terminado: [comportamiento verificable].
Trabaja de forma autónoma, lee solo el contexto relacionado, valida lo afectado y no hagas push hasta que lo autorice.
```

Para un cambio delicado en Codex puedes empezar con:

```text
$villa-dog-safe-change
[objetivo y criterios]
```

## Qué evitar

- Mantener en una sola tarea semanas de temas distintos.
- Crear una skill para cada pantalla o regla pequeña.
- Duplicar las mismas reglas en `AGENTS.md`, `GEMINI.md` y `CLAUDE.md`.
- Obligar al agente a leer todos los documentos antes de cualquier edición.
- Ejecutar navegador, compilaciones completas o auditorías generales cuando una herramienta o prueba dirigida resuelve la duda.
