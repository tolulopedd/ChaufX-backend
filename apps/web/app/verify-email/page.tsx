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
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Verifying your email now.");
  const [verifiedPurpose, setVerifiedPurpose] = useState<"driver" | "customer" | null>(null);
  const [driverContinueHref, setDriverContinueHref] = useState("");

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
            lastName: result.payload?.lastName ?? "",
            verified: "1"
          });

          router.replace(`/driver/application-form?${params.toString()}`);
          return;
        }

        setVerifiedPurpose("customer");
        setStatus("success");
        setMessage("Your email has been verified. Welcome to ChaufX Canada. You can now sign in to your account.");
        window.setTimeout(() => {
          router.replace(`/login?verified=1&email=${encodeURIComponent(result.email)}`);
        }, 1400);
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
    <PublicPageShell heroTitle="Verify email" heroCopy="Complete your email verification to continue with ChaufX.">
      <section className="bg-white">
        <div className="mx-auto max-w-3xl px-5 py-16 md:px-8">
          <div
            className={`rounded-[30px] border p-8 text-center shadow-[0_24px_70px_-50px_rgba(15,23,42,0.18)] ${
              status === "success" && verifiedPurpose === "driver"
                ? "border-[#C7D2FE] bg-[linear-gradient(180deg,#EEF2FF_0%,#FFFFFF_100%)]"
                : status === "success" && verifiedPurpose === "customer"
                  ? "border-[#BFDBFE] bg-[linear-gradient(180deg,#EFF6FF_0%,#FFFFFF_100%)]"
                  : "border-[#E5E7EB] bg-white"
            }`}
          >
            {status === "loading" ? (
              <>
                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#4338CA]">Verification</div>
                <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-[#0F172A]">Confirming your email.</h1>
                <p className="mt-4 text-sm leading-7 text-slate-600">{message}</p>
              </>
            ) : status === "success" ? (
              <>
                <div
                  className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${
                    verifiedPurpose === "driver" ? "bg-[#4338CA] text-white" : "bg-[#2563EB] text-white"
                  }`}
                >
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div
                  className={`mt-5 text-[0.68rem] font-semibold uppercase tracking-[0.24em] ${
                    verifiedPurpose === "driver" ? "text-[#4338CA]" : "text-[#2563EB]"
                  }`}
                >
                  {verifiedPurpose === "driver" ? "Driver onboarding verified" : "Customer email verified"}
                </div>
                <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-[#0F172A]">
                  {verifiedPurpose === "driver" ? "You’re ready for the next step." : "Welcome to ChaufX Canada."}
                </h1>
                <p className="mt-4 text-sm leading-7 text-slate-600">{message}</p>
                {verifiedPurpose === "driver" ? (
                  <div className="mx-auto mt-6 max-w-md rounded-[24px] border border-[#C7D2FE] bg-white/80 p-4 text-left">
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[#4338CA]">Next step</div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      Continue to the onboarding application form and complete your full driver registration.
                    </p>
                  </div>
                ) : (
                  <div className="mx-auto mt-6 max-w-md rounded-[24px] border border-[#BFDBFE] bg-white/80 p-4 text-left">
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[#2563EB]">Account ready</div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      Your customer account is confirmed. We’ll take you back to sign in so you can continue.
                    </p>
                  </div>
                )}
                {driverContinueHref ? (
                  <div className="mt-8 flex justify-center">
                    <Link
                      href={driverContinueHref}
                      className="rounded-full bg-[#4338CA] px-5 py-3 text-sm font-semibold text-white"
                    >
                      Continue to onboarding form
                    </Link>
                  </div>
                ) : (
                  <p className="mt-6 text-sm font-medium text-[#2563EB]">Redirecting you to sign in.</p>
                )}
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
        <PublicPageShell heroTitle="Verify email" heroCopy="Complete your email verification to continue with ChaufX.">
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
