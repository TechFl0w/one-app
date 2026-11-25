/** Where customers land after a payment link. */
export default async function Paid({ searchParams }: PageProps<"/paid">) {
  const cancelled = !!(await searchParams).cancelled;
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="card max-w-sm p-8 text-center">
        <h1 className="text-xl font-bold">{cancelled ? "Payment not completed" : "Thank you!"}</h1>
        <p className="mt-2 text-sm text-muted">{cancelled ? "Nothing was charged. You can use the same link again." : "Your payment went through. You can close this page."}</p>
      </div>
    </main>
  );
}
