import { Wizard } from "@/components/onboarding/Wizard";

/** Public preview of onboarding; building needs an account. */
export default function Start() {
  return (
    <main className="flex flex-1 items-start justify-center p-4 py-10">
      <Wizard />
    </main>
  );
}
