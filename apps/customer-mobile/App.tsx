import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { StatusBar } from "expo-status-bar";
import DateTimePicker from "@react-native-community/datetimepicker";
import Mapbox from "@rnmapbox/maps";
import * as Location from "expo-location";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { formatDateTime } from "@chaufx/ui";
import {
  cancelBooking,
  createBooking,
  fetchBookingEstimate,
  fetchBookings,
  fetchMapState,
  fetchProfile,
  login,
  type Session
} from "./src/lib/api";

type Tab = "book" | "trips" | "account";
type ScheduleMode = "now" | "later";
type BookingRequestType = "NOW" | "LATER";
type Coordinate = { latitude: number; longitude: number };
type SearchField = "pickup" | "destination";
type PlaceSuggestion = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
};

const mapboxToken = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "";
const logo = require("./assets/dm-logo-light.png");

function getDefaultScheduledTime() {
  const date = new Date(Date.now() + 90 * 60 * 1000);
  return {
    date: date.toISOString().slice(0, 10),
    time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
  };
}

function toIso(date: string, time: string) {
  const parsed = new Date(`${date}T${time}:00`);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function formatDateLabel(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? "Select date"
    : parsed.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
}

function formatTimeLabel(value: string) {
  const parsed = new Date(`2026-01-01T${value}:00`);
  return Number.isNaN(parsed.getTime())
    ? "Select time"
    : parsed.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
}

function clampDurationHours(value: number) {
  return Math.max(2, Math.min(24, Math.floor(value)));
}

async function searchPlaces(query: string, currentLocation: Coordinate | null) {
  if (!mapboxToken || query.trim().length < 3) {
    return [] as PlaceSuggestion[];
  }

  const params = new URLSearchParams({
    access_token: mapboxToken,
    autocomplete: "true",
    limit: "5",
    language: "en",
    country: "ca"
  });

  if (currentLocation) {
    params.set("proximity", `${currentLocation.longitude},${currentLocation.latitude}`);
  }

  const response = await fetch(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query.trim())}.json?${params.toString()}`
  );
  const payload = await response.json();
  const features = Array.isArray(payload?.features) ? payload.features : [];

  return features
    .filter((feature: any) => Array.isArray(feature.center) && feature.center.length >= 2)
    .map((feature: any) => ({
      id: String(feature.id),
      label: String(feature.place_name ?? feature.text ?? query),
      longitude: Number(feature.center[0]),
      latitude: Number(feature.center[1])
    }));
}

async function fetchRouteGeometry(start: Coordinate, end: Coordinate) {
  if (!mapboxToken) {
    return null;
  }

  const params = new URLSearchParams({
    access_token: mapboxToken,
    geometries: "geojson",
    overview: "full"
  });

  const response = await fetch(
    `https://api.mapbox.com/directions/v5/mapbox/driving/${start.longitude},${start.latitude};${end.longitude},${end.latitude}?${params.toString()}`
  );
  const payload = await response.json();
  const route = payload?.routes?.[0];

  if (!route?.geometry?.coordinates?.length) {
    return null;
  }

  return {
    type: "Feature" as const,
    geometry: {
      type: "LineString" as const,
      coordinates: route.geometry.coordinates as number[][]
    },
    properties: {}
  };
}

function toneColor(status?: string) {
  const normalized = String(status ?? "").toLowerCase();
  if (["active", "completed"].includes(normalized)) return "#16A34A";
  if (["accepted", "enroute"].includes(normalized)) return "#2563EB";
  if (normalized === "pending") return "#D97706";
  if (normalized === "cancelled") return "#DC2626";
  return "#2563EB";
}

function Marker({ color, variant }: { color: string; variant: "current" | "pickup" | "destination" }) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (variant !== "pickup") {
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.55,
          duration: 700,
          useNativeDriver: true
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true
        })
      ])
    );

    animation.start();
    return () => {
      animation.stop();
      pulse.setValue(1);
    };
  }, [pulse, variant]);

  if (variant === "destination") {
    return <View style={[styles.markerDiamond, { backgroundColor: color }]} />;
  }

  if (variant === "pickup") {
    return (
      <Animated.View
        style={[
          styles.markerPulse,
          { backgroundColor: color, opacity: pulse, transform: [{ scale: pulse }] }
        ]}
      />
    );
  }

  return <View style={[styles.markerCurrent, { backgroundColor: color }]} />;
}

function buildCameraProps(points: Coordinate[], fallback: Coordinate) {
  if (points.length >= 2) {
    const latitudes = points.map((point) => point.latitude);
    const longitudes = points.map((point) => point.longitude);

    return {
      bounds: {
        ne: [Math.max(...longitudes), Math.max(...latitudes)],
        sw: [Math.min(...longitudes), Math.min(...latitudes)],
        paddingTop: 88,
        paddingRight: 48,
        paddingBottom: 88,
        paddingLeft: 48
      },
      animationMode: "easeTo" as const,
      animationDuration: 600
    };
  }

  return {
    zoomLevel: 12.8,
    centerCoordinate: [fallback.longitude, fallback.latitude] as [number, number],
    animationMode: "easeTo" as const,
    animationDuration: 600
  };
}

