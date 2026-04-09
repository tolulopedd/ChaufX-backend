const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000/api";

async function request<T>(path: string, options?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {})
    }
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "Request failed");
  }

  return payload as T;
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
