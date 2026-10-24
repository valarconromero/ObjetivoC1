# Objetivo C1

App web sencilla para seguir el plan de inglés C1 en 24 semanas (10 h/semana, empieza el 26/10/2026).

- **Hoy**: registra tiempo en 2 toques (bloque + minutos), racha de días con ≥ 30 min y últimos registros.
- **Semana**: progreso hacia 10 h, minutos por día y horas por bloque frente a su objetivo.
- **Plan**: contenido de la semana actual (gramática, speaking, writing) sacado de `plan.json`.
- **Materiales**: enlaces, textos en Markdown, audios grabados o subidos y archivos, asociados a cada registro.
- **Progreso**: checkpoints (semanas 1, 8, 16, 20 y 23) con nivel y puntuación por parte, gráfico de evolución, exportación CSV y copia completa en ZIP.

Todo se guarda en el navegador (IndexedDB). No hay servidor ni cuentas.

## Usarla en el móvil

1. Publica el repositorio con GitHub Pages: *Settings › Pages › Deploy from a branch*, rama principal, carpeta `/ (root)`.
2. Abre la URL en el móvil y añádela a la pantalla de inicio (Safari: *Compartir › Añadir a pantalla de inicio*; Chrome: *Instalar app*).
3. Funciona sin conexión una vez abierta.

En iPhone, instálala en la pantalla de inicio: Safari puede borrar los datos de webs que no visitas en varios días.

## Copias de seguridad

Los datos (sobre todo los audios) solo existen en ese dispositivo. Usa **Progreso › Copia completa** de vez en cuando; la app te lo recuerda cada 14 días. El ZIP contiene:

```
datos.json          todo, para restaurar con "Restaurar copia…"
registros.csv       una fila por registro
checkpoints.csv     una fila por checkpoint
materiales/semana-NN/…  textos (.md) y audios/archivos
```

## Cambiar el plan

Edita `plan.json` o carga otro desde **Progreso › Cargar plan desde JSON…**. Formato:

```json
{
  "start": "2026-10-26",
  "weeks_total": 24,
  "checkpoints": [1, 8, 16, 20, 23],
  "blocks": [{ "id": "speaking", "hours": 3, "what": "…" }],
  "phases": [{ "name": "Fase 1…", "from": 1, "to": 8, "goal": "…" }],
  "weeks": [{ "week": 1, "grammar": "…", "speaking": "…", "writing": "…", "checkpoint": true, "note": "…" }]
}
```

Los ids de bloque son fijos: `speaking`, `listening`, `writing`, `reading`, `grammar`, `shadowing`.

## Desarrollo

Sin dependencias ni compilación.

```
npm start   # servidor local en http://localhost:8000
npm test    # tests de la lógica (Node 20+)
```

Al publicar cambios, sube `VERSION` en `sw.js` para que los móviles descarguen la versión nueva.
