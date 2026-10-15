import type { Profile } from "./types";

// Everything beyond the core is optional and OFF until switched on in Settings > Features.
export const FEATURE_KEYS = [
  "payments",
  "school",
  "grades",
  "feeds",
  "updates",
  "work",
  "habits",
  "birthdays",
  "renewals",
  "inbox",
  "bills",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const featureOn = (profile: Pick<Profile, "features">, key: FeatureKey) => profile.features?.[key] === true;
