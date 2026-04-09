const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000/api";

async function request<T>(path: string, token: string, options?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
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

  return payload as T;
}

export function login(email: string, password: string) {
  return fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  }).then(async (response) => {
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error?.message ?? "Login failed");
    }
    return payload;
  });
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
