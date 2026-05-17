"use client";

import Link from "next/link";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { AdminBrand } from "../../components/admin-brand";
import { confirmPasswordReset, validatePasswordResetToken } from "../../lib/api";

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 3l18 18" strokeLinecap="round" />
      <path d="M10.58 10.58A2 2 0 0012 14a2 2 0 001.42-.58" strokeLinecap="round" />
      <path d="M9.88 5.09A10.94 10.94 0 0112 4c5.23 0 9.27 3.11 10 8a10.33 10.33 0 01-3.11 5.09" strokeLinecap="round" />
      <path d="M6.71 6.7C4.68 8 3.36 9.83 2 12c.73 4.89 4.77 8 10 8 2.17 0 4.11-.53 5.74-1.47" strokeLinecap="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2 12s3.64-8 10-8 10 8 10 8-3.64 8-10 8-10-8-10-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function ResetPasswordPageContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [loadingState, setLoadingState] = useState<"validating" | "ready" | "invalid" | "done">("validating");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    async function validate() {
      if (!token) {
        setError("This password reset link is missing or invalid.");
        setLoadingState("invalid");
        return;
      }

      try {
        const result = await validatePasswordResetToken(token);
        setEmail(result.email);
        setFirstName(result.fullName.trim().split(/\s+/)[0] ?? result.fullName);
        setLoadingState("ready");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "This password reset link is no longer valid.");
        setLoadingState("invalid");
      }
    }

    void validate();
  }, [token]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const result = await confirmPasswordReset({
        token,
        password,
        confirmPassword
      });
      setSuccess(result.message);
      setLoadingState("done");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to reset password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#eef3fb_0%,#f8fafc_45%,#eef2ff_100%)] px-5 py-10">
      <div className="mx-auto max-w-xl">
        <section className="rounded-[36px] border border-[#E5E7EB] bg-white p-8 shadow-[0_30px_90px_-55px_rgba(15,23,42,0.24)] md:p-10">
          <AdminBrand href="/" compact variant="login" />
          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#4338CA]">Reset password</div>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-[#0F172A]">
            {loadingState === "done" ? "Password updated" : "Choose a new password"}
          </h1>

          {loadingState === "validating" ? (
            <p className="mt-6 rounded-2xl bg-[#F8FAFC] px-4 py-4 text-sm text-slate-600">
              Verifying your secure reset link.
            </p>
          ) : null}

          {loadingState === "invalid" ? (
            <div className="mt-6 space-y-4">
              <p className="rounded-2xl bg-rose-50 px-4 py-4 text-sm text-rose-700">
                {error || "This password reset link is no longer valid."}
              </p>
              <Link
                href="/login"
                className="block w-full rounded-2xl bg-[#2563EB] px-5 py-3 text-center text-sm font-semibold text-white shadow-[0_16px_32px_-18px_rgba(37,99,235,0.55)]"
              >
                Back to login
              </Link>
            </div>
          ) : null}

          {loadingState === "ready" ? (
            <form className="mt-8 space-y-4" onSubmit={onSubmit}>
              <div className="rounded-[28px] border border-[#E5E7EB] bg-[#F8FAFC] p-5">
                <div className="text-sm font-semibold text-slate-950">Resetting password for</div>
                <p className="mt-2 text-sm text-slate-600">
                  {firstName ? `Hello ${firstName}, ` : ""}set a new password for <span className="font-semibold text-slate-800">{email}</span>.
                </p>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">New password</span>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 pr-12 outline-none transition focus:border-[#2563EB]"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    minLength={8}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    className="absolute inset-y-0 right-0 flex items-center px-4 text-slate-500 transition hover:text-[#0F172A]"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    <EyeIcon open={showPassword} />
                  </button>
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Confirm new password</span>
                <input
                  type={showPassword ? "text" : "password"}
                  className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  minLength={8}
                  required
                />
              </label>

              {error ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl bg-[#2563EB] px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_32px_-18px_rgba(37,99,235,0.55)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Updating password..." : "Save new password"}
              </button>
            </form>
          ) : null}

          {loadingState === "done" ? (
            <div className="mt-8 space-y-4">
              <p className="rounded-2xl bg-emerald-50 px-4 py-4 text-sm text-emerald-700">
                {success || "Your password has been updated. You can now sign in."}
              </p>
              <Link
                href={`/login?email=${encodeURIComponent(email)}`}
                className="block w-full rounded-2xl bg-[#2563EB] px-5 py-3 text-center text-sm font-semibold text-white shadow-[0_16px_32px_-18px_rgba(37,99,235,0.55)]"
              >
                Continue to login
              </Link>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[linear-gradient(180deg,#eef3fb_0%,#f8fafc_45%,#eef2ff_100%)] px-5 py-10">
          <div className="mx-auto max-w-xl">
            <section className="rounded-[36px] border border-[#E5E7EB] bg-white p-8 shadow-[0_30px_90px_-55px_rgba(15,23,42,0.24)] md:p-10">
              <AdminBrand href="/" compact variant="login" />
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#4338CA]">Reset password</div>
              <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-[#0F172A]">Preparing reset</h1>
              <p className="mt-4 text-sm leading-7 text-slate-600">Please wait while we verify your secure reset link.</p>
            </section>
          </div>
        </main>
      }
    >
      <ResetPasswordPageContent />
    </Suspense>
  );
}
