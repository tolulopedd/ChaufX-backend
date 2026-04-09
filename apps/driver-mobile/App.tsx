import { useEffect, useRef, useState } from "react";
import {
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
import * as Location from "expo-location";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { appConfig, defaultServiceZones, toCurrency } from "@driveme/config";
import { bookingStatusTone, brand, formatDateTime } from "@driveme/ui";
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

type Tab = "dashboard" | "requests" | "history" | "profile";

const driverTabs: Array<{ key: Tab; label: string }> = [
  { key: "dashboard", label: "Dashboard" },
  { key: "requests", label: "Requests" },
  { key: "history", label: "History" },
  { key: "profile", label: "Profile" }
];

const logoLight = require("./assets/dm-logo-light.png");
const logoDark = require("./assets/dm-logo-dark.png");

function inferServiceFromBooking(booking: any) {
  const notes = String(booking.specialNotes ?? "").toLowerCase();
  if (notes.includes("drink & dial") || notes.includes("night out")) return "Drink & Dial";
  if (notes.includes("medical") || notes.includes("therapy") || notes.includes("senior")) return "Assisted service";
  if (notes.includes("event")) return "Event service";
  if (notes.includes("shopping") || notes.includes("errand")) return "Errands";
  if (notes.includes("long-distance")) return "Long-distance";
  if (notes.includes("business") || notes.includes("schedule")) return "Busy schedule";
  return "Personal driver";
}

function getDriverZonePresets(serviceAreas: string[] = []) {
  const presets = defaultServiceZones.filter((zone) => serviceAreas.includes(zone.code));
  return presets.length ? presets : defaultServiceZones;
}

function resolveNearestZoneCode(latitude: number, longitude: number, serviceAreas: string[] = []) {
  const zones = getDriverZonePresets(serviceAreas);
  const [nearest] = zones
    .map((zone) => ({
      code: zone.code,
      score: Math.hypot(latitude - zone.centerLat, longitude - zone.centerLng)
    }))
    .sort((left, right) => left.score - right.score);

  return nearest?.code;
}

function formatCoordinate(value?: number | null) {
  return typeof value === "number" ? value.toFixed(4) : "--";
}

function toSpeedKph(speedMetersPerSecond?: number | null) {
  return typeof speedMetersPerSecond === "number" && speedMetersPerSecond >= 0
    ? Number((speedMetersPerSecond * 3.6).toFixed(1))
    : undefined;
}

export default function App() {
  const insets = useSafeAreaInsets();
  const [session, setSession] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [driverProfile, setDriverProfile] = useState<any>(null);
  const [bookings, setBookings] = useState<any[]>([]);
  const [mapState, setMapState] = useState<any>(null);
  const [latestAcceptedBookingId, setLatestAcceptedBookingId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [loginEmail, setLoginEmail] = useState("driver@driveme.app");
  const [loginPassword, setLoginPassword] = useState("DriverPass123$");
  const [locationPermission, setLocationPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [locationActionPending, setLocationActionPending] = useState(false);
  const [tripLocationStatus, setTripLocationStatus] = useState<"idle" | "streaming" | "paused">("idle");
  const [tripLocationSharedAt, setTripLocationSharedAt] = useState<string | null>(null);
  const locationWatchRef = useRef<Location.LocationSubscription | null>(null);
  const latestTripShareRef = useRef<{ bookingId: string; at: number } | null>(null);

  useEffect(() => {
    if (!session?.accessToken) {
      return;
    }

    refresh();
  }, [session]);

  useEffect(() => {
    let cancelled = false;

    async function syncPermissionState() {
      const permission = await Location.getForegroundPermissionsAsync();
      if (!cancelled) {
        setLocationPermission(permission.status === "granted" ? "granted" : permission.status === "denied" ? "denied" : "unknown");
      }
    }

    syncPermissionState();

    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh() {
    if (!session?.accessToken) {
      return;
    }

    const [profile, bookingList] = await Promise.all([
      fetchDriverProfile(session.accessToken),
      fetchBookings(session.accessToken)
    ]);

    setDriverProfile(profile);
    setBookings(bookingList);

    const assignedTrip = bookingList.find((booking) => booking.assignedDriverId === profile.id && ["accepted", "active", "enroute"].includes(String(booking.status).toLowerCase()));
    if (assignedTrip) {
      const nextState = await fetchMapState(session.accessToken, assignedTrip.id);
      setMapState(nextState);
    } else {
      setMapState(null);
    }
  }

  async function publishDriverLocation(latitude: number, longitude: number, announce = true, interactive = false) {
    if (!session?.accessToken) {
      return;
    }

    try {
      if (interactive) {
        setLocationActionPending(true);
      }
      const updatedDriver = await updateDriverLocation(
        session.accessToken,
        latitude,
        longitude,
        resolveNearestZoneCode(latitude, longitude, driverProfile?.serviceAreas)
      );
      setDriverProfile((current: any) => ({
        ...(current ?? {}),
        ...updatedDriver
      }));

      if (announce) {
        setStatus("Live queue location updated from your device GPS.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update live GPS location.");
    } finally {
      if (interactive) {
        setLocationActionPending(false);
      }
    }
  }

  async function shareTripLocationFromCoords(coords: Location.LocationObjectCoords, announce = false) {
    if (!session?.accessToken || !activeTrip || !mapState?.active) {
      return;
    }

    const previousShare = latestTripShareRef.current;
    if (previousShare && previousShare.bookingId === activeTrip.id && Date.now() - previousShare.at < 15_000) {
      return;
    }

    try {
      await shareLocation(
        session.accessToken,
        activeTrip.id,
        coords.latitude,
        coords.longitude,
        typeof coords.heading === "number" ? coords.heading : undefined,
        toSpeedKph(coords.speed)
      );
      latestTripShareRef.current = {
        bookingId: activeTrip.id,
        at: Date.now()
      };
      setTripLocationStatus("streaming");
      setTripLocationSharedAt(new Date().toLocaleTimeString());

      if (announce) {
        setStatus("Active trip location shared from your live GPS position.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to share live trip location.");
      setTripLocationStatus("paused");
    }
  }

  async function enableLiveLocation() {
    const permission = await Location.requestForegroundPermissionsAsync();
    const nextPermission =
      permission.status === "granted" ? "granted" : permission.status === "denied" ? "denied" : "unknown";
    setLocationPermission(nextPermission);

    if (permission.status !== "granted") {
      setStatus("Location access is required so DriveMe can route the nearest customer requests to you.");
      return;
    }

    try {
      const current =
        (await Location.getLastKnownPositionAsync()) ??
        (await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced
        }));

      if (!current) {
        setStatus("We could not read your GPS position yet. Try again in a few seconds.");
        return;
      }

      await publishDriverLocation(current.coords.latitude, current.coords.longitude, true, true);
      setStatus("Live GPS enabled. DriveMe will keep your queue position updated while you are online.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to read your current GPS location.");
      setLocationActionPending(false);
    }
  }

  function handleLogout() {
    if (locationWatchRef.current) {
      locationWatchRef.current.remove();
      locationWatchRef.current = null;
    }
    setMenuOpen(false);
    setTab("dashboard");
    setSession(null);
    setDriverProfile(null);
    setBookings([]);
    setMapState(null);
    setLatestAcceptedBookingId(null);
    setStatus("");
    latestTripShareRef.current = null;
  }

  const activeRequests = bookings.filter((booking) => String(booking.status).toLowerCase() === "pending");
  const assignedTrips = bookings.filter((booking) => booking.assignedDriverId === driverProfile?.id);
  const activeTrip = assignedTrips.find((booking) => ["accepted", "active", "enroute"].includes(String(booking.status).toLowerCase()));
  const acceptedTrip = assignedTrips.find((booking) => String(booking.status).toLowerCase() === "accepted");
  const latestAcceptedTrip = assignedTrips.find((booking) => booking.id === latestAcceptedBookingId) ?? acceptedTrip;
  const serviceAreaKey = driverProfile?.serviceAreas?.join(",") ?? "";

  useEffect(() => {
    if (!activeTrip) {
      setTripLocationStatus("idle");
      setTripLocationSharedAt(null);
      latestTripShareRef.current = null;
      return;
    }

    if (!mapState?.active) {
      setTripLocationStatus("paused");
      return;
    }

    if (!latestTripShareRef.current || latestTripShareRef.current.bookingId !== activeTrip.id) {
      setTripLocationStatus("idle");
      setTripLocationSharedAt(null);
    }
  }, [activeTrip?.id, mapState?.active]);

  useEffect(() => {
    let cancelled = false;

    async function startLiveLocationWatch() {
      if (!session?.accessToken || !driverProfile?.availabilityStatus || locationPermission !== "granted") {
        if (locationWatchRef.current) {
          locationWatchRef.current.remove();
          locationWatchRef.current = null;
        }
        return;
      }

      if (locationWatchRef.current) {
        return;
      }

      try {
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced
        });

        if (cancelled) {
          return;
        }

        await publishDriverLocation(current.coords.latitude, current.coords.longitude, false);
        await shareTripLocationFromCoords(current.coords, false);

        const subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: 200,
            timeInterval: 60_000
          },
          async (position) => {
            if (cancelled) {
              return;
            }

            await publishDriverLocation(position.coords.latitude, position.coords.longitude, false);
            await shareTripLocationFromCoords(position.coords, false);
          }
        );

        if (cancelled) {
          subscription.remove();
          return;
        }

        locationWatchRef.current = subscription;
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : "Unable to start live GPS updates.");
        }
      }
    }

    startLiveLocationWatch();

    return () => {
      cancelled = true;
      if (locationWatchRef.current) {
        locationWatchRef.current.remove();
        locationWatchRef.current = null;
      }
    };
  }, [activeTrip?.id, driverProfile?.availabilityStatus, locationPermission, mapState?.active, serviceAreaKey, session?.accessToken]);

  if (!session) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["left", "right", "bottom"]}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={[styles.authWrap, { paddingTop: Math.max(insets.top + 6, 24) }]}>
          <View style={styles.authHero}>
            <View style={styles.authHeroRow}>
              <BrandLogo dark />
              <View style={[styles.authHeroContent, styles.authHeroContentRight]}>
                <View style={[styles.heroBadge, styles.heroBadgeRight]}>
                  <Text style={styles.heroBadgeText}>Driver access</Text>
                </View>
                <Text
                  style={[styles.authTitle, styles.authTitleCompact, styles.authTitleRight]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                >
                  App for approved drivers.
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.authCard}>
            <Text style={styles.cardEyebrow}>Secure sign in</Text>
            <Text style={styles.authCardTitle}>Driver login</Text>
            <Text style={styles.cardSubtitle}>
              Sign in to manage availability, accept assignments, and execute active trips in the Driver App.
            </Text>

            <View style={styles.authFieldGroup}>
              <Text style={styles.authFieldLabel}>Email</Text>
              <TextInput
                value={loginEmail}
                onChangeText={setLoginEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                style={styles.authInput}
              />
            </View>

            <View style={styles.authFieldGroup}>
              <View style={styles.authFieldHeader}>
                <Text style={styles.authFieldLabel}>Password</Text>
                <Text style={styles.authHelperText}>Approved drivers only</Text>
              </View>
              <TextInput value={loginPassword} onChangeText={setLoginPassword} secureTextEntry style={styles.authInput} />
            </View>

            <Pressable
              style={styles.primaryButton}
              onPress={async () => {
                setStatus("Signing in...");
                try {
                  const nextSession = await login(loginEmail, loginPassword);
                  setSession(nextSession);
                  setStatus("");
                } catch (error) {
                  setStatus(error instanceof Error ? error.message : "Unable to sign in");
                }
              }}
            >
              <Text style={styles.primaryButtonText}>Sign in</Text>
            </Pressable>

            <Pressable
              style={styles.secondaryAction}
              onPress={() => {
                setLoginEmail("driver@driveme.app");
                setLoginPassword("DriverPass123$");
                setStatus("Demo credentials loaded.");
              }}
            >
              <Text style={styles.secondaryActionText}>Use demo account</Text>
            </Pressable>

            <View style={styles.demoBox}>
              <Text style={styles.demoLabel}>Demo access</Text>
              <Text style={styles.demoValue}>driver@driveme.app</Text>
              <Text style={[styles.demoValue, styles.demoValueCompact]}>DriverPass123$</Text>
            </View>

            {status ? <MessageBanner text={status} tone="warning" /> : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["left", "right", "bottom"]}>
      <StatusBar style="dark" />
      <ScrollView
        style={styles.body}
        contentContainerStyle={[styles.bodyContent, styles.bodyContentTop, { paddingTop: Math.max(insets.top + 6, 18) }]}
      >
        {status ? <MessageBanner text={status} tone="neutral" /> : null}
        {tab !== "dashboard" ? (
        <View style={styles.tabRow}>
          {driverTabs.map((item) => {
            const active = tab === item.key;

            return (
              <Pressable key={item.key} style={[styles.tabChip, active ? styles.tabChipActive : null]} onPress={() => setTab(item.key)}>
                <Text style={[styles.tabChipText, active ? styles.tabChipTextActive : null]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
        ) : null}
        {tab === "dashboard" ? (
          <View style={styles.homeScreen}>
            <View style={styles.sampleShell}>
              <View style={styles.sampleHeaderRow}>
                <View style={styles.sampleBrand}>
                  <BrandLogo dark size={74} />
                  <Text style={styles.sampleBrandText}>DriveMe Canada</Text>
                </View>
                <View style={[styles.heroBadge, styles.sampleStatusBadge]}>
                  <Text style={styles.heroBadgeText}>{driverProfile?.availabilityStatus ? "Online" : "Offline"}</Text>
                </View>
              </View>

              <SampleMapPreview />

              <View style={styles.stepInputCard}>
                <View style={styles.stepInputIcon}>
                  <Text style={styles.stepInputIconText}>1</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepInputTitle}>Ready to Drive</Text>
                  <Text style={styles.stepInputFieldText}>
                    {driverProfile?.availabilityStatus ? "Receiving nearest requests" : "Go online to receive trips"}
                  </Text>
                </View>
                <Switch
                  value={Boolean(driverProfile?.availabilityStatus)}
                  onValueChange={async (value) => {
                    await setAvailability(session.accessToken, value);
                    await refresh();
                    if (value) {
                      await enableLiveLocation();
                    }
                  }}
                />
              </View>

              <View style={styles.stepInputCard}>
                <View style={styles.stepInputIcon}>
                  <Text style={styles.stepInputIconText}>2</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepInputTitle}>Request Queue</Text>
                  <Text style={styles.stepInputFieldText}>
                    {activeRequests.length
                      ? `${activeRequests.length} nearby request${activeRequests.length > 1 ? "s" : ""} waiting`
                      : "No nearby requests yet"}
                  </Text>
                </View>
                <View style={styles.stepInputPin} />
              </View>

              <View style={styles.stepInputCard}>
                <View style={styles.stepInputIcon}>
                  <Text style={styles.stepInputIconText}>3</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepInputTitle}>Trip Tools</Text>
                  <Text style={styles.stepInputFieldText}>
                    {activeTrip
                      ? "Active trip ready now"
                      : latestAcceptedTrip
                        ? "Waiting for the approved window"
                        : "Stand by for the next trip"}
                  </Text>
                </View>
                <View style={styles.stepInputPin} />
              </View>

              <Pressable
                style={styles.samplePrimaryButton}
                onPress={async () => {
                  if (activeTrip) {
                    setTab("history");
                    return;
                  }
                  if (activeRequests.length) {
                    setTab("requests");
                    return;
                  }
                  await enableLiveLocation();
                }}
              >
                <Text style={styles.samplePrimaryButtonText}>
                  {activeTrip ? "OPEN CURRENT TRIP" : activeRequests.length ? "VIEW REQUESTS" : "ENABLE LIVE GPS"}
                </Text>
              </Pressable>

              <Pressable
                style={styles.sampleSecondaryButton}
                onPress={async () => {
                  if (activeTrip) {
                    try {
                      const current =
                        (await Location.getLastKnownPositionAsync()) ??
                        (await Location.getCurrentPositionAsync({
                          accuracy: Location.Accuracy.Balanced
                        }));
                      if (!current) {
                        setStatus("We could not read your GPS position yet. Try again in a few seconds.");
                        return;
                      }
                      await shareTripLocationFromCoords(current.coords, true);
                      await refresh();
                      return;
                    } catch (error) {
                      setStatus(error instanceof Error ? error.message : "Location update failed");
                      return;
                    }
                  }
                  setTab("profile");
                }}
              >
                <Text style={styles.sampleSecondaryButtonText}>{activeTrip ? "SHARE LOCATION" : "ACCOUNT"}</Text>
              </Pressable>

              {(activeTrip || latestAcceptedTrip) ? (
                <Pressable style={[styles.homeShortcut, styles.homeShortcutShell]} onPress={() => setTab("history")}>
                  <Text style={styles.homeShortcutLabel}>{activeTrip ? "CURRENT TRIP" : "NEXT DRIVE"}</Text>
                  <Text style={[styles.homeShortcutValue, styles.homeShortcutValueShell]}>
                    {activeTrip
                      ? `${activeTrip.pickupLocation} to ${activeTrip.destinationLocation}`
                      : latestAcceptedTrip
                        ? `${latestAcceptedTrip.pickupLocation} to ${latestAcceptedTrip.destinationLocation}`
                        : "View assignment"}
                  </Text>
                </Pressable>
              ) : null}

              <View style={[styles.homeNavRow, styles.homeFooter]}>
                <Pressable style={[styles.homeNavButton, styles.homeNavButtonShell]} onPress={() => setTab("requests")}>
                  <Text style={[styles.homeNavButtonText, styles.homeNavButtonTextShell]}>Requests</Text>
                </Pressable>
                <Pressable style={[styles.homeNavButton, styles.homeNavButtonShell]} onPress={() => setTab("profile")}>
                  <Text style={[styles.homeNavButtonText, styles.homeNavButtonTextShell]}>Account</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}

        {tab === "requests" ? (
          <Card eyebrow="Requests" title="Review and accept routed trips" subtitle="Check the reservation details before you commit. Once you accept, the customer is confirmed and your trip tools unlock only during the approved window.">
            {activeRequests.length ? (
              activeRequests.map((booking) => (
                <View key={booking.id} style={styles.requestCard}>
                  <View style={styles.requestTopRow}>
                    <View style={styles.requestServiceBadge}>
                      <Text style={styles.requestServiceBadgeText}>{inferServiceFromBooking(booking)}</Text>
                    </View>
                    <View style={styles.requestEstimateBadge}>
                      <Text style={styles.requestEstimateBadgeText}>{toCurrency(Number(booking.fareEstimate ?? 0), "CAD")}</Text>
                    </View>
                  </View>

                  <Text style={styles.tripTitle}>
                    {booking.pickupLocation} to {booking.destinationLocation}
                  </Text>
                  {booking.dispatches?.[0]?.distanceKm ? (
                    <Text style={styles.tripMeta}>{booking.dispatches[0].distanceKm} km from your published queue position</Text>
                  ) : null}
                  <Text style={styles.tripMeta}>{formatDateTime(booking.scheduledStartAt)}</Text>
                  <Text style={styles.tripMeta}>Vehicle: {booking.vehicleDetails ?? "Customer vehicle details will be shared after acceptance."}</Text>
                  {booking.specialNotes ? <Text style={styles.tripMeta}>{booking.specialNotes}</Text> : null}

                  <View style={styles.requestSummaryRow}>
                    <InfoTile label="Zone" value={booking.zoneCode} compact />
                    <InfoTile label="Duration" value={`${booking.expectedDurationMinutes} min`} compact />
                  </View>

                  <View style={styles.requestFooter}>
                    <Text style={styles.requestFooterText}>
                      After acceptance, DriveMe confirms the customer immediately and keeps navigation locked until the trip activation window opens.
                    </Text>
                  </View>

                  <View style={styles.buttonRow}>
                    <Pressable
                      style={styles.destructiveButton}
                      onPress={async () => {
                        try {
                          const result = await rejectBooking(session.accessToken, booking.id);
                          setStatus(result.message ?? "Request declined.");
                          await refresh();
                        } catch (error) {
                          setStatus(error instanceof Error ? error.message : "Unable to decline request");
                        }
                      }}
                    >
                      <Text style={styles.destructiveButtonText}>Decline</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.primaryButton, styles.primaryButtonFlex]}
                      onPress={async () => {
                        try {
                          const accepted = await acceptBooking(session.accessToken, booking.id);
                          setLatestAcceptedBookingId(accepted.id);
                          setStatus("Trip accepted. The customer has been notified and your assignment is confirmed.");
                          setTab("dashboard");
                          await refresh();
                        } catch (error) {
                          setStatus(error instanceof Error ? error.message : "Unable to accept booking");
                        }
                      }}
                    >
                      <Text style={styles.primaryButtonText}>Accept trip</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            ) : (
              <EmptyState title="No requests in queue" body="Stay online and DriveMe will route nearby customer bookings here when your service zone matches." />
            )}
          </Card>
        ) : null}

        {tab === "history" ? (
          <Card eyebrow="History" title="Trip history and earnings" subtitle="Review completed and assigned trips in one ledger-style view.">
            <Text style={styles.valueText}>${Number(driverProfile?.earningsAmount ?? 0).toFixed(2)}</Text>
            <Text style={styles.bodyText}>Earnings placeholder for the MVP. Hook settlement data into the payment module later.</Text>
            {assignedTrips.map((booking) => {
              const tone = bookingStatusTone(String(booking.status).toLowerCase() as any);
              return (
                <View key={booking.id} style={styles.tripRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tripTitle}>
                      {booking.pickupLocation} to {booking.destinationLocation}
                    </Text>
                    <Text style={styles.tripMeta}>{formatDateTime(booking.scheduledStartAt)}</Text>
                  </View>
                  <View style={[styles.badge, { backgroundColor: `${tone.color}1A` }]}>
                    <Text style={[styles.badgeText, { color: tone.color }]}>{tone.text}</Text>
                  </View>
                </View>
              );
            })}
          </Card>
        ) : null}

        {tab === "profile" ? (
          <Card eyebrow="Account" title="Driver profile" subtitle="Review your driver details, service areas, and operating profile.">
            <Text style={styles.valueText}>{session.user.fullName}</Text>
            <Text style={styles.bodyText}>{session.user.email}</Text>
            <Text style={styles.bodyText}>Service areas: {driverProfile?.serviceAreas?.join(", ")}</Text>
            <Text style={styles.bodyText}>Years of experience: {driverProfile?.yearsOfExperience}</Text>
            <View style={styles.buttonRow}>
              <Pressable style={styles.secondaryButton} onPress={refresh}>
                <Text style={styles.secondaryButtonText}>Refresh app</Text>
              </Pressable>
              <Pressable style={styles.destructiveButton} onPress={handleLogout}>
                <Text style={styles.destructiveButtonText}>Log out</Text>
              </Pressable>
            </View>
          </Card>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function BrandLogo({ dark = false, size = 94 }: { dark?: boolean; size?: number }) {
  return (
    <Image
      source={dark ? logoDark : logoLight}
      style={[styles.logo, { width: size, height: size }, dark ? styles.logoDark : styles.logoLight]}
      resizeMode="contain"
    />
  );
}

function Card({
  eyebrow,
  title,
  subtitle,
  tone = "light",
  children
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  tone?: "light" | "dark" | "indigo";
  children: React.ReactNode;
}) {
  const dark = tone === "dark" || tone === "indigo";
  const indigo = tone === "indigo";

  return (
    <View style={[styles.card, dark ? styles.cardDark : null, indigo ? styles.cardIndigo : null]}>
      <Text style={[styles.cardEyebrow, dark ? styles.cardEyebrowDark : null]}>{eyebrow}</Text>
      <Text style={[styles.sectionTitle, dark ? styles.sectionTitleDark : null]}>{title}</Text>
      <Text style={[styles.bodyText, dark ? styles.darkBodyText : null]}>{subtitle}</Text>
      <View style={{ marginTop: 16, gap: 12 }}>{children}</View>
    </View>
  );
}

function Metric({ value, label, inverse = false }: { value: string; label: string; inverse?: boolean }) {
  return (
    <View style={[styles.metricCard, inverse ? styles.metricCardInverse : null]}>
      <Text style={[styles.metricValue, inverse ? styles.metricValueInverse : null]}>{value}</Text>
      <Text style={[styles.metricLabel, inverse ? styles.metricLabelInverse : null]}>{label}</Text>
    </View>
  );
}

function AuthStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.authStat}>
      <Text style={styles.authStatValue}>{value}</Text>
      <Text style={styles.authStatLabel}>{label}</Text>
    </View>
  );
}

function MessageBanner({ text, tone }: { text: string; tone: "neutral" | "warning" }) {
  return (
    <View style={[styles.messageBanner, tone === "warning" ? styles.messageBannerWarning : null]}>
      <Text style={[styles.messageBannerText, tone === "warning" ? styles.messageBannerTextWarning : null]}>{text}</Text>
    </View>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.bodyText}>{body}</Text>
    </View>
  );
}

function InfoTile({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <View style={[styles.infoTile, compact ? styles.infoTileCompact : null]}>
      <Text style={styles.infoTileLabel}>{label}</Text>
      <Text style={[styles.infoTileValue, compact ? styles.infoTileValueCompact : null]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function SampleMapPreview() {
  return (
    <View style={styles.sampleMap}>
      <View style={styles.sampleMapGrid} />
      <View style={styles.sampleMapMarker} />
      <View style={styles.sampleMapBadge}>
        <Text style={styles.sampleMapBadgeText}>Queue</Text>
      </View>
    </View>
  );
}

function MiniMap({ dark = false }: { dark?: boolean }) {
  return (
    <View style={[styles.mapBox, dark ? styles.mapBoxDark : null]}>
      <View style={styles.mapDotStart} />
      <View style={[styles.mapRoute, dark ? styles.mapRouteDark : null]} />
      <View style={styles.mapDotEnd} />
      <Text style={[styles.mapText, dark ? styles.mapTextDark : null]}>
        Live navigation and location sharing are available only during the active trip window.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f4f6fb"
  },
  authWrap: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingTop: 32,
    paddingBottom: 32,
    gap: 14
  },
  authHero: {
    borderRadius: 34,
    backgroundColor: brand.ink,
    padding: 20,
    shadowColor: "#0F172A",
    shadowOpacity: 0.16,
    shadowOffset: { width: 0, height: 18 },
    shadowRadius: 28,
    gap: 10
  },
  authHeroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14
  },
  authHeroContent: {
    flex: 1,
    gap: 8
  },
  authHeroContentRight: {
    alignItems: "flex-end"
  },
  authCard: {
    borderRadius: 30,
    padding: 20,
    backgroundColor: "#FFFFFF",
    shadowColor: "#0F172A",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 16 },
    shadowRadius: 24,
    gap: 12
  },
  logo: {
    width: 94,
    height: 94,
    borderRadius: 24
  },
  logoLight: {
    backgroundColor: "#FFFFFF"
  },
  logoDark: {
    backgroundColor: "#0F172A"
  },
  screenHero: {
    borderRadius: 30,
    backgroundColor: "#FFFFFF",
    padding: 18,
    gap: 12,
    shadowColor: "#0F172A",
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 20
  },
  topBrandBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    gap: 12
  },
  topBrandInner: {
    alignItems: "center",
    gap: 6,
    flex: 1
  },
  topBrandLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2.2,
    textTransform: "uppercase",
    color: "#64748B"
  },
  screenHeroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10
  },
  screenGreeting: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: "700",
    color: brand.ink
  },
  screenSummary: {
    fontSize: 14,
    lineHeight: 21,
    color: "#5B677B"
  },
  nextActionButton: {
    borderRadius: 24,
    backgroundColor: "#0F172A",
    padding: 16,
    gap: 6
  },
  nextActionEyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: "#93C5FD"
  },
  nextActionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#FFFFFF"
  },
  nextActionText: {
    fontSize: 13,
    lineHeight: 20,
    color: "rgba(229,231,235,0.82)"
  },
  homeScreen: {
    gap: 0
  },
  sampleShell: {
    borderRadius: 34,
    backgroundColor: "#070B15",
    padding: 20,
    gap: 12,
    shadowColor: "#0F172A",
    shadowOpacity: 0.22,
    shadowOffset: { width: 0, height: 20 },
    shadowRadius: 28
  },
  sampleHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12
  },
  sampleBrand: {
    alignItems: "center",
    gap: 4
  },
  sampleBrandText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2.2,
    textTransform: "uppercase",
    color: "rgba(229,231,235,0.74)"
  },
  sampleStatusBadge: {
    paddingHorizontal: 14
  },
  sampleMap: {
    height: 224,
    borderRadius: 24,
    backgroundColor: "#EAF0F7",
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center"
  },
  sampleMapGrid: {
    position: "absolute",
    inset: 0,
    borderRadius: 24,
    backgroundColor: "#EAF0F7"
  },
  sampleMapMarker: {
    width: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: "#14B8A6",
    borderWidth: 4,
    borderColor: "rgba(20,184,166,0.18)"
  },
  sampleMapBadge: {
    position: "absolute",
    top: 18,
    right: 18,
    borderRadius: 999,
    backgroundColor: "#0F172A",
    paddingHorizontal: 12,
    paddingVertical: 6
  },
  sampleMapBadgeText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700"
  },
  stepInputCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 22,
    backgroundColor: "#101826",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 15,
    paddingVertical: 13
  },
  stepInputIcon: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: "rgba(59,130,246,0.18)",
    alignItems: "center",
    justifyContent: "center"
  },
  stepInputIconText: {
    color: "#93C5FD",
    fontSize: 13,
    fontWeight: "700"
  },
  stepInputTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFFFFF"
  },
  stepInputFieldText: {
    marginTop: 2,
    color: "#E2E8F0",
    fontSize: 12
  },
  stepInputPin: {
    width: 14,
    height: 14,
    borderRadius: 999,
    backgroundColor: "#14B8A6"
  },
  samplePrimaryButton: {
    borderRadius: 18,
    backgroundColor: "#2563EB",
    alignItems: "center",
    paddingVertical: 16
  },
  samplePrimaryButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.8
  },
  sampleSecondaryButton: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    paddingVertical: 15
  },
  sampleSecondaryButtonText: {
    color: "#E2E8F0",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.8
  },
  homeFooter: {
    marginTop: 4,
    gap: 8
  },
  homeShortcut: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 3
  },
  homeShortcutLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: brand.accent
  },
  homeShortcutValue: {
    fontSize: 13,
    lineHeight: 18,
    color: brand.ink
  },
  homeShortcutShell: {
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#101826"
  },
  homeShortcutValueShell: {
    color: "#E2E8F0"
  },
  homeNavRow: {
    flexDirection: "row",
    gap: 8
  },
  homeNavButton: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 10,
    alignItems: "center"
  },
  homeNavButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: brand.ink
  },
  homeNavButtonShell: {
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "transparent"
  },
  homeNavButtonTextShell: {
    color: "#E2E8F0"
  },
  tabRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  tabChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#D8E0EF",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  tabChipActive: {
    borderColor: "#C7D2FE",
    backgroundColor: "#EEF2FF"
  },
  tabChipText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#475569"
  },
  tabChipTextActive: {
    color: brand.accentDeep
  },
  heroBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  heroBadgeRight: {
    alignSelf: "flex-end"
  },
  heroBadgeText: {
    color: "#E5E7EB",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase"
  },
  authTitle: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "700",
    color: "#FFFFFF"
  },
  authTitleCompact: {
    fontSize: 20,
    lineHeight: 24
  },
  authTitleRight: {
    textAlign: "right"
  },
  authText: {
    fontSize: 14,
    lineHeight: 21,
    color: "rgba(229,231,235,0.84)"
  },
  authMetricRow: {
    flexDirection: "row",
    gap: 8
  },
  cardEyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: brand.accent
  },
  cardEyebrowDark: {
    color: "#C7D2FE"
  },
  authCardTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "700",
    color: brand.ink
  },
  cardSubtitle: {
    fontSize: 13,
    lineHeight: 20,
    color: "#5B677B"
  },
  authFieldGroup: {
    gap: 8
  },
  authFieldHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  authFieldLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#334155"
  },
  authHelperText: {
    fontSize: 12,
    fontWeight: "600",
    color: brand.accent
  },
  authInput: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: brand.ink
  },
  demoBox: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F8FAFC",
    padding: 14
  },
  demoLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: "#64748B"
  },
  demoValue: {
    marginTop: 5,
    fontSize: 15,
    fontWeight: "600",
    color: brand.ink
  },
  demoValueCompact: {
    marginTop: 3,
    fontSize: 13
  },
  secondaryAction: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#DCDDFF",
    backgroundColor: "#EEF0FF",
    paddingVertical: 13
  },
  secondaryActionText: {
    color: brand.accentDeep,
    fontSize: 14,
    fontWeight: "700"
  },
  authStat: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  authStatValue: {
    fontSize: 17,
    fontWeight: "700",
    color: "#FFFFFF"
  },
  authStatLabel: {
    marginTop: 2,
    fontSize: 11,
    color: "rgba(229,231,235,0.78)"
  },
  headerShell: {
    paddingHorizontal: 20,
    paddingTop: 52,
    gap: 10
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  menuButton: {
    width: 46,
    height: 46,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#D7DBE6",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    gap: 4
  },
  menuLine: {
    width: 18,
    height: 2,
    borderRadius: 999,
    backgroundColor: brand.ink
  },
  menuPanel: {
    borderRadius: 24,
    backgroundColor: "#FFFFFF",
    padding: 12,
    shadowColor: "#0F172A",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 14 },
    shadowRadius: 20,
    gap: 8
  },
  menuItem: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 13
  },
  menuItemActive: {
    backgroundColor: "#EEF0FF"
  },
  menuItemText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#475569"
  },
  menuItemTextActive: {
    color: brand.accentDeep
  },
  menuRefresh: {
    marginTop: 4,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#DCDDFF",
    backgroundColor: "#EEF0FF",
    paddingVertical: 12,
    alignItems: "center"
  },
  menuRefreshText: {
    color: brand.accentDeep,
    fontSize: 14,
    fontWeight: "700"
  },
  menuLogout: {
    marginTop: 2,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#F2C3CF",
    backgroundColor: "#FFF5F7",
    paddingVertical: 12,
    alignItems: "center"
  },
  menuLogoutText: {
    color: "#BE123C",
    fontSize: 14,
    fontWeight: "700"
  },
  heroCard: {
    borderRadius: 32,
    backgroundColor: brand.ink,
    padding: 16,
    gap: 8
  },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10
  },
  surfaceBadge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  surfaceBadgeText: {
    color: "#E5E7EB",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase"
  },
  heroTitle: {
    fontSize: 21,
    lineHeight: 26,
    fontWeight: "500",
    color: "#FFFFFF"
  },
  heroTitleAccent: {
    fontWeight: "700",
    color: "#FFFFFF"
  },
  heroText: {
    fontSize: 13,
    lineHeight: 19,
    color: "rgba(229,231,235,0.82)"
  },
  metricRow: {
    flexDirection: "row",
    gap: 8
  },
  body: {
    flex: 1
  },
  bodyContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 32,
    gap: 12
  },
  bodyContentTop: {
    paddingTop: 12
  },
  metricCard: {
    flex: 1,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  metricCardInverse: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)"
  },
  metricValue: {
    fontSize: 18,
    fontWeight: "700",
    color: brand.ink
  },
  metricValueInverse: {
    color: "#FFFFFF"
  },
  metricLabel: {
    marginTop: 3,
    fontSize: 11,
    color: "#64748B"
  },
  metricLabelInverse: {
    color: "rgba(229,231,235,0.78)"
  },
  messageBanner: {
    borderRadius: 20,
    backgroundColor: "#EEF0FF",
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  messageBannerWarning: {
    backgroundColor: "#FFF7ED"
  },
  messageBannerText: {
    color: "#4338CA",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600"
  },
  messageBannerTextWarning: {
    color: "#B45309"
  },
  card: {
    borderRadius: 28,
    backgroundColor: "#ffffff",
    padding: 20,
    shadowColor: "#142765",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 18 },
    shadowRadius: 28
  },
  cardDark: {
    backgroundColor: "#101A33"
  },
  cardIndigo: {
    backgroundColor: "#4338CA"
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: brand.ink
  },
  sectionTitleDark: {
    color: "#FFFFFF"
  },
  bodyText: {
    fontSize: 14,
    lineHeight: 22,
    color: "#5b6b82"
  },
  darkBodyText: {
    fontSize: 14,
    lineHeight: 22,
    color: "rgba(229,231,235,0.82)"
  },
  valueText: {
    fontSize: 24,
    fontWeight: "700",
    color: brand.ink
  },
  darkValueText: {
    fontSize: 24,
    fontWeight: "700",
    color: "#FFFFFF"
  },
  availabilityRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  locationStatusBox: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#F8FAFC",
    padding: 14,
    gap: 6
  },
  locationStatusTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: brand.ink
  },
  locationDetails: {
    flexDirection: "row",
    gap: 10
  },
  locationStreamingRow: {
    gap: 8
  },
  locationStreamingBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  locationStreamingBadgeLive: {
    backgroundColor: "#ECFDF3",
    borderWidth: 1,
    borderColor: "#BBF7D0"
  },
  locationStreamingBadgePaused: {
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FED7AA"
  },
  locationStreamingBadgeIdle: {
    backgroundColor: "#EEF0FF",
    borderWidth: 1,
    borderColor: "#DCDDFF"
  },
  locationStreamingDot: {
    width: 9,
    height: 9,
    borderRadius: 999
  },
  locationStreamingDotLive: {
    backgroundColor: "#16A34A"
  },
  locationStreamingDotPaused: {
    backgroundColor: "#EA580C"
  },
  locationStreamingDotIdle: {
    backgroundColor: "#4F46E5"
  },
  locationStreamingText: {
    fontSize: 12,
    fontWeight: "700"
  },
  locationStreamingTextLive: {
    color: "#166534"
  },
  locationStreamingTextPaused: {
    color: "#C2410C"
  },
  locationStreamingTextIdle: {
    color: "#4338CA"
  },
  locationStreamingMeta: {
    fontSize: 12,
    color: "#64748B"
  },
  buttonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  primaryButtonFlex: {
    flex: 1
  },
  primaryButton: {
    borderRadius: 18,
    backgroundColor: brand.accent,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "700"
  },
  secondaryButton: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#cfe0ff",
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  secondaryButtonText: {
    color: brand.accent,
    fontWeight: "700"
  },
  destructiveButton: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#F3D0D8",
    backgroundColor: "#FFF5F7",
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  destructiveButtonText: {
    color: "#BE123C",
    fontWeight: "700"
  },
  tripRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14
  },
  tripTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: brand.ink
  },
  tripMeta: {
    marginTop: 4,
    fontSize: 13,
    color: "#64748b"
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  requestCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#FAFBFD",
    padding: 16,
    gap: 10
  },
  requestTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10
  },
  requestServiceBadge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#D8DDF8",
    backgroundColor: "#EEF0FF",
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  requestServiceBadgeText: {
    color: brand.accentDeep,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase"
  },
  requestEstimateBadge: {
    borderRadius: 999,
    backgroundColor: "#0F172A",
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  requestEstimateBadgeText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700"
  },
  requestSummaryRow: {
    flexDirection: "row",
    gap: 10
  },
  requestFooter: {
    borderRadius: 20,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 14
  },
  requestFooterText: {
    fontSize: 13,
    lineHeight: 20,
    color: "#475569"
  },
  assignmentCard: {
    gap: 8
  },
  assignmentTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: brand.ink
  },
  assignmentMetrics: {
    flexDirection: "row",
    gap: 10
  },
  infoTile: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#F8FAFC",
    padding: 14
  },
  infoTileCompact: {
    paddingVertical: 12
  },
  infoTileLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.3,
    textTransform: "uppercase",
    color: "#64748B"
  },
  infoTileValue: {
    marginTop: 6,
    fontSize: 16,
    fontWeight: "700",
    color: brand.ink
  },
  infoTileValueCompact: {
    fontSize: 14
  },
  emptyState: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#F8FAFC",
    padding: 18,
    gap: 6
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: brand.ink
  },
  mapBox: {
    marginTop: 6,
    borderRadius: 22,
    backgroundColor: "#eff5ff",
    padding: 18,
    gap: 10
  },
  mapBoxDark: {
    backgroundColor: "#0F172A",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)"
  },
  mapDotStart: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#4f46e5"
  },
  mapRoute: {
    height: 6,
    borderRadius: 99,
    backgroundColor: "#4f46e5"
  },
  mapRouteDark: {
    backgroundColor: "#4f46e5"
  },
  mapDotEnd: {
    alignSelf: "flex-end",
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#10b981"
  },
  mapText: {
    fontSize: 13,
    lineHeight: 20,
    color: "#475569"
  },
  mapTextDark: {
    color: "rgba(229,231,235,0.82)"
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.2
  }
});
