import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import * as Location from "expo-location";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { appConfig, toCurrency } from "@driveme/config";
import { bookingStatusTone, brand, formatDateTime } from "@driveme/ui";
import {
  cancelBooking,
  createBooking,
  fetchBookingEstimate,
  fetchBookings,
  fetchMapState,
  fetchNotifications,
  fetchProfile,
  login,
  submitRating
} from "./src/lib/api";

type Tab = "home" | "trips" | "notifications" | "profile";
type BookingStep = "service" | "details" | "review";

const bookingSteps: Array<{ key: BookingStep; label: string; caption: string }> = [
  { key: "service", label: "1", caption: "Service" },
  { key: "details", label: "2", caption: "Trip" },
  { key: "review", label: "3", caption: "Review" }
];

const tabs: Array<{ key: Tab; label: string }> = [
  { key: "home", label: "Home" },
  { key: "trips", label: "Trips" },
  { key: "profile", label: "Account" }
];

const serviceOptions = [
  {
    key: "night-out",
    label: "Night out",
    title: "Drink & Dial",
    description: "Keep your vehicle with you while a professional driver gets you home safely.",
    notes: "Night out / Drink & Dial service requested."
  },
  {
    key: "appointments",
    label: "Appointments",
    title: "Medical & therapy",
    description: "Senior-friendly and assisted driving for medical visits, therapy sessions, and check-ins.",
    notes: "Senior-friendly assisted service for appointments and support."
  },
  {
    key: "events",
    label: "Events",
    title: "Events & family plans",
    description: "A scheduled driver for dinners, weddings, sporting events, and evening commitments.",
    notes: "Event service requested with scheduled arrival."
  },
  {
    key: "shopping",
    label: "Shopping",
    title: "Errands & shopping days",
    description: "Multiple stops in your own vehicle without the parking stress or back-and-forth logistics.",
    notes: "Shopping and errand support with multiple planned stops."
  },
  {
    key: "business",
    label: "Business",
    title: "Busy schedules",
    description: "Reclaim your time on meeting days, school runs, and packed personal schedules.",
    notes: "Business schedule support with time-sensitive arrival."
  },
  {
    key: "long-distance",
    label: "Distance",
    title: "Long-distance driving",
    description: "Professional coverage for longer drives, family visits, and inter-city travel in your own car.",
    notes: "Long-distance personal driver service requested."
  }
] as const;

const logoLight = require("./assets/dm-logo-light.png");
const logoDark = require("./assets/dm-logo-dark.png");

function getDefaultSchedule() {
  const date = new Date(Date.now() + 90 * 60 * 1000);

  return {
    date: date.toISOString().slice(0, 10),
    time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
  };
}

function toScheduledIso(scheduledDate: string, scheduledTime: string) {
  if (!scheduledDate || !scheduledTime) {
    return "";
  }

  const composed = new Date(`${scheduledDate}T${scheduledTime}:00`);
  return Number.isNaN(composed.getTime()) ? "" : composed.toISOString();
}

function formatBookingDateLabel(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? "Select date"
    : parsed.toLocaleDateString("en-CA", {
        weekday: "short",
        month: "short",
        day: "numeric"
      });
}

function formatBookingTimeLabel(value: string) {
  if (!value) {
    return "Select time";
  }

  const parsed = new Date(`2026-01-01T${value}:00`);
  return Number.isNaN(parsed.getTime())
    ? "Select time"
    : parsed.toLocaleTimeString("en-CA", {
        hour: "numeric",
        minute: "2-digit"
      });
}

function formatServiceLabel(serviceKey: string) {
  return serviceOptions.find((option) => option.key === serviceKey)?.title ?? "Personal driver";
}

function composeCustomerNotes(serviceKey: string, specialNotes: string) {
  const serviceNotes = serviceOptions.find((option) => option.key === serviceKey)?.notes;
  return [serviceNotes, specialNotes.trim()].filter(Boolean).join(" ");
}

function canCancelBooking(booking: any) {
  const status = String(booking.status).toLowerCase();
  return ["pending", "accepted"].includes(status);
}

