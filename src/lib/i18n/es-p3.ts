import type { enP3 } from "./en-p3";

// Palabras de la Fase 3 (español). Deben tener exactamente las mismas llaves que en-p3.ts.
export const esP3: Record<keyof typeof enP3, string> = {
  "update.available": "Hay una actualización — toca para recargar",
  "snooze.tonight": "Esta noche (8 PM)",
  "snooze.tonightPassed": "Ya es muy tarde para “esta noche”. Elige otra hora.",

  "quick.title": "Acciones rápidas",
  "quick.done": "Marcado como hecho ✓",
  "quick.snoozed": "Pospuesto ⏰",

  "delivery.link": "Registro de entregas",
  "delivery.link.body": "¿Llegó un recordatorio? Mira los últimos 20 intentos y por qué.",
  "delivery.title.pre": "Registro de",
  "delivery.title.accent": "entregas",
  "delivery.body": "Cada vez que Nudge intentó avisarte, lo más nuevo primero. Si algo no llegó, aquí está el motivo.",
  "delivery.health": "¿Está listo este teléfono?",
  "delivery.noPhones": "Ningún teléfono está registrado para notificaciones. Toca Activar notificaciones abajo.",
  "delivery.phones": "{n} teléfono(s) registrado(s) ({hosts}).",
  "delivery.keysOk": "Las claves de notificación del servidor se ven bien.",
  "delivery.quiet": "Horas de silencio {from}–{to}. Lo urgente {urgent}.",
  "delivery.urgentOn": "puede avisarte igual",
  "delivery.urgentOff": "espera hasta la mañana",
  "delivery.last": "Últimos 20 intentos",
  "delivery.empty": "Todavía nada. Toca “Enviar notificación de prueba ahora” arriba para crear la primera entrada.",
  "delivery.missingSql": "El registro de entregas necesita el archivo nuevo (0007). Ejecútalo en Supabase y recarga.",
  "delivery.status.sent": "Entregada",
  "delivery.status.failed": "Falló",
  "delivery.status.held": "En espera",
  "delivery.status.skipped": "No enviada",
  "delivery.status.no_phone": "Sin teléfono",
  "delivery.kind.reminder": "Recordatorio",
  "delivery.kind.summary": "Resumen de la mañana",
  "delivery.kind.test": "Prueba",
  "delivery.kind.catchup": "Aviso atrasado",
  "delivery.kind.grade": "Nueva nota",
  "delivery.kind.habit": "Hábitos",
};
