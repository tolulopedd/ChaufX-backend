"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PublicPageShell } from "../../components/public-page-shell";
import { confirmWebsiteEmailVerification } from "../../lib/api";

function VerifyEmailPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [message, setMessage] = useState("Verifying your email now.");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!token) {
        setStatus("error");
        setMessage("This verification link is incomplete.");
        return;
      }

      try {
        const result = await confirmWebsiteEmailVerification(token);

        if (cancelled) {
          return;
        }

        if (result.purpose === "DRIVER_ONBOARDING") {
          const params = new URLSearchParams({
            verificationToken: token,
            email: result.email,
            firstName: result.payload?.firstName ?? "",
            lastName: result.payload?.lastName ?? ""
          });

          router.replace(`/driver/application-form?${params.toString()}`);
          return;
        }

        router.replace(`/login?verified=1&email=${encodeURIComponent(result.email)}`);
      } catch (reason) {
        if (cancelled) {
          return;
        }

        setStatus("error");
        setMessage(reason instanceof Error ? reason.message : "Unable to verify your email.");
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [router, token]);

  return (
    <PublicPageShell heroTitle="Verify email" heroCopy="Complete your email verification to continue with DriveMe.">
      <section className="bg-white">
        <div className="mx-auto max-w-3xl px-5 py-16 md:px-8">
          <div className="rounded-[30px] border border-[#E5E7EB] bg-white p-8 text-center shadow-[0_24px_70px_-50px_rgba(15,23,42,0.18)]">
            {status === "loading" ? (
              <>
                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#4338CA]">Verification</div>
                <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-[#0F172A]">Confirming your email.</h1>
                <p className="mt-4 text-sm leading-7 text-slate-600">{message}</p>
              </>
            ) : (
              <>
                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-rose-600">Verification error</div>
                <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-[#0F172A]">This link could not be completed.</h1>
                <p className="mt-4 text-sm leading-7 text-slate-600">{message}</p>
                <div className="mt-8 flex justify-center gap-3">
                  <Link href="/driver/apply" className="rounded-full bg-[#2563EB] px-5 py-3 text-sm font-semibold text-white">
                    Driver onboarding
                  </Link>
                  <Link href="/login" className="rounded-full border border-[#E5E7EB] px-5 py-3 text-sm font-semibold text-slate-700">
                    Back to login
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </PublicPageShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <PublicPageShell heroTitle="Verify email" heroCopy="Complete your email verification to continue with DriveMe.">
          <section className="bg-white">
            <div className="mx-auto max-w-3xl px-5 py-16 md:px-8">
              <div className="rounded-[30px] border border-[#E5E7EB] bg-white p-8 text-center shadow-[0_24px_70px_-50px_rgba(15,23,42,0.18)]">
                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#4338CA]">Verification</div>
                <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-[#0F172A]">Preparing verification.</h1>
                <p className="mt-4 text-sm leading-7 text-slate-600">Please wait while we load your verification link.</p>
              </div>
            </div>
          </section>
        </PublicPageShell>
      }
    >
      <VerifyEmailPageContent />
    </Suspense>
  );
}
