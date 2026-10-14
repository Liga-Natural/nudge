import { APP_NAME } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./login/actions";
import { NotificationsPanel } from "./notifications-panel";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-10">
      <h1 className="text-4xl font-extrabold tracking-tight">
        You&apos;re in,{" "}
        <span className="bg-gradient-to-r from-orange-500 to-rose-500 bg-clip-text text-transparent">
          {APP_NAME}
        </span>{" "}
        works
      </h1>
      <p className="text-neutral-600">Signed in as {user?.email}</p>
      <NotificationsPanel />
      <form action={signOut}>
        <button className="min-h-[44px] text-neutral-600 underline">Sign out</button>
      </form>
    </main>
  );
}
