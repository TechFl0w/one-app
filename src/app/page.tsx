import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Wizard } from "@/components/onboarding/Wizard";
import { buildBusiness } from "./actions";

export default async function Home() {
  const supabase = await createClient();
  const { data: businesses, error } = await supabase.from("businesses").select("id, name").order("created_at");
  if (error) throw new Error(error.message);

  if (businesses.length === 1) redirect(`/b/${businesses[0].id}`);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-4">
      {businesses.length > 1 && (
        <div className="card w-full max-w-md p-6">
          <h2 className="mb-3 font-semibold">Your businesses</h2>
          <ul className="space-y-1">
            {businesses.map((b) => (
              <li key={b.id}>
                <Link className="block rounded-xl px-3 py-2 hover:bg-ground" href={`/b/${b.id}`}>{b.name}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Wizard build={buildBusiness} />
    </main>
  );
}
