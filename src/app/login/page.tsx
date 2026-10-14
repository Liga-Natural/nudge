import { APP_NAME, APP_TAGLINE } from "@/lib/config";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-12">
      <h1 className="text-4xl font-extrabold tracking-tight">
        Welcome to{" "}
        <span className="bg-gradient-to-r from-orange-500 to-rose-500 bg-clip-text text-transparent">
          {APP_NAME}
        </span>
      </h1>
      <p className="text-neutral-600">{APP_TAGLINE}</p>
      <LoginForm />
    </main>
  );
}
