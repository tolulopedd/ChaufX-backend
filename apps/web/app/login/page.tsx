"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AdminBrand } from "../../components/admin-brand";
import {
  clearStoredDriverToken,
  clearStoredToken,
  requestCustomerVerificationEmail,
  requestPasswordReset,
  setStoredDriverToken,
  setStoredToken,
  webLogin
} from "../../lib/api";

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

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [signupRole, setSignupRole] = useState<"customer" | "driver">("customer");
  const [showPassword, setShowPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [signupFullName, setSignupFullName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPhone, setSignupPhone] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirmPassword, setSignupConfirmPassword] = useState("");
  const [signupVerificationSent, setSignupVerificationSent] = useState(false);
  const [signupPreviewUrl, setSignupPreviewUrl] = useState("");

  const [resetEmail, setResetEmail] = useState("");

  useEffect(() => {
    const verified = searchParams.get("verified");
    const verifiedEmail = searchParams.get("email");

    if (verified === "1") {
      setMode("login");
      setSuccess("Your email has been verified. You can now sign in.");
      setError("");
      if (verifiedEmail) {
        setLoginEmail(verifiedEmail);
      }
    }
  }, [searchParams]);

  const cardHeading = useMemo(() => {
    if (mode === "signup") {
      return signupRole === "driver"
        ? { eyebrow: "Sign up", title: "Become a driver" }
        : { eyebrow: "Sign up", title: "Create account" };
    }

    if (mode === "reset") {
      return { eyebrow: "Reset password", title: "Password support" };
    }

    return { eyebrow: "Login", title: "Sign in" };
  }, [mode, signupRole]);

  async function onLoginSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const result = await webLogin(loginEmail, loginPassword);

      clearStoredToken();
      clearStoredDriverToken();

      if (result.user.role === "admin") {
        setStoredToken(result.accessToken);
        router.push("/dashboard");
        return;
      }

      if (result.user.role === "driver") {
        setStoredDriverToken(result.accessToken);
        router.push("/driver/login");
        return;
      }

      if (result.user.role === "customer") {
        setSuccess("Customer account recognized. Continue in the ChaufX mobile app for bookings and trip updates.");
        return;
      }

      throw new Error("This account does not have web access.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign in");
    } finally {
      setLoading(false);
    }
  }

  async function onSignupSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      if (signupRole === "driver") {
        router.push("/driver/apply");
        return;
      }

      if (signupPassword !== signupConfirmPassword) {
        throw new Error("Passwords do not match.");
      }

      const result = await requestCustomerVerificationEmail({
        fullName: signupFullName,
        email: signupEmail,
        phone: signupPhone || undefined,
        password: signupPassword
      });

      clearStoredToken();
      clearStoredDriverToken();
      setSignupVerificationSent(true);
      setSignupPreviewUrl(result.previewUrl ?? "");
      setSuccess(result.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create account");
    } finally {
      setLoading(false);
    }
  }

  async function onResetSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const result = await requestPasswordReset(resetEmail);
      setSuccess(result.message ?? "If the email exists, a reset notification has been queued.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to request password reset");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#eef3fb_0%,#f8fafc_45%,#eef2ff_100%)] px-5 py-10">
      <div className="mx-auto max-w-xl">
        <section className="rounded-[36px] border border-[#E5E7EB] bg-white p-8 shadow-[0_30px_90px_-55px_rgba(15,23,42,0.24)] md:p-10">
          <AdminBrand href="/" compact variant="login" />
          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#4338CA]">{cardHeading.eyebrow}</div>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-[#0F172A]">{cardHeading.title}</h1>

          {mode === "signup" ? (
            <div className="mt-6 inline-flex rounded-full border border-[#E5E7EB] bg-[#F8FAFC] p-1">
                {[
                  ["customer", "Customer"],
                  ["driver", "Driver"]
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setSignupRole(value as typeof signupRole);
                      setError("");
                      setSuccess("");
                      setSignupVerificationSent(false);
                      setSignupPreviewUrl("");
                    }}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      signupRole === value ? "bg-[#0F172A] text-white" : "text-slate-600 hover:text-[#0F172A]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
            </div>
          ) : null}

          {mode === "login" ? (
            <form className="mt-8 space-y-4" onSubmit={onLoginSubmit}>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Email</span>
                  <input
                    type="email"
                    className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]"
                    value={loginEmail}
                    onChange={(event) => setLoginEmail(event.target.value)}
                    required
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Password</span>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 pr-12 outline-none transition focus:border-[#2563EB]"
                      value={loginPassword}
                      onChange={(event) => setLoginPassword(event.target.value)}
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

                <div className="flex items-center justify-between text-sm">
                  <button type="button" className="font-medium text-[#4338CA]" onClick={() => setMode("reset")}>
                    Forgot password?
                  </button>
                  <button type="button" className="font-medium text-slate-600" onClick={() => setMode("signup")}>
                    Need an account?
                  </button>
                </div>

                {error ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
                {success ? <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</p> : null}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-2xl bg-[#2563EB] px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_32px_-18px_rgba(37,99,235,0.55)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Signing in..." : "Continue"}
                </button>
            </form>
          ) : null}

          {mode === "signup" ? (
            signupRole === "driver" ? (
              <div className="mt-8 space-y-4">
                  <div className="rounded-[28px] border border-[#E5E7EB] bg-[#F8FAFC] p-6">
                    <div className="text-sm font-semibold text-slate-950">Driver onboarding</div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      Drivers complete the onboarding form first. Once approved, access is provided through the ChaufX Driver App.
                    </p>
                  </div>

                  {error ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
                  {success ? <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</p> : null}

                  <button
                    type="button"
                    onClick={() => router.push("/driver/apply")}
                    className="block w-full rounded-2xl bg-[#2563EB] px-5 py-3 text-center text-sm font-semibold text-white shadow-[0_16px_32px_-18px_rgba(37,99,235,0.55)]"
                  >
                    Continue to driver onboarding
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("login")}
                    className="w-full rounded-2xl border border-[#E5E7EB] px-5 py-3 text-sm font-semibold text-slate-700"
                  >
                    Back to login
                  </button>
              </div>
            ) : (
              <form className="mt-8 space-y-4" onSubmit={onSignupSubmit}>
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">Full name</span>
                    <input
                      className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]"
                      value={signupFullName}
                      onChange={(event) => setSignupFullName(event.target.value)}
                      required
                    />
                  </label>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">Email</span>
                      <input
                        type="email"
                        className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]"
                        value={signupEmail}
                        onChange={(event) => setSignupEmail(event.target.value)}
                        required
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">Phone number</span>
                      <input
                        className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]"
                        value={signupPhone}
                        onChange={(event) => setSignupPhone(event.target.value)}
                      />
                    </label>
                  </div>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">Password</span>
                    <div className="relative">
                      <input
                        type={showSignupPassword ? "text" : "password"}
                        className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 pr-12 outline-none transition focus:border-[#2563EB]"
                        value={signupPassword}
                        onChange={(event) => setSignupPassword(event.target.value)}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowSignupPassword((current) => !current)}
                        className="absolute inset-y-0 right-0 flex items-center px-4 text-slate-500 transition hover:text-[#0F172A]"
                        aria-label={showSignupPassword ? "Hide password" : "Show password"}
                      >
                        <EyeIcon open={showSignupPassword} />
                      </button>
                    </div>
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">Confirm password</span>
                    <input
                      type={showSignupPassword ? "text" : "password"}
                      className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]"
                      value={signupConfirmPassword}
                      onChange={(event) => setSignupConfirmPassword(event.target.value)}
                      required
                    />
                  </label>

                  {error ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
                  {success ? <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</p> : null}
                  {signupPreviewUrl ? (
                    <p className="rounded-2xl border border-dashed border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3 text-sm text-[#1D4ED8]">
                      Email delivery is not configured yet in this environment.{" "}
                      <a href={signupPreviewUrl} className="font-semibold underline">
                        Open verification preview
                      </a>
                      .
                    </p>
                  ) : null}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-2xl bg-[#2563EB] px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_32px_-18px_rgba(37,99,235,0.55)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loading ? "Sending..." : signupVerificationSent ? "Resend verification email" : "Create account"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("login")}
                    className="w-full rounded-2xl border border-[#E5E7EB] px-5 py-3 text-sm font-semibold text-slate-700"
                  >
                    Back to login
                  </button>
              </form>
            )
          ) : null}

          {mode === "reset" ? (
            <form className="mt-8 space-y-4" onSubmit={onResetSubmit}>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Email</span>
                  <input
                    type="email"
                    className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]"
                    value={resetEmail}
                    onChange={(event) => setResetEmail(event.target.value)}
                    required
                  />
                </label>

                {error ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
                {success ? <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</p> : null}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-2xl bg-[#2563EB] px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_32px_-18px_rgba(37,99,235,0.55)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Sending request..." : "Send reset request"}
                </button>
                <button
                  type="button"
                  onClick={() => setMode("login")}
                  className="w-full rounded-2xl border border-[#E5E7EB] px-5 py-3 text-sm font-semibold text-slate-700"
                >
                  Back to login
                </button>
            </form>
          ) : null}
        </section>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[linear-gradient(180deg,#eef3fb_0%,#f8fafc_45%,#eef2ff_100%)] px-5 py-10">
          <div className="mx-auto max-w-xl">
            <section className="rounded-[36px] border border-[#E5E7EB] bg-white p-8 shadow-[0_30px_90px_-55px_rgba(15,23,42,0.24)] md:p-10">
              <AdminBrand href="/" compact variant="login" />
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#4338CA]">Login</div>
              <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-[#0F172A]">Preparing sign in</h1>
              <p className="mt-4 text-sm leading-7 text-slate-600">Please wait while we load your access options.</p>
            </section>
          </div>
        </main>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
