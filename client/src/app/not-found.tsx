import Link from "next/link";

export default function NotFound() {
  return (
    <main className="gutter py-12">
      <h1 className="mb-4 font-heading text-[40px]">Record not found</h1>
      <Link href="/" className="text-muted underline underline-offset-4">
        Back to Orders
      </Link>
    </main>
  );
}
