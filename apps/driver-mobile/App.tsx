import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from "react-native";
import { StatusBar } from "expo-status-bar";
import Mapbox from "@rnmapbox/maps";
import * as Location from "expo-location";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { formatDateTime } from "@chaufx/ui";
import {
  acceptBooking,
  endTrip,
  fetchBookings,
  fetchDriverProfile,
  fetchMapState,
  login,
  rejectBooking,
  setAvailability,
  shareLocation,
  startTrip,
  updateDriverLocation
} from "./src/lib/api";

type Tab = "home" | "account";
type Coordinate = { latitude: number; longitude: number };

const logo = require("./assets/dm-logo-light.png");
const mapboxToken = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "";

function Marker({ color, variant }: { color: string; variant: "pickup" | "destination" }) {
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

  return (
    <Animated.View
      style={[
        styles.markerPulse,
        { backgroundColor: color, opacity: pulse, transform: [{ scale: pulse }] }
      ]}
    />
  );
}

function toneColor(status?: string) {
  const normalized = String(status ?? "").toLowerCase();
  if (["active", "completed"].includes(normalized)) return "#16A34A";
  if (["accepted", "enroute"].includes(normalized)) return "#2563EB";
  if (normalized === "pending") return "#D97706";
  if (normalized === "cancelled") return "#DC2626";
  return "#2563EB";
}

function formatRequestType(value?: string) {
  return value === "LATER" ? "Schedule later" : "ChaufX now";
}

