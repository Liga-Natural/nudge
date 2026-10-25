import type { AddKind } from "./add-flows";

export const ADD_EVENT = "nudge:add";

/** Opens the add sheet from anywhere, optionally straight into one kind ("No homework 🎉 - add something?"). */
export function openAdd(kind?: AddKind) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ADD_EVENT, { detail: { kind: kind ?? null } }));
}
