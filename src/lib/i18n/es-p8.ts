// Palabras de los widgets de la pantalla de inicio (español). Mismas claves que en-p8.ts.
import type { enP8 } from "./en-p8";

export const esP8: Record<keyof typeof enP8, string> = {
  "widgets.title": "Widgets de la pantalla de inicio",
  "widgets.body": "Pon Nudge en la pantalla de inicio y de bloqueo del iPhone con la app gratuita Scriptable. El token solo puede leer un resumen pequeño y nada más. Puedes revocarlo cuando quieras.",
  "widgets.create": "Crear token de widget",
  "widgets.error.limit": "Ya tienes 5 tokens de widget activos. Revoca uno primero.",
  "widgets.once": "Copia este token ahora y pégalo en el script. Solo se muestra una vez.",
  "widgets.copyScript": "Copiar script",
  "widgets.scriptCopied": "Script copiado ✓",
  "widgets.copyFailed": "No se pudo copiar. Selecciona el texto y cópialo a mano.",
  "widgets.steps": "Pasos",
  "widgets.step1": "Instala Scriptable (gratis) desde la App Store.",
  "widgets.step2": "Toca Copiar script, abre Scriptable, toca +, pega y ponle el nombre Nudge.",
  "widgets.step3": "Pega tu token entre las comillas de la línea TOKEN.",
  "widgets.step4": "Mantén pulsada la pantalla de inicio, toca +, elige Scriptable, un tamaño y luego Editar widget: Script = Nudge, Al interactuar = Abrir URL, Parámetro = una de las palabras de abajo.",
  "widgets.params": "Parámetros",
  "widgets.param.next": "Lo próximo con cuenta atrás y el emoji de la clase.",
  "widgets.param.today": "La lista de hoy (las próximas 4) con marcas de hecho y atrasado.",
  "widgets.param.school": "Las próximas 3 tareas y una insignia roja Atrasadas (n).",
  "widgets.param.grades": "La letra del trimestre actual de cada clase en una cuadrícula.",
  "widgets.param.week": "Franja de 7 días con el número de cosas por día (mejor en Grande).",
  "widgets.param.habits": "Los hábitos de hoy con sus rachas.",
  "widgets.param.rotate": "Una tarjeta distinta en cada actualización: próximo, escuela, notas, hábitos.",
  "widgets.lock": "Pantalla de bloqueo: añade un widget de Scriptable. En línea muestra lo próximo, el círculo el progreso de hoy y el rectángulo las próximas 2 cosas.",
  "widgets.docs": "Los pasos completos están en docs/WIDGETS.md.",
  "widgets.none": "Aún no hay tokens de widget.",
};