function isSameDay(date: Date, now: Date) {
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function getDriverProvince(profile: any) {
  const rawProvince = profile?.application?.preferredServiceAreas?.[0] ?? profile?.serviceAreas?.[0];

  if (!rawProvince) {
    return "Not provided";
  }

  if (String(rawProvince).startsWith("WPG-")) {
    return "Manitoba";
  }

  return rawProvince;
}

function formatHours(expectedDurationMinutes?: number) {
  if (!expectedDurationMinutes || expectedDurationMinutes <= 0) {
    return "Not set";
  }

  const hours = Math.ceil(expectedDurationMinutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
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
    zoomLevel: 12.6,
    centerCoordinate: [fallback.longitude, fallback.latitude] as [number, number],
    animationMode: "easeTo" as const,
    animationDuration: 600
  };
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

function DriverMap({
  driverCoordinate,
  pickupCoordinate,
  destinationCoordinate
}: {
  driverCoordinate: Coordinate | null;
  pickupCoordinate: Coordinate | null;
  destinationCoordinate: Coordinate | null;
}) {
  const center = driverCoordinate ?? pickupCoordinate ?? { latitude: 49.8951, longitude: -97.1384 };
  const cameraProps = buildCameraProps(
    [driverCoordinate, pickupCoordinate, destinationCoordinate].filter(Boolean) as Coordinate[],
    center
  );
  const [routeShape, setRouteShape] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;

    if (!pickupCoordinate || !destinationCoordinate) {
      setRouteShape(null);
      return;
    }

    fetchRouteGeometry(pickupCoordinate, destinationCoordinate)
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
  }, [pickupCoordinate, destinationCoordinate]);

  if (!mapboxToken) {
    return (
      <View style={styles.mapFallback}>
        <Text style={styles.mapFallbackTitle}>Mapbox token needed</Text>
        <Text style={styles.mapFallbackText}>
          Add `EXPO_PUBLIC_MAPBOX_TOKEN` and run a custom Expo dev build to enable live maps.
        </Text>
      </View>
    );
  }

  return (
    <Mapbox.MapView style={styles.map} styleURL="mapbox://styles/mapbox/navigation-night-v1" compassEnabled={false} logoEnabled={false} attributionEnabled={false}>
      <Mapbox.Camera {...cameraProps} />
      {driverCoordinate ? <Mapbox.LocationPuck visible puckBearingEnabled puckBearing="heading" /> : null}
      {pickupCoordinate ? (
        <Mapbox.PointAnnotation id="pickup" coordinate={[pickupCoordinate.longitude, pickupCoordinate.latitude]}>
          <Marker color="#EA580C" variant="pickup" />
        </Mapbox.PointAnnotation>
      ) : null}
      {destinationCoordinate ? (
        <Mapbox.PointAnnotation id="dropoff" coordinate={[destinationCoordinate.longitude, destinationCoordinate.latitude]}>
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
  const [session, setSession] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState("");
  const [loginEmail, setLoginEmail] = useState("driver@chaufx.app");
  const [loginPassword, setLoginPassword] = useState("DriverPass123$");
  const [driverProfile, setDriverProfile] = useState<any>(null);
  const [bookings, setBookings] = useState<any[]>([]);
  const [mapState, setMapState] = useState<any>(null);
  const [driverCoordinate, setDriverCoordinate] = useState<Coordinate | null>(null);
  const [gpsStatus, setGpsStatus] = useState<"idle" | "streaming" | "paused">("idle");
  const locationWatchRef = useRef<Location.LocationSubscription | null>(null);
  const lastTripShareRef = useRef<{ bookingId: string; at: number } | null>(null);

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

  const incomingRequests = useMemo(
    () => bookings.filter((booking) => String(booking.status).toLowerCase() === "pending"),
    [bookings]
  );
  const assignedTrips = useMemo(
    () => bookings.filter((booking) => booking.assignedDriverId === driverProfile?.id),
    [bookings, driverProfile?.id]
  );
  const currentTrip = useMemo(() => {
    const now = new Date();
    return (
      assignedTrips.find((booking) => {
        const status = String(booking.status).toLowerCase();
        const scheduledAt = new Date(booking.scheduledStartAt);
        return ["accepted", "enroute", "active"].includes(status) && isSameDay(scheduledAt, now) && scheduledAt >= now;
      }) ?? null
    );
  }, [assignedTrips]);
  const scheduledTrips = useMemo(() => {
    const now = new Date();
    return assignedTrips.filter((booking) => {
      const status = String(booking.status).toLowerCase();
      const scheduledAt = new Date(booking.scheduledStartAt);
      return ["pending", "accepted"].includes(status) && scheduledAt > now && booking.id !== currentTrip?.id;
    });
  }, [assignedTrips, currentTrip?.id]);

  const pickupCoordinate = useMemo<Coordinate | null>(() => {
    if (!currentTrip) {
      return null;
    }
    return { latitude: currentTrip.pickupLat, longitude: currentTrip.pickupLng };
  }, [currentTrip]);

  const destinationCoordinate = useMemo<Coordinate | null>(() => {
    if (!currentTrip) {
      return null;
    }
    return { latitude: currentTrip.destinationLat, longitude: currentTrip.destinationLng };
  }, [currentTrip]);

  useEffect(() => {
    if (!session?.accessToken || (!driverProfile?.availabilityStatus && !currentTrip)) {
      if (locationWatchRef.current) {
        locationWatchRef.current.remove();
        locationWatchRef.current = null;
      }
      setGpsStatus("idle");
      return;
    }

    let cancelled = false;

    async function startTracking() {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setGpsStatus("paused");
        setStatus("Location access is needed to route the nearest requests and share active trip progress.");
        return;
      }

      const current =
        (await Location.getLastKnownPositionAsync()) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));

      if (current && !cancelled) {
        const coords = {
          latitude: current.coords.latitude,
          longitude: current.coords.longitude
        };
        setDriverCoordinate(coords);
        await publishDriverLocation(current.coords);
      }

      locationWatchRef.current?.remove();
      locationWatchRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 30,
          timeInterval: 15000
        },
        async (update) => {
          if (cancelled) {
            return;
          }
          setDriverCoordinate({
            latitude: update.coords.latitude,
            longitude: update.coords.longitude
          });
          await publishDriverLocation(update.coords);
        }
      );
      setGpsStatus("streaming");
    }

    startTracking().catch((error) => {
      setGpsStatus("paused");
      setStatus(error instanceof Error ? error.message : "Unable to start GPS tracking.");
    });

    return () => {
      cancelled = true;
      locationWatchRef.current?.remove();
      locationWatchRef.current = null;
    };
  }, [currentTrip?.id, driverProfile?.availabilityStatus, session?.accessToken]);

  async function publishDriverLocation(coords: Location.LocationObjectCoords) {
    if (!session?.accessToken) {
      return;
    }

    try {
      const updated = await updateDriverLocation(session.accessToken, coords.latitude, coords.longitude);
      setDriverProfile((current: any) => ({ ...(current ?? {}), ...updated }));

      if (currentTrip && mapState?.active) {
        const previous = lastTripShareRef.current;
        if (!previous || previous.bookingId !== currentTrip.id || Date.now() - previous.at > 15000) {
          await shareLocation(
            session.accessToken,
            currentTrip.id,
            coords.latitude,
            coords.longitude,
            typeof coords.heading === "number" ? coords.heading : undefined,
            typeof coords.speed === "number" && coords.speed >= 0 ? coords.speed * 3.6 : undefined
          );
          lastTripShareRef.current = {
            bookingId: currentTrip.id,
            at: Date.now()
          };
        }
      }
    } catch (error) {
      setGpsStatus("paused");
      setStatus(error instanceof Error ? error.message : "Unable to sync your live GPS.");
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

      setDriverCoordinate({
        latitude: current.coords.latitude,
        longitude: current.coords.longitude
      });
    } catch {
      // Keep the map available even before GPS is granted.
    }
  }

  async function refreshDashboard() {
    if (!session?.accessToken) {
      return;
    }

    setRefreshing(true);
    try {
      const [profile, bookingList] = await Promise.all([
        fetchDriverProfile(session.accessToken),
        fetchBookings(session.accessToken)
      ]);
      setDriverProfile(profile);
      setBookings(bookingList);

      const trackable = bookingList.find((booking) => booking.assignedDriverId === profile.id && ["accepted", "enroute", "active"].includes(String(booking.status).toLowerCase()));
      if (trackable) {
        setMapState(await fetchMapState(session.accessToken, trackable.id));
      } else {
        setMapState(null);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to refresh the driver app.");
    } finally {
      setRefreshing(false);
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

  async function toggleAvailability(value: boolean) {
    if (!session?.accessToken) {
      return;
    }

    setBusy(true);
    try {
      const updated = await setAvailability(session.accessToken, value);
      setDriverProfile((current: any) => ({ ...(current ?? {}), ...updated }));
      setStatus(value ? "You are online and ready for nearby requests." : "You are offline.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update availability.");
    } finally {
      setBusy(false);
    }
  }

  async function decideRequest(bookingId: string, action: "accept" | "reject") {
    if (!session?.accessToken) {
      return;
    }

    setBusy(true);
    try {
      if (action === "accept") {
        await acceptBooking(session.accessToken, bookingId);
        setStatus("Trip accepted.");
      } else {
        await rejectBooking(session.accessToken, bookingId);
        setStatus("Request declined.");
      }
      await refreshDashboard();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update this request.");
    } finally {
      setBusy(false);
    }
  }

  async function handleTripAction(action: "start" | "end") {
    if (!session?.accessToken || !currentTrip) {
      return;
    }

    setBusy(true);
    try {
      if (action === "start") {
        await startTrip(session.accessToken, currentTrip.id);
        setStatus("Trip started.");
      } else {
        await endTrip(session.accessToken, currentTrip.id);
        setStatus("Trip completed.");
      }
      await refreshDashboard();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update trip status.");
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    locationWatchRef.current?.remove();
    locationWatchRef.current = null;
    lastTripShareRef.current = null;
    setSession(null);
    setDriverProfile(null);
    setBookings([]);
    setMapState(null);
    setDriverCoordinate(null);
    setGpsStatus("idle");
    setStatus("");
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <View style={[styles.loginWrap, { paddingTop: Math.max(insets.top, 18) + 20 }]}>
          <View style={styles.loginPanel}>
            <Image source={logo} style={styles.loginLogo} resizeMode="contain" />
            <Text style={styles.loginEyebrow}>DRIVER ACCESS</Text>
            <Text style={styles.loginTitle}>Approved drivers only.</Text>
            <Text style={styles.loginCopy}>
              Go online, receive nearby requests, and unlock trip tools only inside the approved trip window.
            </Text>

            <View style={styles.loginCard}>
              <TextInput
                placeholder="driver@chaufx.app"
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
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 10) + 12, paddingBottom: 34 }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerLabel}>Driver app</Text>
            <Text style={styles.headerTitle}>Hello {driverProfile?.user?.fullName?.split(" ")[0] ?? "driver"}</Text>
          </View>
          <Pressable style={styles.ghostButton} onPress={refreshDashboard}>
            <Text style={styles.ghostButtonText}>{refreshing ? "Refreshing..." : "Refresh"}</Text>
          </Pressable>
        </View>

        <View style={styles.mapCard}>
          <DriverMap driverCoordinate={driverCoordinate} pickupCoordinate={pickupCoordinate} destinationCoordinate={destinationCoordinate} />
          <View style={styles.mapLegend}>
            <View style={styles.mapLegendPill}>
              <View style={[styles.legendPulse, { backgroundColor: "#EA580C" }]} />
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
            ["home", "Home"],
            ["account", "Account"]
          ].map(([key, label]) => (
            <Pressable key={key} style={[styles.tabButton, tab === key && styles.tabButtonActive]} onPress={() => setTab(key as Tab)}>
              <Text style={[styles.tabButtonText, tab === key && styles.tabButtonTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {tab === "home" ? (
          <>
            <View style={styles.panel}>
              <View style={styles.availabilityRow}>
                <View>
                  <Text style={styles.panelTitle}>Availability</Text>
                  <Text style={styles.subtleText}>
                    {driverProfile?.availabilityStatus ? "You are available for nearby routed requests." : "Go online to receive requests."}
                  </Text>
                </View>
                <Switch
                  value={Boolean(driverProfile?.availabilityStatus)}
                  onValueChange={toggleAvailability}
                  trackColor={{ false: "#CBD5E1", true: "#22C55E" }}
                  thumbColor="#FFFFFF"
                />
              </View>
            </View>

            {currentTrip ? (
              <View style={styles.panel}>
                <Text style={styles.panelTitle}>Current trip</Text>
                <View style={styles.tagRow}>
                  <Text style={styles.requestTypeChip}>{formatRequestType(currentTrip.requestType)}</Text>
                  <Text style={[styles.bookingStatus, { color: toneColor(currentTrip.status) }]}>{String(currentTrip.status).toUpperCase()}</Text>
                </View>
                <Text style={styles.bookingTitle}>{currentTrip.pickupLocation}</Text>
                <Text style={styles.bookingCopy}>{currentTrip.destinationLocation}</Text>
                <Text style={styles.bookingMeta}>{formatDateTime(currentTrip.scheduledStartAt)}</Text>
                <Text style={styles.bookingMeta}>Duration · {formatHours(currentTrip.expectedDurationMinutes)}</Text>
                <View style={styles.actionRow}>
                  <Pressable style={[styles.primaryButton, styles.flexButton, busy && styles.buttonDisabled]} disabled={busy} onPress={() => handleTripAction("start")}>
                    <Text style={styles.primaryButtonText}>Start trip</Text>
                  </Pressable>
                  <Pressable style={[styles.secondaryButton, styles.flexButton]} onPress={() => handleTripAction("end")}>
                    <Text style={styles.secondaryButtonText}>End trip</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Scheduled trips</Text>
              {scheduledTrips.length ? (
                scheduledTrips.map((booking) => (
                  <View key={booking.id} style={styles.bookingCard}>
                    <View style={styles.tagRow}>
                      <Text style={[styles.bookingStatus, { color: toneColor(booking.status) }]}>{String(booking.status).toUpperCase()}</Text>
                      <Text style={styles.requestTypeChip}>{formatRequestType(booking.requestType)}</Text>
                    </View>
                    <Text style={styles.bookingTitle}>{booking.pickupLocation}</Text>
                    <Text style={styles.bookingCopy}>{booking.destinationLocation}</Text>
                    <Text style={styles.bookingMeta}>{formatDateTime(booking.scheduledStartAt)}</Text>
                    <Text style={styles.bookingMeta}>Duration · {formatHours(booking.expectedDurationMinutes)}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.emptyText}>No future scheduled trips yet.</Text>
              )}
            </View>

            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Incoming requests</Text>
              {incomingRequests.length ? (
                incomingRequests.map((booking) => (
                  <View key={booking.id} style={styles.bookingCard}>
                    <View style={styles.tagRow}>
                      <Text style={[styles.bookingStatus, { color: toneColor(booking.status) }]}>{String(booking.status).toUpperCase()}</Text>
                      <Text style={styles.requestTypeChip}>{formatRequestType(booking.requestType)}</Text>
                    </View>
                    <Text style={styles.bookingTitle}>{booking.pickupLocation}</Text>
                    <Text style={styles.bookingCopy}>{booking.destinationLocation}</Text>
                    <Text style={styles.bookingMeta}>{formatDateTime(booking.scheduledStartAt)}</Text>
                    <Text style={styles.bookingMeta}>Duration · {formatHours(booking.expectedDurationMinutes)}</Text>
                    <View style={styles.actionRow}>
                      <Pressable style={[styles.primaryButton, styles.flexButton, busy && styles.buttonDisabled]} disabled={busy} onPress={() => decideRequest(booking.id, "accept")}>
                        <Text style={styles.primaryButtonText}>Accept</Text>
                      </Pressable>
                      <Pressable style={[styles.secondaryButton, styles.flexButton]} onPress={() => decideRequest(booking.id, "reject")}>
                        <Text style={styles.secondaryButtonText}>Decline</Text>
                      </Pressable>
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.emptyText}>No nearby requests are waiting for you right now.</Text>
              )}
            </View>
          </>
        ) : null}

        {tab === "account" ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Account</Text>
            <View style={styles.accountRow}>
              <Text style={styles.accountLabel}>Driver</Text>
              <Text style={styles.accountValue}>{driverProfile?.user?.fullName ?? session.user.fullName}</Text>
            </View>
            <View style={styles.accountRow}>
              <Text style={styles.accountLabel}>Email</Text>
              <Text style={styles.accountValue}>{driverProfile?.user?.email ?? session.user.email}</Text>
            </View>
            <View style={styles.accountRow}>
              <Text style={styles.accountLabel}>Province</Text>
              <Text style={styles.accountValue}>{getDriverProvince(driverProfile)}</Text>
            </View>
            <Pressable style={styles.secondaryButton} onPress={logout}>
              <Text style={styles.secondaryButtonText}>Log out</Text>
            </Pressable>
          </View>
        ) : null}

        {status ? <Text style={styles.statusText}>{status}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#081930"
  },
  content: {
    paddingHorizontal: 20,
    gap: 16
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
    fontSize: 28,
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
    position: "relative",
    overflow: "hidden",
    borderRadius: 30,
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.18)",
    backgroundColor: "#0F172A",
    height: 320
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
  subtleText: {
    color: "#64748B",
    marginTop: 6,
    lineHeight: 20
  },
  helperText: {
    color: "#64748B",
    fontSize: 14,
    lineHeight: 20
  },
  availabilityRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
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
  secondaryButton: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#C7D2FE",
    backgroundColor: "#EEF2FF",
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center"
  },
  secondaryButtonText: {
    color: "#4338CA",
    fontWeight: "700"
  },
  flexButton: {
    flex: 1
  },
  buttonDisabled: {
    opacity: 0.6
  },
  bookingCard: {
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 16,
    gap: 6
  },
  tagRow: {
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
    borderRadius: 16,
    backgroundColor: "#0F172A",
    padding: 14
  },
  infoStripText: {
    color: "#E2E8F0",
    fontSize: 13,
    lineHeight: 19
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8
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
