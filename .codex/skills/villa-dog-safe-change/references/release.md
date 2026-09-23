# Git y producción

- Confirma `git status`, diff, rama y remoto antes de integrar cambios.
- Usa solamente `origin/main` de `https://github.com/thevilladog/The-villa-dog.git`.
- No mezcles archivos locales ajenos ni descartes trabajo existente.
- Revisa migraciones Prisma por compatibilidad y despliegue gradual; nunca ejecutes una operación destructiva contra producción por inferencia.
- Ejecuta la compilación de cada lado modificado. Añade pruebas dirigidas solo cuando cubran un riesgo real.
- Nunca incluyas `.env`, tokens ni credenciales en commits, logs o capturas.
- Tras un despliegue autorizado, comprueba salud, logs y el flujo modificado. Usa únicamente el proyecto Railway de The Villa Dog.
- Resume commit, validaciones y limitaciones con datos verificables.
