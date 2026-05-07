"use client";

import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { fetchApplicationStatus } from "../../../lib/api";

function StatusPageContent() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);

    try {
      const application = await fetchApplicationStatus(email);
      setResult(application);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to fetch status");
    } finally {
      setLoading(false);
    }
  }

  const statusLabel =
    result?.status === "UNDER_REVIEW" && result?.reviewNote
      ? "Additional information required"
      : result?.status === "APPROVED"
        ? "Approved"
        : result?.status === "REJECTED"
          ? "Application update"
          : result?.status ?? "";

  const statusMessage =
    result?.status === "UNDER_REVIEW" && result?.reviewNote
      ? "Our team needs a few more details before we can continue with your application."
      : result?.status === "APPROVED"
        ? "Your application has been approved. You can now continue with ChaufX driver access."
        : result?.status === "REJECTED"
          ? "There is an important update on your application. Please review the note below."
          : "Your application is being reviewed by our team.";

  return (
    <main className="min-h-screen bg-[#F6F8FC] px-5 py-10">
      <div className="mx-auto max-w-3xl">
        <section className="rounded-[36px] border border-[#E5E7EB] bg-white p-8 shadow-[0_30px_90px_-55px_rgba(15,23,42,0.24)] md:p-10">
          <div className="flex items-center justify-between gap-4">
            <Link href="/" className="relative block h-14 w-[210px] max-w-[60vw]">
              <Image src="/driver-status-logo.png" alt="ChaufX Canada" fill className="object-contain object-left" priority />
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full border border-[#E5E7EB] px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-[#D4D8E0] hover:bg-[#F8FAFC] hover:text-[#0F172A]"
            >
              <span aria-hidden="true">←</span>
              <span>Back to website</span>
            </Link>
          </div>
          <div className="mt-6 text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#4338CA]">Application status</div>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-[#0F172A]">Check your onboarding status</h1>

          <form className="mt-8 flex gap-3" onSubmit={onSubmit}>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="driver@email.com"
              className="flex-1 rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#4F46E5]"
            />
            <button
              type="submit"
              className="rounded-2xl bg-[#4F46E5] px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_32px_-18px_rgba(79,70,229,0.55)]"
            >
              {loading ? "Checking..." : "Check"}
            </button>
          </form>

          {error ? <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}

          {result ? (
            <div className="mt-6 rounded-[30px] border border-[#E5E7EB] bg-[#F8F9FC] p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm text-slate-500">Current status</div>
                  <div className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-[#0F172A]">{statusLabel}</div>
                </div>
              </div>

              <div className="mt-5 text-sm text-slate-600">
                Service areas: {result.preferredServiceAreas.join(", ")} · Documents: {result.documents.length}
              </div>
              <div className="mt-3 rounded-2xl border border-[#E5E7EB] bg-white px-4 py-4">
                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Application update</div>
                <div className="mt-2 text-sm text-slate-600">{statusMessage}</div>
                <div className="mt-3 text-sm font-medium text-slate-800">
                  {result.reviewNote ? `Review note: ${result.reviewNote}` : "No additional note has been shared yet."}
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-[24px] border border-white bg-white p-4">
                  <div className="text-[0.68rem] uppercase tracking-[0.22em] text-slate-400">Email on file</div>
                  <div className="mt-2 text-base font-semibold text-[#0F172A]">{result.email}</div>
                </div>
                <div className="rounded-[24px] border border-white bg-white p-4">
                  <div className="text-[0.68rem] uppercase tracking-[0.22em] text-slate-400">Applicant</div>
                  <div className="mt-2 text-base font-semibold text-[#0F172A]">{result.fullName}</div>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

export default function StatusPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#F6F8FC] px-5 py-10">
          <div className="mx-auto max-w-3xl">
            <section className="rounded-[36px] border border-[#E5E7EB] bg-white p-8 shadow-[0_30px_90px_-55px_rgba(15,23,42,0.24)] md:p-10">
              <div className="flex items-center justify-between gap-4">
                <Link href="/" className="relative block h-14 w-[210px] max-w-[60vw]">
                  <Image src="/driver-status-logo.png" alt="ChaufX Canada" fill className="object-contain object-left" priority />
                </Link>
                <Link
                  href="/"
                  className="inline-flex items-center gap-2 rounded-full border border-[#E5E7EB] px-4 py-2 text-sm font-medium text-slate-600"
                >
                  <span aria-hidden="true">←</span>
                  <span>Back to website</span>
                </Link>
              </div>
              <div className="mt-6 text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#4338CA]">Application status</div>
              <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-[#0F172A]">Loading your onboarding status</h1>
              <p className="mt-4 text-sm leading-7 text-slate-600">Please wait while we prepare the status check page.</p>
            </section>
          </div>
        </main>
      }
    >
      <StatusPageContent />
    </Suspense>
  );
}
