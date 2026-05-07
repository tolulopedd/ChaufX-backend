"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { PublicPageShell } from "../../../components/public-page-shell";
import { requestDriverOnboardingVerificationEmail } from "../../../lib/api";

export default function DriverApplyIntroPage() {
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [lead, setLead] = useState({
    firstName: "",
    lastName: "",
    email: ""
  });

  async function sendVerification(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setError("");

    try {
      const response = await requestDriverOnboardingVerificationEmail(lead);
      setMessage(response.message);
      setPreviewUrl(response.previewUrl ?? "");
      setSubmitted(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to send verification email");
    } finally {
      setSending(false);
    }
  }



  return (

      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-5 py-30 md:px-8">
              <div className="mb-6">
      <Link
        href="/"
        className="inline-flex items-center text-sm font-semibold text-[#2563EB] hover:underline"
      >
        ← Back
      </Link>
    </div>
          <div className="grid gap-6 lg:grid-cols-[0.48fr_0.52fr]">
            <div className="rounded-[30px] border border-[#E5E7EB] bg-[#F8FAFC] p-7 shadow-[0_24px_70px_-50px_rgba(15,23,42,0.18)]">
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#4338CA]">ChaufX network</div>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-[#0F172A]">
                A growing pool of certified drivers across Canada.
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-600">
                ChaufX is building a large network of certified chauffeurs across Canada that customers can access anytime for personal driving needs.
              </p>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                This role involves driving our customers&apos; own vehicles while delivering professional service, strong communication, and a dependable customer experience.
              </p>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                We take customer service seriously and continue to grow across cities, territories, and provinces. We are looking for tech-savvy drivers who are passionate, energetic, and committed to excellent service.
              </p>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                If you believe you are a strong fit for this role, start here.
              </p>
            </div>

            <div className="rounded-[30px] border border-[#E5E7EB] bg-white p-7 shadow-[0_24px_70px_-50px_rgba(15,23,42,0.18)]">
              {!submitted ? (
                <>
                  <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#4338CA]">Interested in joining our team?</div>
                  <h2 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-[#0F172A]">Start your onboarding.</h2>
                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    Already applied?{" "}
                    <Link href="/driver/status" className="font-semibold text-[#2563EB]">
                      Check status of your application
                    </Link>
                    .
                  </p>

                  <form
                    className="mt-8 grid gap-4 md:grid-cols-2"
                    onSubmit={sendVerification}
                  >
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">First name</span>
                      <input
                        className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]"
                        value={lead.firstName}
                        onChange={(event) => setLead((current) => ({ ...current, firstName: event.target.value }))}
                        required
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">Last name</span>
                      <input
                        className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]"
                        value={lead.lastName}
                        onChange={(event) => setLead((current) => ({ ...current, lastName: event.target.value }))}
                        required
                      />
                    </label>
                    <label className="block md:col-span-2">
                      <span className="mb-2 block text-sm font-medium text-slate-700">Email</span>
                      <input
                        type="email"
                        className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]"
                        value={lead.email}
                        onChange={(event) => setLead((current) => ({ ...current, email: event.target.value }))}
                        required
                      />
                    </label>

                    <div className="md:col-span-2">
                      <button
                        type="submit"
                        disabled={sending}
                        className="w-full rounded-2xl bg-[#2563EB] px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_32px_-18px_rgba(37,99,235,0.55)]"
                      >
                        {sending ? "Sending..." : "Continue"}
                      </button>
                    </div>
                  </form>
                  {error ? <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
                </>
              ) : (
                <div>
                  <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#4338CA]">Success</div>
                  <h2 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-[#0F172A]">Verify your email to continue.</h2>
                  <p className="mt-4 text-sm leading-7 text-slate-600">
                    Use the detailed onboarding application form to complete your registration once your email has been verified.
                  </p>
                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    After submission, you can return to the website anytime and check your onboarding status with your email address.
                  </p>
                  <div className="mt-4 rounded-2xl border border-[#E5E7EB] bg-[#F8FAFC] px-4 py-4 text-sm leading-6 text-slate-600">
                    {message || "A verification link has been sent to your email address."} Sent to <span className="font-semibold text-[#0F172A]">{lead.email}</span>.
                  </div>
                  {previewUrl ? (
                    <div className="mt-4 rounded-2xl border border-dashed border-[#BFDBFE] bg-[#EFF6FF] px-4 py-4 text-sm leading-6 text-[#1D4ED8]">
                      Email delivery is not configured yet in this environment. Use the preview link below to continue testing.
                      <div className="mt-2">
                        <Link href={previewUrl} className="font-semibold underline">
                          Open verification preview
                        </Link>
                      </div>
                    </div>
                  ) : null}
                  {error ? <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}

                  <div className="mt-8 flex flex-wrap gap-3">
                    <button
                      type="button"
                      className="rounded-full bg-[#2563EB] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={sending}
                      onClick={async () => {
                        setSending(true);
                        setError("");

                        try {
                          const response = await requestDriverOnboardingVerificationEmail(lead);
                          setMessage(response.message);
                          setPreviewUrl(response.previewUrl ?? "");
                        } catch (reason) {
                          setError(reason instanceof Error ? reason.message : "Unable to resend verification email");
                        } finally {
                          setSending(false);
                        }
                      }}
                    >
                      {sending ? "Sending..." : "Resend email"}
                    </button>
                    <span
                      aria-disabled
                      className="pointer-events-none cursor-not-allowed rounded-full bg-slate-200 px-5 py-3 text-sm font-semibold text-slate-400"
                    >
                      Open detailed form
                    </span>
                    <span
                      aria-disabled
                      className="pointer-events-none cursor-not-allowed rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-400"
                    >
                      Check status
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

  );
}
