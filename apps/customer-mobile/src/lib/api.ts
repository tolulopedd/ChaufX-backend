import { Platform } from "react-native";
import Constants from "expo-constants";

let resolvedApiBase: string | null = null;

function normalizeApiBase(value: string) {
  return value.replace(/\/+$/, "");
}

function getDevHostBase() {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as any).manifest2?.extra?.expoClient?.hostUri ??
    (Constants as any).manifest?.debuggerHost;

  if (!hostUri || typeof hostUri !== "string") {
    return null;
  }

  const host = hostUri.split(":")[0];
  if (!host) {
    return null;
  }

  return `http://${host}:4000/api`;
}

function getCandidateApiBases() {
  const candidates = new Set<string>();
  const envBase = process.env.EXPO_PUBLIC_API_URL;

  if (envBase) {
    candidates.add(normalizeApiBase(envBase));
  }

  const devHostBase = getDevHostBase();
  if (devHostBase) {
    candidates.add(normalizeApiBase(devHostBase));
  }

  if (Platform.OS === "android") {
    candidates.add("http://10.0.2.2:4000/api");
    candidates.add("http://10.0.3.2:4000/api");
  } else {
    candidates.add("http://127.0.0.1:4000/api");
    candidates.add("http://localhost:4000/api");
  }

  return Array.from(candidates);
}

async function requestAtBase<T>(base: string, path: string, options?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${base}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers ?? {})
      }
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error?.message ?? "Request failed");
    }

    resolvedApiBase = base;
    return payload as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function request<T>(path: string, options?: RequestInit) {
  const candidates = resolvedApiBase ? [resolvedApiBase, ...getCandidateApiBases()] : getCandidateApiBases();
  const uniqueCandidates = Array.from(new Set(candidates));
  let lastError: unknown = null;

  for (const base of uniqueCandidates) {
    try {
      return await requestAtBase<T>(base, path, options);
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error("Unable to reach the ChaufX API.");
}

export type Session = {
  accessToken: string;
  user: {
    id: string;
    role: string;
    fullName: string;
    email: string;
    phone?: string | null;
  };
};

export function login(email: string, password: string) {
  return request<Session>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export function fetchBookings(token: string) {
  return request<any[]>("/bookings", {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

export function fetchNotifications(token: string) {
  return request<any[]>("/notifications", {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

export function fetchProfile(token: string) {
  return request<any>("/users/me", {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

export function createBooking(token: string, payload: Record<string, unknown>) {
  return request<any>("/bookings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
}

export function fetchBookingEstimate(token: string, payload: Record<string, unknown>) {
  return request<any>("/bookings/estimate", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
}

export function cancelBooking(token: string, bookingId: string) {
  return request<any>(`/bookings/${bookingId}/cancel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

export function fetchMapState(token: string, bookingId: string) {
  return request<any>(`/trips/${bookingId}/map-state`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

export function submitRating(token: string, bookingId: string, score: number, comment: string) {
  return request<any>(`/bookings/${bookingId}/rating`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ score, comment })
  });
}