export default function App() {
  const insets = useSafeAreaInsets();
  const defaultSchedule = getDefaultSchedule();
  const [tab, setTab] = useState<Tab>("home");
  const [bookingStep, setBookingStep] = useState<BookingStep>("service");
  const [session, setSession] = useState<any>(null);
  const [bookings, setBookings] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [mapState, setMapState] = useState<any>(null);
  const [estimate, setEstimate] = useState<any>(null);
  const [latestSubmission, setLatestSubmission] = useState<any>(null);
  const [status, setStatus] = useState("");
  const [loginEmail, setLoginEmail] = useState("owner@driveme.app");
  const [loginPassword, setLoginPassword] = useState("OwnerPass123$");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [locationPending, setLocationPending] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [form, setForm] = useState({
    serviceKey: "night-out",
    pickupLocation: "201 Portage Ave, Winnipeg",
    pickupLat: "49.8959",
    pickupLng: "-97.1385",
    destinationLocation: "The Forks, Winnipeg",
    destinationLat: "49.8870",
    destinationLng: "-97.1318",
    scheduledDate: defaultSchedule.date,
    scheduledTime: defaultSchedule.time,
    expectedDurationMinutes: "75",
    specialNotes: "Need driver to wait during dinner stop",
    vehicleDetails: "Toyota Camry - midnight blue",
    zoneCode: "WPG-CENTRAL"
  });
  const [ratingComment, setRatingComment] = useState("Smooth ride and great communication.");

  useEffect(() => {
    if (!session?.accessToken) {
      return;
    }

    refresh();
  }, [session]);

  useEffect(() => {
    if (!session?.accessToken) {
      return;
    }

    const scheduledStartAt = toScheduledIso(form.scheduledDate, form.scheduledTime);
    if (!scheduledStartAt || !form.expectedDurationMinutes || Number(form.expectedDurationMinutes) < 15) {
      setEstimate(null);
      return;
    }

    fetchBookingEstimate(session.accessToken, {
      scheduledStartAt,
      expectedDurationMinutes: Number(form.expectedDurationMinutes),
      zoneCode: form.zoneCode
    })
      .then(setEstimate)
      .catch(() => {
        setEstimate(null);
      });
  }, [form.expectedDurationMinutes, form.scheduledDate, form.scheduledTime, form.zoneCode, session]);

  async function refresh() {
    if (!session?.accessToken) {
      return;
    }

    const [bookingList, notificationList, me] = await Promise.all([
      fetchBookings(session.accessToken),
      fetchNotifications(session.accessToken),
      fetchProfile(session.accessToken)
    ]);

    setBookings(bookingList);
    setNotifications(notificationList);
    setProfile(me);

    const activeBooking = bookingList.find((booking) => ["accepted", "active", "enroute"].includes(String(booking.status).toLowerCase()));
    if (activeBooking) {
      const nextMapState = await fetchMapState(session.accessToken, activeBooking.id);
      setMapState(nextMapState);
    } else {
      setMapState(null);
    }
  }

  function handleLogout() {
    setTab("home");
    setBookingStep("service");
    setSession(null);
    setBookings([]);
    setNotifications([]);
    setProfile(null);
    setMapState(null);
    setEstimate(null);
    setLatestSubmission(null);
    setStatus("");
  }

  function handleDateChange(_event: DateTimePickerEvent, selectedDate?: Date) {
    setShowDatePicker(false);
    if (!selectedDate) {
      return;
    }

    setForm((current) => ({
      ...current,
      scheduledDate: selectedDate.toISOString().slice(0, 10)
    }));
  }

  function handleTimeChange(_event: DateTimePickerEvent, selectedTime?: Date) {
    setShowTimePicker(false);
    if (!selectedTime) {
      return;
    }

    setForm((current) => ({
      ...current,
      scheduledTime: `${String(selectedTime.getHours()).padStart(2, "0")}:${String(selectedTime.getMinutes()).padStart(2, "0")}`
    }));
  }

  async function useCurrentPickup() {
    try {
      setLocationPending(true);
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setStatus("Location access is required to confirm pickup from your current position.");
        return;
      }

      const current =
        (await Location.getLastKnownPositionAsync()) ??
        (await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced
        }));

      if (!current) {
        setStatus("We could not read your location yet. Try again in a few seconds.");
        return;
      }

      setForm((existing) => ({
        ...existing,
        pickupLocation: "Current location",
        pickupLat: String(current.coords.latitude),
        pickupLng: String(current.coords.longitude)
      }));
      setStatus("Pickup updated to your current location.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to use your current location.");
    } finally {
      setLocationPending(false);
    }
  }

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
                  <Text style={styles.heroBadgeText}>Owner access</Text>
                </View>
                <Text
                  style={[styles.authTitle, styles.authTitleCompact, styles.authTitleRight]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                >
                  App for customers.
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.authCard}>
            <Text style={styles.cardEyebrow}>Secure sign in</Text>
            <Text style={styles.authCardTitle}>Welcome back</Text>
            <Text style={styles.cardSubtitle}>
              Sign in to manage driver bookings, view trip activity, and keep your travel plans organized in one place.
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
                <Text style={styles.authHelperText}>Forgot password</Text>
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
                  setStatus(error instanceof Error ? error.message : "Login failed");
                }
              }}
            >
              <Text style={styles.primaryButtonText}>Sign in</Text>
            </Pressable>

            <Pressable
              style={styles.secondaryAction}
              onPress={() => {
                setLoginEmail("owner@driveme.app");
                setLoginPassword("OwnerPass123$");
                setStatus("Demo credentials loaded.");
              }}
            >
              <Text style={styles.secondaryActionText}>Use demo account</Text>
            </Pressable>

            <View style={styles.demoBox}>
              <Text style={styles.demoLabel}>Demo access</Text>
              <Text style={styles.demoValue}>owner@driveme.app</Text>
              <Text style={[styles.demoValue, styles.demoValueCompact]}>OwnerPass123$</Text>
            </View>

            {status ? <MessageBanner text={status} tone="warning" /> : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const activeBooking = bookings.find((booking) => ["accepted", "active", "enroute"].includes(String(booking.status).toLowerCase()));
  const completedTrips = bookings.filter((booking) => String(booking.status).toLowerCase() === "completed");

  return (
    <SafeAreaView style={styles.safeArea} edges={["left", "right", "bottom"]}>
      <StatusBar style="dark" />
      <ScrollView
        style={styles.body}
        contentContainerStyle={[styles.bodyContent, styles.bodyContentTop, { paddingTop: Math.max(insets.top + 6, 18) }]}
      >
        {status ? <MessageBanner text={status} tone="neutral" /> : null}

        {tab === "home" ? (
          <View style={styles.homeScreen}>
            <View style={styles.sampleShell}>
              <View style={styles.sampleBrand}>
                <BrandLogo dark size={74} />
                <Text style={styles.sampleBrandText}>DriveMe Canada</Text>
              </View>
              <SampleMapPreview />

              <StepInputCard
                step="1"
                title="Confirm Pickup"
                value={form.pickupLocation}
                placeholder="Choose pickup point"
                onChangeText={(value) => setForm((current) => ({ ...current, pickupLocation: value }))}
                actionLabel={locationPending ? "Locating..." : "Use current"}
                onActionPress={useCurrentPickup}
                disabled={locationPending}
              />

              <StepInputCard
                step="2"
                title="Request Ride"
                value={form.destinationLocation}
                placeholder="Anywhere to anywhere"
                onChangeText={(value) => setForm((current) => ({ ...current, destinationLocation: value }))}
              />

              <Pressable
                style={styles.samplePrimaryButton}
                onPress={async () => {
                  const scheduledStartAt = new Date(Date.now() + appConfig.tripActivationMinutesBeforeStart * 60_000).toISOString();
                  setScheduleMode("now");
                  try {
                    const result = await createBooking(session.accessToken, {
                      pickupLocation: form.pickupLocation,
                      pickupLat: Number(form.pickupLat),
                      pickupLng: Number(form.pickupLng),
                      destinationLocation: form.destinationLocation,
                      destinationLat: Number(form.destinationLat),
                      destinationLng: Number(form.destinationLng),
                      scheduledStartAt,
                      expectedDurationMinutes: Number(form.expectedDurationMinutes),
                      specialNotes: composeCustomerNotes(form.serviceKey, form.specialNotes),
                      vehicleDetails: form.vehicleDetails,
                      zoneCode: form.zoneCode
                    });
                    setLatestSubmission(result.booking);
                    setStatus("DriveMe now request sent.");
                    setTab("trips");
                    await refresh();
                  } catch (error) {
                    setStatus(error instanceof Error ? error.message : "Unable to request ride");
                  }
                }}
              >
                <Text style={styles.samplePrimaryButtonText}>DRIVEME NOW</Text>
              </Pressable>

              <Pressable style={styles.sampleSecondaryButton} onPress={() => setScheduleMode("later")}>
                <Text style={styles.sampleSecondaryButtonText}>SCHEDULE A DRIVE</Text>
              </Pressable>

              {scheduleMode === "later" ? (
                <View style={styles.scheduleSheet}>
                  <View style={styles.row}>
                    <PickerField label="Trip date" value={formatBookingDateLabel(form.scheduledDate)} onPress={() => setShowDatePicker(true)} />
                    <PickerField label="Trip time" value={formatBookingTimeLabel(form.scheduledTime)} onPress={() => setShowTimePicker(true)} />
                  </View>
                  <Pressable
                    style={styles.samplePrimaryButton}
                    onPress={async () => {
                      const scheduledStartAt = toScheduledIso(form.scheduledDate, form.scheduledTime);
                      if (!scheduledStartAt) {
                        setStatus("Choose a valid date and time.");
                        return;
                      }

                      try {
                        const result = await createBooking(session.accessToken, {
                          pickupLocation: form.pickupLocation,
                          pickupLat: Number(form.pickupLat),
                          pickupLng: Number(form.pickupLng),
                          destinationLocation: form.destinationLocation,
                          destinationLat: Number(form.destinationLat),
                          destinationLng: Number(form.destinationLng),
                          scheduledStartAt,
                          expectedDurationMinutes: Number(form.expectedDurationMinutes),
                          specialNotes: composeCustomerNotes(form.serviceKey, form.specialNotes),
                          vehicleDetails: form.vehicleDetails,
                          zoneCode: form.zoneCode
                        });
                        setLatestSubmission(result.booking);
                        setStatus("Scheduled drive request sent.");
                        setTab("trips");
                        await refresh();
                      } catch (error) {
                        setStatus(error instanceof Error ? error.message : "Unable to schedule drive");
                      }
                    }}
                  >
                    <Text style={styles.samplePrimaryButtonText}>CONFIRM SCHEDULE</Text>
                  </Pressable>
                </View>
              ) : null}

              {activeBooking ? (
                <Pressable style={[styles.homeShortcut, styles.homeShortcutShell]} onPress={() => setTab("trips")}>
                  <Text style={styles.homeShortcutLabel}>CURRENT TRIP</Text>
                  <Text style={[styles.homeShortcutValue, styles.homeShortcutValueShell]}>
                    {activeBooking.assignedDriver?.user?.fullName ? `Driver: ${activeBooking.assignedDriver.user.fullName}` : "View trip status"}
                  </Text>
                </Pressable>
              ) : null}

              <View style={[styles.homeNavRow, styles.homeFooter]}>
                <Pressable style={[styles.homeNavButton, styles.homeNavButtonShell]} onPress={() => setTab("trips")}>
                  <Text style={[styles.homeNavButtonText, styles.homeNavButtonTextShell]}>Trips</Text>
                </Pressable>
                <Pressable style={[styles.homeNavButton, styles.homeNavButtonShell]} onPress={() => setTab("profile")}>
                  <Text style={[styles.homeNavButtonText, styles.homeNavButtonTextShell]}>Account</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}

        {tab !== "home" ? (
          <View style={styles.tabRow}>
            {tabs.filter((item) => item.key !== "home").map((item) => {
              const active = tab === item.key;

              return (
                <Pressable key={item.key} style={[styles.tabChip, active ? styles.tabChipActive : null]} onPress={() => setTab(item.key)}>
                  <Text style={[styles.tabChipText, active ? styles.tabChipTextActive : null]}>{item.label}</Text>
                </Pressable>
              );
            })}
            <Pressable style={styles.tabChip} onPress={() => setTab("home")}>
              <Text style={styles.tabChipText}>Back home</Text>
            </Pressable>
          </View>
        ) : null}

        {tab === "trips" ? (
          <Card eyebrow="Bookings" title="Trip history and live status" subtitle="Track pending, accepted, active, completed, and cancelled requests in one timeline.">
            {bookings.length ? (
              bookings.map((booking) => (
                <TripItem
                  key={booking.id}
                  booking={booking}
                  onCancel={
                    canCancelBooking(booking)
                      ? async () => {
                          try {
                            setStatus("Cancelling booking...");
                            await cancelBooking(session.accessToken, booking.id);
                            setStatus("Booking cancelled.");
                            await refresh();
                          } catch (error) {
                            setStatus(error instanceof Error ? error.message : "Unable to cancel booking");
                          }
                        }
                      : undefined
                  }
                />
              ))
            ) : (
              <EmptyState title="No bookings yet" body="Once you submit a request, your trip timeline will appear here." />
            )}

            {completedTrips.slice(0, 1).map((booking) => (
              <View key={`${booking.id}-rating`} style={styles.ratingBox}>
                <Text style={styles.innerCardEyebrow}>Post-trip review</Text>
                <Text style={styles.ratingTitle}>Rate your completed trip</Text>
                <Field label="Review" value={ratingComment} onChangeText={setRatingComment} multiline />
                <Pressable
                  style={styles.secondaryButton}
                  onPress={async () => {
                    try {
                      await submitRating(session.accessToken, booking.id, 5, ratingComment);
                      setStatus("Rating submitted.");
                    } catch (error) {
                      setStatus(error instanceof Error ? error.message : "Unable to submit rating");
                    }
                  }}
                >
                  <Text style={styles.secondaryButtonText}>Send 5-star review</Text>
                </Pressable>
              </View>
            ))}
          </Card>
        ) : null}

        {tab === "profile" ? (
          <Card eyebrow="Account" title="Owner profile" subtitle="Manage your saved identity, vehicle details, and common pickup information.">
            <View style={styles.profileCard}>
              <Text style={styles.profileName}>{profile?.fullName ?? session.user.fullName}</Text>
              <Text style={styles.profileMeta}>{profile?.email ?? session.user.email}</Text>
            </View>
            <View style={styles.profileGrid}>
              <InfoTile label="Vehicles" value={String(profile?.customerProfile?.vehicles?.length ?? 0)} />
              <InfoTile label="Saved addresses" value={String(profile?.customerProfile?.savedAddresses?.length ?? 0)} />
            </View>
            <View style={styles.inlineInfo}>
              <Text style={styles.inlineInfoLabel}>Saved locations</Text>
              <Text style={styles.inlineInfoValue}>{profile?.customerProfile?.savedAddresses?.join(", ") ?? "No saved addresses yet."}</Text>
            </View>
            <View style={styles.actionRow}>
              <Pressable style={styles.secondaryButton} onPress={refresh}>
                <Text style={styles.secondaryButtonText}>Refresh app</Text>
              </Pressable>
              <Pressable style={[styles.destructiveButton, styles.primaryButtonSplit]} onPress={handleLogout}>
                <Text style={styles.destructiveButtonText}>Log out</Text>
              </Pressable>
            </View>
          </Card>
        ) : null}

        {showDatePicker ? (
          <DateTimePicker
            value={new Date(`${form.scheduledDate}T12:00:00`)}
            mode="date"
            display="default"
            minimumDate={new Date()}
            onChange={handleDateChange}
          />
        ) : null}

        {showTimePicker ? (
          <DateTimePicker
            value={new Date(`2026-01-01T${form.scheduledTime}:00`)}
            mode="time"
            display="default"
            onChange={handleTimeChange}
          />
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
      <Text style={[styles.cardSubtitle, dark ? styles.cardSubtitleDark : null]}>{subtitle}</Text>
      <View style={styles.cardBody}>{children}</View>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  multiline = false,
  compact = false
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  compact?: boolean;
}) {
  return (
    <View style={[styles.fieldWrap, compact ? styles.fieldWrapCompact : null]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        style={[styles.input, multiline ? styles.inputMultiline : null]}
      />
    </View>
  );
}

function PickerField({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <View style={styles.fieldWrapCompact}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable style={styles.pickerField} onPress={onPress}>
        <Text style={styles.pickerFieldValue}>{value}</Text>
      </Pressable>
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

function StepInputCard({
  step,
  title,
  value,
  placeholder,
  onChangeText,
  actionLabel,
  onActionPress,
  disabled = false
}: {
  step: string;
  title: string;
  value: string;
  placeholder: string;
  onChangeText: (value: string) => void;
  actionLabel?: string;
  onActionPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.stepInputCard}>
      <View style={styles.stepInputIcon}>
        <Text style={styles.stepInputIconText}>{step}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.stepInputTitle}>{title}</Text>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="rgba(226,232,240,0.42)"
          style={styles.stepInputField}
        />
      </View>
      {actionLabel && onActionPress ? (
        <Pressable style={styles.stepInputAction} onPress={onActionPress} disabled={disabled}>
          <Text style={styles.stepInputActionText}>{actionLabel}</Text>
        </Pressable>
      ) : (
        <View style={styles.stepInputPin} />
      )}
    </View>
  );
}

function SampleMapPreview() {
  return (
    <View style={styles.sampleMap}>
      <View style={styles.sampleMapGrid} />
      <View style={styles.sampleMapMarker} />
      <View style={styles.sampleMapBadge}>
        <Text style={styles.sampleMapBadgeText}>Route</Text>
      </View>
    </View>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = bookingStatusTone(status.toLowerCase() as any);
  return (
    <View style={[styles.statusBadge, { backgroundColor: `${tone.color}26` }]}>
      <Text style={[styles.statusBadgeText, { color: tone.color }]}>{tone.text}</Text>
    </View>
  );
}

function TripItem({ booking, onCancel }: { booking: any; onCancel?: () => Promise<void> | void }) {
  const tone = bookingStatusTone(String(booking.status).toLowerCase() as any);
  const notes = String(booking.specialNotes ?? "").trim();

  return (
    <View style={styles.tripCard}>
      <View style={styles.tripCardTopRow}>
        <View style={styles.tripCardContent}>
          <Text style={styles.tripTitle}>
            {booking.pickupLocation} to {booking.destinationLocation}
          </Text>
          <Text style={styles.tripMeta}>{formatDateTime(booking.scheduledStartAt)}</Text>
          {booking.assignedDriver ? <Text style={styles.tripMeta}>Driver: {booking.assignedDriver.user.fullName}</Text> : null}
          {booking.vehicleDetails ? <Text style={styles.tripMeta}>Vehicle: {booking.vehicleDetails}</Text> : null}
          {notes ? <Text style={styles.tripMeta}>{notes}</Text> : null}
        </View>
        <View style={[styles.badge, { backgroundColor: `${tone.color}1A` }]}>
          <Text style={[styles.badgeText, { color: tone.color }]}>{tone.text}</Text>
        </View>
      </View>

      {onCancel ? (
        <Pressable style={styles.tripAction} onPress={onCancel}>
          <Text style={styles.tripActionText}>Cancel before trip start</Text>
        </Pressable>
      ) : null}
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

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoTile}>
      <Text style={styles.infoTileLabel}>{label}</Text>
      <Text style={styles.infoTileValue}>{value}</Text>
    </View>
  );
}

function MiniMap({ state }: { state: any }) {
  return (
    <View style={styles.mapBox}>
      <View style={styles.mapRow}>
        <View style={styles.mapDotStart} />
        <View style={styles.mapRoute} />
        <View style={styles.mapDotEnd} />
      </View>
      <Text style={styles.mapText}>
        {state.active ? "Driver live location is visible during the current trip window." : "Tracking remains disabled outside the scheduled window."}
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
  cardSubtitleDark: {
    color: "rgba(229,231,235,0.78)"
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
  demoLabelSpacing: {
    marginTop: 14
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
    paddingTop: 16,
    gap: 10
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
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
  stepInputField: {
    marginTop: 2,
    color: "#E2E8F0",
    fontSize: 12,
    paddingVertical: 0
  },
  stepInputAction: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(20,184,166,0.24)",
    backgroundColor: "rgba(20,184,166,0.12)",
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  stepInputActionText: {
    color: "#5EEAD4",
    fontSize: 11,
    fontWeight: "700"
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
  scheduleSheet: {
    borderRadius: 22,
    backgroundColor: "#101826",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    padding: 12,
    gap: 10
  },
  sampleEstimateText: {
    color: "#93C5FD",
    fontSize: 13,
    textAlign: "center"
  },
  homeScreen: {
    gap: 0
  },
  homeFooter: {
    marginTop: 4,
    gap: 8
  },
  homeShortcut: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#D8E0EF",
    backgroundColor: "#FFFFFF",
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
    borderColor: "#D8E0EF",
    backgroundColor: "#FFFFFF",
    paddingVertical: 10,
    alignItems: "center"
  },
  homeNavButtonText: {
    color: brand.ink,
    fontSize: 12,
    fontWeight: "700"
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
    fontSize: 23,
    lineHeight: 29,
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
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.2
  },
  body: {
    flex: 1
  },
  bodyContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 12
  },
  bodyContentTop: {
    paddingTop: 12
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
    borderRadius: 30,
    backgroundColor: "#FFFFFF",
    padding: 20,
    shadowColor: "#0F172A",
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
    marginTop: 6,
    fontSize: 25,
    lineHeight: 30,
    fontWeight: "700",
    color: brand.ink
  },
  sectionTitleDark: {
    color: "#FFFFFF"
  },
  cardBody: {
    marginTop: 18,
    gap: 14
  },
  stepRow: {
    flexDirection: "row",
    gap: 8
  },
  stepItem: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 10,
    paddingVertical: 12,
    alignItems: "center"
  },
  stepItemActive: {
    borderColor: "#C7D2FE",
    backgroundColor: "#EEF0FF"
  },
  stepValue: {
    fontSize: 16,
    fontWeight: "700",
    color: "#64748B"
  },
  stepValueActive: {
    color: brand.accentDeep
  },
  stepLabel: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: "#94A3B8"
  },
  stepLabelActive: {
    color: brand.accentDeep
  },
  bodyText: {
    fontSize: 14,
    lineHeight: 22,
    color: "#5B677B"
  },
  darkBodyText: {
    fontSize: 14,
    lineHeight: 22,
    color: "rgba(229,231,235,0.82)"
  },
  darkValueText: {
    fontSize: 24,
    fontWeight: "700",
    color: "#FFFFFF"
  },
  darkInfoCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.04)",
    padding: 14
  },
  darkInfoLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: "rgba(229,231,235,0.62)"
  },
  darkInfoValue: {
    marginTop: 6,
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF"
  },
  row: {
    flexDirection: "row",
    gap: 12
  },
  actionRow: {
    flexDirection: "row",
    gap: 10
  },
  fieldWrap: {
    gap: 8
  },
  fieldWrapCompact: {
    flex: 1
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.2,
    color: "#334155"
  },
  input: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: brand.ink
  },
  pickerField: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 14,
    paddingVertical: 13
  },
  pickerFieldValue: {
    color: brand.ink,
    fontSize: 15
  },
  inputMultiline: {
    minHeight: 100,
    textAlignVertical: "top"
  },
  inlineInfo: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F8FAFC",
    padding: 16,
    gap: 6
  },
  inlineInfoLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: "#64748B"
  },
  inlineInfoValue: {
    fontSize: 14,
    lineHeight: 21,
    color: brand.ink
  },
  inlineInfoCaption: {
    fontSize: 13,
    lineHeight: 20,
    color: "#64748B"
  },
  primaryButton: {
    borderRadius: 22,
    backgroundColor: brand.accent,
    paddingHorizontal: 18,
    paddingVertical: 15,
    alignItems: "center"
  },
  primaryButtonSplit: {
    flex: 1
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700"
  },
  secondaryButton: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#DCDDFF",
    backgroundColor: "#EEF0FF",
    paddingHorizontal: 16,
    paddingVertical: 13,
    alignItems: "center"
  },
  secondaryButtonText: {
    color: brand.accentDeep,
    fontSize: 14,
    fontWeight: "700"
  },
  destructiveButton: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#FBCFE8",
    backgroundColor: "#FFF1F2",
    paddingHorizontal: 16,
    paddingVertical: 13,
    alignItems: "center"
  },
  destructiveButtonText: {
    color: "#BE123C",
    fontSize: 14,
    fontWeight: "700"
  },
  selectionGrid: {
    gap: 10
  },
  selectionCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FAFBFD",
    padding: 16,
    gap: 6
  },
  selectionCardActive: {
    borderColor: "#C7D2FE",
    backgroundColor: "#EEF0FF"
  },
  selectionEyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: "#64748B"
  },
  selectionEyebrowActive: {
    color: brand.accentDeep
  },
  selectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: brand.ink
  },
  selectionTitleActive: {
    color: brand.accentDeep
  },
  selectionBody: {
    fontSize: 13,
    lineHeight: 20,
    color: "#64748B"
  },
  selectionBodyActive: {
    color: "#4C5A77"
  },
  summaryCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F8FAFC",
    padding: 16,
    gap: 6
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: "#64748B"
  },
  summaryValue: {
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "700",
    color: brand.ink
  },
  summaryMeta: {
    fontSize: 13,
    lineHeight: 20,
    color: "#64748B"
  },
  confirmationBox: {
    gap: 8
  },
  confirmationTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: brand.ink
  },
  confirmationMetrics: {
    flexDirection: "row",
    gap: 10
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
  tripCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FAFBFD",
    padding: 16,
    gap: 12
  },
  tripCardTopRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start"
  },
  tripCardContent: {
    flex: 1
  },
  tripTitle: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
    color: brand.ink
  },
  tripMeta: {
    marginTop: 4,
    fontSize: 13,
    color: "#64748B"
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.2
  },
  tripAction: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#F3D0D8",
    backgroundColor: "#FFF5F7",
    paddingVertical: 12,
    alignItems: "center"
  },
  tripActionText: {
    color: "#BE123C",
    fontSize: 13,
    fontWeight: "700"
  },
  ratingBox: {
    marginTop: 6,
    gap: 10,
    borderRadius: 24,
    backgroundColor: "#F8FAFC",
    padding: 16
  },
  innerCardEyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: brand.accent
  },
  ratingTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: brand.ink
  },
  notificationItem: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FAFBFD",
    padding: 16,
    gap: 6
  },
  notificationTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: brand.ink
  },
  profileCard: {
    borderRadius: 24,
    backgroundColor: brand.ink,
    padding: 18
  },
  profileName: {
    fontSize: 24,
    fontWeight: "700",
    color: "#FFFFFF"
  },
  profileMeta: {
    marginTop: 6,
    fontSize: 14,
    color: "rgba(229,231,235,0.78)"
  },
  profileGrid: {
    flexDirection: "row",
    gap: 12
  },
  infoTile: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F8FAFC",
    padding: 16
  },
  infoTileLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: "#64748B"
  },
  infoTileValue: {
    marginTop: 6,
    fontSize: 24,
    fontWeight: "700",
    color: brand.ink
  },
  emptyState: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#E5E7EB",
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
    borderRadius: 24,
    backgroundColor: "#0F172A",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: 16,
    gap: 12
  },
  mapRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  mapRoute: {
    flex: 1,
    height: 6,
    borderRadius: 99,
    backgroundColor: brand.accent
  },
  mapDotStart: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: brand.accent
  },
  mapDotEnd: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#10B981"
  },
  mapText: {
    fontSize: 13,
    lineHeight: 20,
    color: "rgba(229,231,235,0.82)"
  },
});
