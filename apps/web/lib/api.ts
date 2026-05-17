"use client";

import { useEffect, useMemo, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://chaufx-backend.onrender.com/api";
const TOKEN_KEY = "chaufx_admin_token";
const DRIVER_TOKEN_KEY = "chaufx_driver_web_token";

export function getStoredToken() {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setStoredToken(token: string) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(TOKEN_KEY, token);
  }
}

export function clearStoredToken() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(TOKEN_KEY);
  }
}

export function getStoredDriverToken() {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(DRIVER_TOKEN_KEY) ?? "";
}

export function setStoredDriverToken(token: string) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(DRIVER_TOKEN_KEY, token);
  }
}

export function clearStoredDriverToken() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(DRIVER_TOKEN_KEY);
  }
}

function handleAdminAuthFailure() {
  clearStoredToken();

  if (typeof window !== "undefined") {
    window.location.href = "/login";
  }
}

export async function adminLogin(email: string, password: string) {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "Login failed");
  }

  setStoredToken(payload.accessToken);
  return payload;
}

export async function webLogin(email: string, password: string) {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "Login failed");
  }

  return payload;
}

export async function registerCustomerWeb(payload: {
  fullName: string;
  email: string;
  phone?: string;
  password: string;
}) {
  const response = await fetch(`${API_BASE}/auth/register/customer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message ?? "Unable to create account");
  }

  return data;
}

export async function requestCustomerVerificationEmail(payload: {
  fullName: string;
  email: string;
  phone?: string;
  password: string;
}) {
  const response = await fetch(`${API_BASE}/auth/verify-email/request/customer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message ?? "Unable to send verification email");
  }

  return data as { message: string; previewUrl?: string };
}

export async function requestDriverOnboardingVerificationEmail(payload: {
  firstName: string;
  lastName: string;
  email: string;
}) {
  const response = await fetch(`${API_BASE}/auth/verify-email/request/driver-onboarding`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message ?? "Unable to send verification email");
  }

  return data as { message: string; previewUrl?: string };
}

export async function confirmWebsiteEmailVerification(token: string) {
  const response = await fetch(`${API_BASE}/auth/verify-email/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ token })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message ?? "Unable to verify email");
  }

  return data as {
    purpose: "CUSTOMER_SIGNUP" | "DRIVER_ONBOARDING";
    email: string;
    payload?: Record<string, string | null>;
  };
}

export async function requestPasswordReset(email: string) {
  const response = await fetch(`${API_BASE}/auth/forgot-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message ?? "Unable to request password reset");
  }

  return data as { message: string; previewUrl?: string };
}

export async function validatePasswordResetToken(token: string) {
  const response = await fetch(`${API_BASE}/auth/reset-password/validate?token=${encodeURIComponent(token)}`, {
    cache: "no-store"
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message ?? "Unable to validate password reset link");
  }

  return data as { email: string; fullName: string };
}

export async function confirmPasswordReset(payload: {
  token: string;
  password: string;
  confirmPassword: string;
}) {
  const response = await fetch(`${API_BASE}/auth/reset-password/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message ?? "Unable to update password");
  }

  return data as { message: string; email: string };
}

export async function driverApply(payload: unknown) {
  const response = await fetch(`${API_BASE}/driver-onboarding/apply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message ?? "Unable to submit application");
  }

  return data;
}

export async function fetchApplicationStatus(email: string) {
  const response = await fetch(`${API_BASE}/driver-onboarding/status?email=${encodeURIComponent(email)}`, {
    cache: "no-store"
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message ?? "Unable to fetch status");
  }

  return data;
}

export async function driverLogin(email: string, password: string) {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message ?? "Unable to sign in");
  }

  return data;
}

export async function fetchDriverProfile(token: string) {
  const response = await fetch(`${API_BASE}/drivers/me`, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    cache: "no-store"
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message ?? "Unable to fetch driver profile");
  }

  return data;
}

export async function submitContactMessage(payload: {
  fullName: string;
  email: string;
  province?: string;
  subject?: string;
  message: string;
}) {
  const response = await fetch(`${API_BASE}/contact-messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ...payload,
      source: "website"
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message ?? "Unable to send message");
  }

  return data;
}

export async function adminFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: token ? `Bearer ${token}` : "",
      ...(options?.headers ?? {})
    }
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      handleAdminAuthFailure();
      throw new Error("Session expired. Redirecting to login...");
    }

    throw new Error(payload?.error?.message ?? "Request failed");
  }

  return payload as T;
}

export async function fetchAdminDocumentLink(documentId: string) {
  const token = getStoredToken();
  const response = await fetch(`${API_BASE}/admin/documents/${documentId}/link`, {
    headers: {
      Authorization: token ? `Bearer ${token}` : ""
    }
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      handleAdminAuthFailure();
      throw new Error("Session expired. Redirecting to login...");
    }

    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "Unable to open document");
  }

  return (await response.json()) as {
    url: string;
    fileName: string;
    mimeType?: string | null;
  };
}

export function useAdminResource<T>(path: string, fallback: T) {
  const [data, setData] = useState<T>(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    adminFetch<T>(path)
      .then((result) => {
        if (!mounted) {
          return;
        }
        setData(result);
        setError("");
      })
      .catch((reason: Error) => {
        if (!mounted) {
          return;
        }
        setError(reason.message);
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [path]);

  return useMemo(
    () => ({
      data,
      loading,
      error,
      reload: async () => {
        setLoading(true);
        const result = await adminFetch<T>(path);
        setData(result);
        setLoading(false);
      }
    }),
    [data, error, loading, path]
  );
}

export const dashboardFallback = {
  metrics: {
    totalUsers: 0,
    totalDrivers: 0,
    pendingApplications: 0,
    activeBookings: 0,
    revenue: 0
  },
  activeTrips: []
};

export const contactMessagesFallback: Array<{
  id: string;
  fullName: string;
  email: string;
  province?: string | null;
  subject?: string | null;
  message: string;
  source: string;
  status: "NEW" | "RESOLVED";
  resolvedAt?: string | null;
  resolvedByUserId?: string | null;
  createdAt: string;
  updatedAt: string;
}> = [];
