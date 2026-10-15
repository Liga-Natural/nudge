import { redirect } from "next/navigation";
import { getCtx } from "@/lib/context";
import { Onboarding } from "./onboarding";

export default async function OnboardingPage() {
  const ctx = await getCtx();
  if (ctx.state !== "ready") return null;
  if (ctx.profile.onboarded) redirect("/");
  return <Onboarding startLang={ctx.profile.language} />;
}