function MapSurface({
  currentLocation,
  pickup,
  destination
}: {
  currentLocation: Coordinate | null;
  pickup: Coordinate | null;
  destination: Coordinate | null;
}) {
  const center = pickup ?? currentLocation ?? { latitude: 49.8951, longitude: -97.1384 };
  const cameraProps = buildCameraProps(
    [currentLocation, pickup, destination].filter(Boolean) as Coordinate[],
    center
  );
  const [routeShape, setRouteShape] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;

    if (!pickup || !destination) {
      setRouteShape(null);
      return;
    }

    fetchRouteGeometry(pickup, destination)
      .then((shape) => {
        if (!cancelled) {
          setRouteShape(shape);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRouteShape(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pickup, destination]);

  if (!mapboxToken) {
    return (
      <View style={styles.mapFallback}>
        <Text style={styles.mapFallbackTitle}>Mapbox token needed</Text>
        <Text style={styles.mapFallbackText}>
          Add `EXPO_PUBLIC_MAPBOX_TOKEN` and run a custom Expo dev build to enable the live map.
        </Text>
      </View>
    );
  }

  return (
    <Mapbox.MapView
      style={styles.map}
      styleURL="mapbox://styles/mapbox/navigation-night-v1"
      compassEnabled={false}
      logoEnabled={false}
      attributionEnabled={false}
      scrollEnabled={false}
      zoomEnabled={false}
      rotateEnabled={false}
      pitchEnabled={false}
    >
      <Mapbox.Camera {...cameraProps} />
      {currentLocation ? (
        <Mapbox.PointAnnotation id="current-location" coordinate={[currentLocation.longitude, currentLocation.latitude]}>
          <Marker color="#22C55E" variant="current" />
        </Mapbox.PointAnnotation>
      ) : null}
      {pickup ? (
        <Mapbox.PointAnnotation id="pickup" coordinate={[pickup.longitude, pickup.latitude]}>
          <Marker color="#F97316" variant="pickup" />
        </Mapbox.PointAnnotation>
      ) : null}
      {destination ? (
        <Mapbox.PointAnnotation id="destination" coordinate={[destination.longitude, destination.latitude]}>
          <Marker color="#2563EB" variant="destination" />
        </Mapbox.PointAnnotation>
      ) : null}
      {routeShape ? (
        <Mapbox.ShapeSource id="route" shape={routeShape}>
          <Mapbox.LineLayer
            id="route-line"
            style={{ lineColor: "#60A5FA", lineWidth: 5, lineOpacity: 0.92, lineCap: "round", lineJoin: "round" }}
          />
        </Mapbox.ShapeSource>
      ) : null}
    </Mapbox.MapView>
  );
}

export default function App() {
  const insets = useSafeAreaInsets();
  const defaults = getDefaultScheduledTime();
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<Tab>("book");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState("");
  const [loginEmail, setLoginEmail] = useState("owner@chaufx.app");
  const [loginPassword, setLoginPassword] = useState("OwnerPass123$");
  const [profile, setProfile] = useState<any>(null);
  const [bookings, setBookings] = useState<any[]>([]);
  const [mapState, setMapState] = useState<any>(null);
  const [estimate, setEstimate] = useState<any>(null);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("now");
  const [locationPending, setLocationPending] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<Coordinate | null>(null);
  const [activeSearchField, setActiveSearchField] = useState<SearchField | null>(null);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [form, setForm] = useState({
    pickupLocation: "201 Portage Ave, Winnipeg",
    pickupLat: "49.8959",
    pickupLng: "-97.1385",
    destinationLocation: "The Forks, Winnipeg",
    destinationLat: "49.8870",
    destinationLng: "-97.1318",
    scheduledDate: defaults.date,
    scheduledTime: defaults.time,
    durationHours: 2,
    specialNotes: "",
    vehicleDetails: "Toyota Camry - midnight blue",
    zoneCode: "WPG-CENTRAL"
  });

  useEffect(() => {
    if (mapboxToken) {
      Mapbox.setAccessToken(mapboxToken);
    }
  }, []);

  useEffect(() => {
    if (!session?.accessToken) {
      return;
    }

    refreshDashboard();
  }, [session]);

  useEffect(() => {
    if (!session?.accessToken) {
      return;
    }

    primeCurrentLocation();
  }, [session]);

  useEffect(() => {
    if (!session?.accessToken) {
      return;
    }

    const scheduledStartAt =
      scheduleMode === "now" ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : toIso(form.scheduledDate, form.scheduledTime);

    fetchBookingEstimate(session.accessToken, {
      scheduledStartAt,
      expectedDurationMinutes: clampDurationHours(Number(form.durationHours) || 0) * 60,
      zoneCode: form.zoneCode
    })
      .then(setEstimate)
      .catch(() => setEstimate(null));
  }, [form.durationHours, form.scheduledDate, form.scheduledTime, form.zoneCode, scheduleMode, session]);

  useEffect(() => {
    if (!activeSearchField) {
      setSuggestions([]);
      return;
    }

    const query = activeSearchField === "pickup" ? form.pickupLocation : form.destinationLocation;
    if (query.trim().length < 3) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    setSearching(true);

    const timeout = setTimeout(() => {
      searchPlaces(query, currentLocation)
        .then((results) => {
          if (!cancelled) {
            setSuggestions(results);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSuggestions([]);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setSearching(false);
          }
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [activeSearchField, currentLocation, form.destinationLocation, form.pickupLocation]);

  const pickupCoordinate = useMemo<Coordinate | null>(() => {
    const latitude = Number(form.pickupLat);
    const longitude = Number(form.pickupLng);
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
  }, [form.pickupLat, form.pickupLng]);

  const destinationCoordinate = useMemo<Coordinate | null>(() => {
    const latitude = Number(form.destinationLat);
    const longitude = Number(form.destinationLng);
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
  }, [form.destinationLat, form.destinationLng]);

  const activeBooking = bookings.find((booking) =>
    ["pending", "accepted", "enroute", "active"].includes(String(booking.status).toLowerCase())
  );

  async function refreshDashboard() {
    if (!session?.accessToken) {
      return;
    }

    setRefreshing(true);
    try {
      const [bookingList, me] = await Promise.all([
        fetchBookings(session.accessToken),
        fetchProfile(session.accessToken)
      ]);

      setBookings(bookingList);
      setProfile(me);

      const trackableBooking = bookingList.find((booking) =>
        ["accepted", "enroute", "active"].includes(String(booking.status).toLowerCase())
      );
      if (trackableBooking) {
        setMapState(await fetchMapState(session.accessToken, trackableBooking.id));
      } else {
        setMapState(null);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to refresh your account.");
    } finally {
      setRefreshing(false);
    }
  }

  async function primeCurrentLocation() {
    try {
      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.status === "undetermined") {
        const requested = await Location.requestForegroundPermissionsAsync();
        if (requested.status !== "granted") {
          return;
        }
      } else if (permission.status !== "granted") {
        return;
      }

      const current =
        (await Location.getLastKnownPositionAsync()) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));

      if (!current) {
        return;
      }

      const coords = {
        latitude: current.coords.latitude,
        longitude: current.coords.longitude
      };
      setCurrentLocation(coords);
    } catch {
      // Keep the map usable even if device location isn't available yet.
    }
  }

  async function handleLogin() {
    setBusy(true);
    try {
      const nextSession = await login(loginEmail.trim(), loginPassword);
      setSession(nextSession);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUseCurrentLocation() {
    setLocationPending(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setStatus("Location access is needed to confirm your pickup point.");
        return;
      }

      const current =
        (await Location.getLastKnownPositionAsync()) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));

      if (!current) {
        setStatus("We could not read your current position yet.");
        return;
      }

      const coords = {
        latitude: current.coords.latitude,
        longitude: current.coords.longitude
      };
      setCurrentLocation(coords);

      const reverse = await Location.reverseGeocodeAsync(coords);
      const label = reverse[0]
        ? [reverse[0].name, reverse[0].city].filter(Boolean).join(", ")
        : `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`;

      setForm((currentForm) => ({
        ...currentForm,
        pickupLocation: label,
        pickupLat: String(coords.latitude),
        pickupLng: String(coords.longitude)
      }));
      setActiveSearchField(null);
      setSuggestions([]);
      setStatus("Pickup updated from your current location.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to get your current location.");
    } finally {
      setLocationPending(false);
    }
  }

  function handleDateChange(_event: unknown, nextDate: Date) {
    setForm((currentForm) => ({
      ...currentForm,
      scheduledDate: nextDate.toISOString().slice(0, 10)
    }));
  }

  function handleTimeChange(_event: unknown, nextTime: Date) {
    setForm((currentForm) => ({
      ...currentForm,
      scheduledTime: `${String(nextTime.getHours()).padStart(2, "0")}:${String(nextTime.getMinutes()).padStart(2, "0")}`
    }));
  }

  async function submitBooking(nextMode: ScheduleMode) {
    if (!session?.accessToken) {
      return;
    }

    setBusy(true);
    try {
      const pickupGeocode = await Location.geocodeAsync(form.pickupLocation.trim());
      const destinationGeocode = await Location.geocodeAsync(form.destinationLocation.trim());

      const pickupPoint =
        pickupGeocode[0] ??
        (currentLocation
          ? {
              latitude: currentLocation.latitude,
              longitude: currentLocation.longitude
            }
          : null);

      const destinationPoint = destinationGeocode[0] ?? null;

      if (!pickupPoint) {
        throw new Error("Please enter a pickup address we can locate or use your current location.");
      }

      if (!destinationPoint) {
        throw new Error("Please enter a destination address we can locate.");
      }

      setForm((currentForm) => ({
        ...currentForm,
        pickupLat: String(pickupPoint.latitude),
        pickupLng: String(pickupPoint.longitude),
        destinationLat: String(destinationPoint.latitude),
        destinationLng: String(destinationPoint.longitude)
      }));

      const scheduledStartAt =
        nextMode === "now"
          ? new Date(Date.now() + 15 * 60 * 1000).toISOString()
          : toIso(form.scheduledDate, form.scheduledTime);

      await createBooking(session.accessToken, {
        requestType: (nextMode === "now" ? "NOW" : "LATER") satisfies BookingRequestType,
        pickupLocation: form.pickupLocation,
        pickupLat: pickupPoint.latitude,
        pickupLng: pickupPoint.longitude,
        destinationLocation: form.destinationLocation,
        destinationLat: destinationPoint.latitude,
        destinationLng: destinationPoint.longitude,
        scheduledStartAt,
        expectedDurationMinutes: clampDurationHours(Number(form.durationHours) || 0) * 60,
        specialNotes: form.specialNotes.trim() || undefined,
        vehicleDetails: form.vehicleDetails.trim() || undefined,
        zoneCode: form.zoneCode
      });

      setStatus(nextMode === "now" ? "ChaufX request submitted." : "Scheduled drive submitted.");
      setTab("trips");
      await refreshDashboard();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to submit your booking.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel(bookingId: string) {
    if (!session?.accessToken) {
      return;
    }

    setBusy(true);
    try {
      await cancelBooking(session.accessToken, bookingId);
      setStatus("Booking cancelled.");
      await refreshDashboard();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to cancel this booking.");
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    setSession(null);
    setProfile(null);
    setBookings([]);
    setMapState(null);
    setEstimate(null);
    setTab("book");
    setStatus("");
  }

  function applySuggestion(field: SearchField, suggestion: PlaceSuggestion) {
    setForm((currentForm) =>
      field === "pickup"
        ? {
            ...currentForm,
            pickupLocation: suggestion.label,
            pickupLat: String(suggestion.latitude),
            pickupLng: String(suggestion.longitude)
          }
        : {
            ...currentForm,
            destinationLocation: suggestion.label,
            destinationLat: String(suggestion.latitude),
            destinationLng: String(suggestion.longitude)
          }
    );
    setActiveSearchField(null);
    setSuggestions([]);
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <View style={[styles.loginWrap, { paddingTop: Math.max(insets.top, 18) + 20 }]}>
          <View style={styles.loginPanel}>
            <Image source={logo} style={styles.loginLogo} resizeMode="contain" />
            <Text style={styles.loginEyebrow}>CHAUFX CANADA</Text>
            <Text style={styles.loginTitle}>Book your driver in a few taps.</Text>
            <Text style={styles.loginCopy}>
              Rquest for driver, and choose whether you need the service now or later.
            </Text>

            <View style={styles.loginCard}>
              <TextInput
                placeholder="owner@chaufx.app"
                placeholderTextColor="#94A3B8"
                autoCapitalize="none"
                style={styles.input}
                value={loginEmail}
                onChangeText={setLoginEmail}
              />
              <TextInput
                placeholder="Password"
                placeholderTextColor="#94A3B8"
                secureTextEntry
                style={styles.input}
                value={loginPassword}
                onChangeText={setLoginPassword}
              />
              <Pressable style={[styles.primaryButton, busy && styles.buttonDisabled]} disabled={busy} onPress={handleLogin}>
                {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>Sign in</Text>}
              </Pressable>
            </View>

            {status ? <Text style={styles.statusText}>{status}</Text> : null}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.keyboardWrap}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, styles.contentGrow, { paddingTop: Math.max(insets.top, 10) + 12, paddingBottom: 52 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          contentInsetAdjustmentBehavior="automatic"
          nestedScrollEnabled
        >
          <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerLabel}>Customer app</Text>
            <Text style={styles.headerTitle}>Hello {profile?.fullName?.split(" ")[0] ?? "there"}</Text>
          </View>
          <Pressable style={styles.ghostButton} onPress={refreshDashboard}>
            <Text style={styles.ghostButtonText}>{refreshing ? "Refreshing..." : "Refresh"}</Text>
          </Pressable>
        </View>

        <View style={styles.mapCard} pointerEvents="box-none">
          <View style={styles.mapFrame} pointerEvents="none">
            <MapSurface currentLocation={currentLocation} pickup={pickupCoordinate} destination={destinationCoordinate} />
          </View>
          <View style={styles.mapLegend}>
            <View style={styles.mapLegendPill}>
              <View style={[styles.legendPulse, { backgroundColor: "#F97316" }]} />
              <Text style={styles.mapLegendText}>Pickup</Text>
            </View>
            <View style={styles.mapLegendPill}>
              <View style={[styles.legendDiamond, { backgroundColor: "#2563EB" }]} />
              <Text style={styles.mapLegendText}>Dropoff</Text>
            </View>
          </View>
        </View>

        <View style={styles.tabRow}>
          {[
            ["book", "Book"],
            ["trips", "Trips"],
            ["account", "Account"]
          ].map(([key, label]) => (
            <Pressable key={key} style={[styles.tabButton, tab === key && styles.tabButtonActive]} onPress={() => setTab(key as Tab)}>
              <Text style={[styles.tabButtonText, tab === key && styles.tabButtonTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {tab === "book" ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Confirm pickup</Text>
            <Text style={styles.helperText}>Type any address below or use your current location.</Text>
            <View style={styles.fieldStack}>
              <TextInput
                style={styles.input}
                value={form.pickupLocation}
                onChangeText={(value) => {
                  setForm((currentForm) => ({ ...currentForm, pickupLocation: value }));
                  setActiveSearchField("pickup");
                }}
                onFocus={() => setActiveSearchField("pickup")}
                placeholder="Pickup address"
                placeholderTextColor="#94A3B8"
              />
              {activeSearchField === "pickup" ? (
                <View style={styles.suggestionPanel}>
                  {searching ? <Text style={styles.suggestionHint}>Searching addresses...</Text> : null}
                  {!searching && suggestions.length === 0 ? (
                    <Text style={styles.suggestionHint}>Keep typing to see address suggestions.</Text>
                  ) : null}
                  {suggestions.map((suggestion) => (
                    <Pressable
                      key={suggestion.id}
                      style={styles.suggestionRow}
                      onPress={() => applySuggestion("pickup", suggestion)}
                    >
                    <Text style={styles.suggestionText}>{suggestion.label}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <Pressable style={styles.secondaryButton} onPress={handleUseCurrentLocation}>
                <Text style={styles.secondaryButtonText}>{locationPending ? "Finding..." : "Use current location"}</Text>
              </Pressable>
              <TextInput
                style={styles.input}
                value={form.destinationLocation}
                onChangeText={(value) => {
                  setForm((currentForm) => ({ ...currentForm, destinationLocation: value }));
                  setActiveSearchField("destination");
                }}
                onFocus={() => setActiveSearchField("destination")}
                placeholder="Destination address"
                placeholderTextColor="#94A3B8"
              />
              {activeSearchField === "destination" ? (
                <View style={styles.suggestionPanel}>
                  {searching ? <Text style={styles.suggestionHint}>Searching addresses...</Text> : null}
                  {!searching && suggestions.length === 0 ? (
                    <Text style={styles.suggestionHint}>Keep typing to see address suggestions.</Text>
                  ) : null}
                  {suggestions.map((suggestion) => (
                    <Pressable
                      key={suggestion.id}
                      style={styles.suggestionRow}
                      onPress={() => applySuggestion("destination", suggestion)}
                    >
                      <Text style={styles.suggestionText}>{suggestion.label}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <TextInput
                style={styles.input}
                value={form.vehicleDetails}
                onChangeText={(value) => setForm((currentForm) => ({ ...currentForm, vehicleDetails: value }))}
                placeholder="Your vehicle"
                placeholderTextColor="#94A3B8"
              />
              <TextInput
                style={styles.input}
                value={form.specialNotes}
                onChangeText={(value) => setForm((currentForm) => ({ ...currentForm, specialNotes: value }))}
                placeholder="Special notes (optional)"
                placeholderTextColor="#94A3B8"
              />
            </View>

            <Text style={styles.panelTitle}>Request ride</Text>
            <View style={styles.modeRow}>
              {[
                ["now", "ChaufX now"],
                ["later", "Schedule later"]
              ].map(([key, label]) => (
                <Pressable
                  key={key}
                  style={[styles.modeButton, scheduleMode === key && styles.modeButtonActive]}
                  onPress={() => setScheduleMode(key as ScheduleMode)}
                >
                  <Text style={[styles.modeButtonText, scheduleMode === key && styles.modeButtonTextActive]}>{label}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.bookingDetailsCard}>
              <Text style={styles.detailsBlockTitle}>Booking details</Text>
              {scheduleMode === "later" ? (
                <View style={styles.scheduleCard}>
                  <View style={styles.schedulePickerCard}>
                    <View style={styles.scheduleButton}>
                      <Text style={styles.scheduleLabel}>Date</Text>
                      <Text style={styles.scheduleValue}>{formatDateLabel(form.scheduledDate)}</Text>
                    </View>
                    <View style={styles.inlinePickerWrap}>
                      <DateTimePicker
                        mode="date"
                        display={Platform.OS === "ios" ? "compact" : "default"}
                        value={new Date(`${form.scheduledDate}T12:00:00`)}
                        onValueChange={handleDateChange}
                      />
                    </View>
                  </View>
                  <View style={styles.schedulePickerCard}>
                    <View style={styles.scheduleButton}>
                      <Text style={styles.scheduleLabel}>Time</Text>
                      <Text style={styles.scheduleValue}>{formatTimeLabel(form.scheduledTime)}</Text>
                    </View>
                    <View style={styles.inlinePickerWrap}>
                      <DateTimePicker
                        mode="time"
                        display={Platform.OS === "ios" ? "compact" : "default"}
                        value={new Date(`2026-01-01T${form.scheduledTime}:00`)}
                        onValueChange={handleTimeChange}
                      />
                    </View>
                  </View>
                </View>
              ) : null}

              <View style={styles.hoursRow}>
                <View style={styles.hoursStepper}>
                  <Pressable
                    style={styles.hoursStepperButton}
                    onPress={() =>
                      setForm((currentForm) => ({
                        ...currentForm,
                        durationHours: clampDurationHours(currentForm.durationHours - 1)
                      }))
                    }
                  >
                    <Text style={styles.hoursStepperButtonText}>−</Text>
                  </Pressable>
                  <View style={styles.hoursStepperValueWrap}>
                    <Text style={styles.hoursStepperValue}>{form.durationHours}</Text>
                    <Text style={styles.hoursStepperUnit}>hours</Text>
                  </View>
                  <Pressable
                    style={styles.hoursStepperButton}
                    onPress={() =>
                      setForm((currentForm) => ({
                        ...currentForm,
                        durationHours: clampDurationHours(currentForm.durationHours + 1)
                      }))
                    }
                  >
                    <Text style={styles.hoursStepperButtonText}>+</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.estimateRow}>
                <View>
                  <Text style={styles.estimateLabel}>Estimated fare</Text>
                  <Text style={styles.estimateValue}>
                    {estimate?.fareEstimate ? `$${Number(estimate.fareEstimate).toFixed(2)}` : "Pending"}
                  </Text>
                </View>
                <Text style={styles.estimateMeta}>
                  {estimate?.billableHours
                    ? `${estimate.billableHours} billable hour${estimate.billableHours === 1 ? "" : "s"} at $${estimate.flatFeePerHour}/hour`
                    : scheduleMode === "now"
                      ? "Maps unlock shortly before the trip window."
                      : "Trip tracking opens inside the approved window."}
                </Text>
              </View>
              {scheduleMode === "now" ? (
                <Text style={styles.detailsFooterNote}>Pickup window starts about 15 minutes from now.</Text>
              ) : null}
            </View>

            <Pressable style={[styles.primaryButton, busy && styles.buttonDisabled]} disabled={busy} onPress={() => submitBooking(scheduleMode)}>
              <Text style={styles.primaryButtonText}>{scheduleMode === "now" ? "ChaufX now" : "Schedule a drive"}</Text>
            </Pressable>
          </View>
        ) : null}

        {tab === "trips" ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Trips</Text>
            {activeBooking ? (
              <View style={styles.bookingCard}>
                <View style={styles.bookingHeader}>
                  <View style={styles.bookingTagRow}>
                    <Text style={[styles.bookingStatus, { color: toneColor(activeBooking.status) }]}>{String(activeBooking.status).toUpperCase()}</Text>
                    <Text style={styles.requestTypeChip}>{activeBooking.requestType === "NOW" ? "ChaufX now" : "Schedule later"}</Text>
                  </View>
                  {["pending", "accepted"].includes(String(activeBooking.status).toLowerCase()) ? (
                    <Pressable onPress={() => handleCancel(activeBooking.id)}>
                      <Text style={styles.linkText}>Cancel</Text>
                    </Pressable>
                  ) : null}
                </View>
                <Text style={styles.bookingTitle}>{activeBooking.pickupLocation}</Text>
                <Text style={styles.bookingCopy}>{activeBooking.destinationLocation}</Text>
                <Text style={styles.bookingMeta}>{formatDateTime(activeBooking.scheduledStartAt)}</Text>
                {mapState ? (
                  <View style={styles.infoStrip}>
                    <Text style={styles.infoStripText}>
                      {mapState.active ? "Tracking is active for this trip." : "Tracking is locked until the approved trip window opens."}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <Text style={styles.emptyText}>No active booking yet.</Text>
            )}

            {bookings.filter((booking) => booking.id !== activeBooking?.id).map((booking) => (
              <View key={booking.id} style={styles.bookingCard}>
                <View style={styles.bookingTagRow}>
                  <Text style={[styles.bookingStatus, { color: toneColor(booking.status) }]}>{String(booking.status).toUpperCase()}</Text>
                  <Text style={styles.requestTypeChip}>{booking.requestType === "NOW" ? "ChaufX now" : "Schedule later"}</Text>
                </View>
                <Text style={styles.bookingTitle}>{booking.pickupLocation}</Text>
                <Text style={styles.bookingCopy}>{booking.destinationLocation}</Text>
                <Text style={styles.bookingMeta}>{formatDateTime(booking.scheduledStartAt)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {tab === "account" ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Account</Text>
            <View style={styles.accountRow}>
              <Text style={styles.accountLabel}>Name</Text>
              <Text style={styles.accountValue}>{profile?.fullName ?? session.user.fullName}</Text>
            </View>
            <View style={styles.accountRow}>
              <Text style={styles.accountLabel}>Email</Text>
              <Text style={styles.accountValue}>{profile?.email ?? session.user.email}</Text>
            </View>
            <Pressable style={styles.secondaryButton} onPress={logout}>
              <Text style={styles.secondaryButtonText}>Log out</Text>
            </Pressable>
          </View>
        ) : null}

          {status ? <Text style={styles.statusText}>{status}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#081930"
  },
  keyboardWrap: {
    flex: 1
  },
  scroll: {
    flex: 1
  },
  content: {
    paddingHorizontal: 20,
    gap: 16
  },
  contentGrow: {
    flexGrow: 1
  },
  loginWrap: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 24,
    justifyContent: "center"
  },
  loginPanel: {
    borderRadius: 28,
    backgroundColor: "#0F172A",
    padding: 24,
    gap: 14
  },
  loginLogo: {
    width: 112,
    height: 112,
    alignSelf: "center"
  },
  loginEyebrow: {
    color: "#60A5FA",
    fontSize: 11,
    letterSpacing: 2.4,
    textAlign: "center",
    fontWeight: "700"
  },
  loginTitle: {
    color: "#FFFFFF",
    fontSize: 21,
    fontWeight: "700",
    textAlign: "center"
  },
  loginCopy: {
    color: "#CBD5E1",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center"
  },
  loginCard: {
    borderRadius: 24,
    backgroundColor: "#F8FAFC",
    padding: 16,
    gap: 12
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  headerLabel: {
    color: "#60A5FA",
    fontSize: 12,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    fontWeight: "700"
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "700",
    marginTop: 4
  },
  ghostButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
    paddingHorizontal: 14,
    paddingVertical: 9
  },
  ghostButtonText: {
    color: "#E2E8F0",
    fontWeight: "600"
  },
  mapCard: {
    height: 332,
    position: "relative"
  },
  mapFrame: {
    flex: 1,
    overflow: "hidden",
    borderRadius: 30,
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.18)",
    backgroundColor: "#0F172A"
  },
  map: {
    flex: 1
  },
  mapFallback: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    backgroundColor: "#0F172A"
  },
  mapFallbackTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700"
  },
  mapFallbackText: {
    color: "#CBD5E1",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginTop: 10
  },
  markerCurrent: {
    width: 16,
    height: 16,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    shadowColor: "#081930",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4
  },
  markerPulse: {
    width: 18,
    height: 18,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    shadowColor: "#081930",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4
  },
  markerDiamond: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    transform: [{ rotate: "45deg" }],
    shadowColor: "#081930",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4
  },
  mapLegend: {
    position: "absolute",
    top: 14,
    right: 14,
    gap: 8
  },
  mapLegendPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: "rgba(15,23,42,0.82)",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)"
  },
  mapLegendText: {
    color: "#E2E8F0",
    fontSize: 11,
    fontWeight: "700"
  },
  legendPulse: {
    width: 12,
    height: 12,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "#FFFFFF"
  },
  legendDiamond: {
    width: 12,
    height: 12,
    borderRadius: 3,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    transform: [{ rotate: "45deg" }]
  },
  tabRow: {
    flexDirection: "row",
    gap: 10
  },
  tabButton: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: "#111C30",
    paddingVertical: 12,
    alignItems: "center"
  },
  tabButtonActive: {
    backgroundColor: "#2563EB"
  },
  tabButtonText: {
    color: "#CBD5E1",
    fontWeight: "600"
  },
  tabButtonTextActive: {
    color: "#FFFFFF"
  },
  panel: {
    borderRadius: 28,
    backgroundColor: "#F8FAFC",
    padding: 18,
    gap: 14
  },
  panelTitle: {
    color: "#0F172A",
    fontSize: 18,
    fontWeight: "700"
  },
  detailsBlockTitle: {
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "700"
  },
  helperText: {
    color: "#64748B",
    fontSize: 14,
    lineHeight: 20
  },
  fieldStack: {
    gap: 12
  },
  suggestionPanel: {
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D9E1EC",
    overflow: "hidden"
  },
  suggestionRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#EEF2F7"
  },
  suggestionText: {
    color: "#0F172A",
    fontSize: 14,
    lineHeight: 20
  },
  suggestionHint: {
    color: "#64748B",
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  input: {
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D9E1EC",
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: "#0F172A",
    fontSize: 16
  },
  secondaryButton: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#C7D2FE",
    backgroundColor: "#EEF2FF",
    paddingVertical: 14,
    alignItems: "center"
  },
  secondaryButtonText: {
    color: "#4338CA",
    fontWeight: "700"
  },
  primaryButton: {
    borderRadius: 18,
    backgroundColor: "#2563EB",
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center"
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700"
  },
  buttonDisabled: {
    opacity: 0.6
  },
  modeRow: {
    flexDirection: "row",
    gap: 10
  },
  modeButton: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: "#E2E8F0",
    paddingVertical: 13,
    alignItems: "center"
  },
  modeButtonActive: {
    backgroundColor: "#0F172A"
  },
  modeButtonText: {
    color: "#334155",
    fontWeight: "700"
  },
  modeButtonTextActive: {
    color: "#FFFFFF"
  },
  bookingDetailsCard: {
    borderRadius: 22,
    backgroundColor: "#EEF4FF",
    padding: 14,
    gap: 12
  },
  scheduleCard: {
    flexDirection: "row",
    gap: 10,
    alignItems: "stretch"
  },
  hoursCard: {
    gap: 10
  },
  hoursRow: {
    alignItems: "center"
  },
  hoursStepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flex: 1,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D9E1EC",
    padding: 8
  },
  hoursStepperButton: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#EEF2FF",
    alignItems: "center",
    justifyContent: "center"
  },
  hoursStepperButtonText: {
    color: "#4338CA",
    fontSize: 24,
    fontWeight: "700",
    lineHeight: 28
  },
  hoursStepperValueWrap: {
    alignItems: "center",
    justifyContent: "center",
    flex: 1
  },
  hoursStepperValue: {
    color: "#0F172A",
    fontSize: 28,
    fontWeight: "800"
  },
  hoursStepperUnit: {
    color: "#64748B",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 2
  },
  schedulePickerCard: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D9E1EC",
    overflow: "hidden"
  },
  scheduleButton: {
    padding: 14
  },
  inlinePickerWrap: {
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    paddingHorizontal: 8,
    paddingBottom: 8,
    alignItems: "center"
  },
  scheduleLabel: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1.2
  },
  scheduleValue: {
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "700",
    marginTop: 6
  },
  estimateRow: {
    borderRadius: 20,
    backgroundColor: "#E0F2FE",
    padding: 16,
    gap: 6
  },
  estimateLabel: {
    color: "#0369A1",
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    fontWeight: "700"
  },
  estimateValue: {
    color: "#0F172A",
    fontSize: 24,
    fontWeight: "800"
  },
  estimateMeta: {
    color: "#334155",
    fontSize: 13,
    lineHeight: 20
  },
  detailsFooterNote: {
    color: "#64748B",
    fontSize: 13,
    lineHeight: 19
  },
  bookingCard: {
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 16,
    gap: 6
  },
  bookingHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  bookingTagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap"
  },
  bookingStatus: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.3
  },
  requestTypeChip: {
    borderRadius: 999,
    backgroundColor: "#E0E7FF",
    color: "#4338CA",
    fontSize: 11,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  linkText: {
    color: "#2563EB",
    fontWeight: "700"
  },
  bookingTitle: {
    color: "#0F172A",
    fontSize: 18,
    fontWeight: "700"
  },
  bookingCopy: {
    color: "#475569",
    fontSize: 15
  },
  bookingMeta: {
    color: "#64748B",
    fontSize: 13
  },
  infoStrip: {
    marginTop: 8,
    borderRadius: 16,
    backgroundColor: "#0F172A",
    padding: 14
  },
  infoStripText: {
    color: "#E2E8F0",
    fontSize: 13,
    lineHeight: 19
  },
  emptyText: {
    color: "#64748B",
    fontSize: 15
  },
  accountRow: {
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 16
  },
  accountLabel: {
    color: "#64748B",
    fontSize: 12,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    fontWeight: "700"
  },
  accountValue: {
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "700",
    marginTop: 6
  },
  statusText: {
    color: "#CBD5E1",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center"
  }
});
