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

async function requestAtBase<T>(base: string, path: string, token: string, options?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${base}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
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

async function request<T>(path: string, token: string, options?: RequestInit) {
  const candidates = resolvedApiBase ? [resolvedApiBase, ...getCandidateApiBases()] : getCandidateApiBases();
  const uniqueCandidates = Array.from(new Set(candidates));
  let lastError: unknown = null;

  for (const base of uniqueCandidates) {
    try {
      return await requestAtBase<T>(base, path, token, options);
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error("Unable to reach the ChaufX API.");
}

export function login(email: string, password: string) {
  const candidates = resolvedApiBase ? [resolvedApiBase, ...getCandidateApiBases()] : getCandidateApiBases();
  const uniqueCandidates = Array.from(new Set(candidates));

  return (async () => {
    let lastError: unknown = null;

    for (const base of uniqueCandidates) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      try {
        const response = await fetch(`${base}/auth/login`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ email, password })
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error?.message ?? "Login failed");
        }
        resolvedApiBase = base;
        return payload;
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }

    throw new Error("Unable to reach the ChaufX API.");
  })();
}

export function fetchDriverProfile(token: string) {
  return request<any>("/drivers/me", token);
}

export function fetchBookings(token: string) {
  return request<any[]>("/bookings", token);
}

export function setAvailability(token: string, availabilityStatus: boolean) {
  return request<any>("/drivers/me/availability", token, {
    method: "PATCH",
    body: JSON.stringify({ availabilityStatus })
  });
}

export function updateDriverLocation(token: string, latitude: number, longitude: number, zoneCode?: string) {
  return request<any>("/drivers/me/location", token, {
    method: "PATCH",
    body: JSON.stringify({
      latitude,
      longitude,
      zoneCode
    })
  });
}

export function acceptBooking(token: string, bookingId: string) {
  return request<any>(`/bookings/${bookingId}/accept`, token, {
    method: "POST"
  });
}

export function rejectBooking(token: string, bookingId: string) {
  return request<any>(`/bookings/${bookingId}/reject`, token, {
    method: "POST"
  });
}

export function startTrip(token: string, bookingId: string) {
  return request<any>(`/trips/${bookingId}/start`, token, {
    method: "POST"
  });
}

export function endTrip(token: string, bookingId: string) {
  return request<any>(`/trips/${bookingId}/end`, token, {
    method: "POST"
  });
}

export function fetchMapState(token: string, bookingId: string) {
  return request<any>(`/trips/${bookingId}/map-state`, token);
}

export function shareLocation(
  token: string,
  bookingId: string,
  latitude: number,
  longitude: number,
  heading?: number | null,
  speedKph?: number | null
) {
  return request<any>("/locations", token, {
    method: "POST",
    body: JSON.stringify({
      bookingId,
      latitude,
      longitude,
      heading: typeof heading === "number" ? heading : undefined,
      speedKph: typeof speedKph === "number" ? speedKph : undefined
    })
  });
}
