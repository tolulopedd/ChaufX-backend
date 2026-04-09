import { AccountStatus, UserRole } from "@prisma/client";
import { defaultServiceZones } from "@driveme/config";
import { haversineDistanceKm } from "../src/modules/bookings/booking.service.js";
import { hashPassword } from "../src/lib/auth.js";
import { prisma } from "../src/lib/prisma.js";

async function main() {
  await prisma.emailVerificationToken.deleteMany();
  await prisma.location.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.rating.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.document.deleteMany();
  await prisma.driver.deleteMany();
  await prisma.driverApplication.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.customerProfile.deleteMany();
  await prisma.adminUser.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
  await prisma.serviceZone.deleteMany();
  await prisma.pricingSetting.deleteMany();

  const zones = await Promise.all(
    defaultServiceZones.map((zone) =>
      prisma.serviceZone.create({
        data: zone
      })
    )
  );

  await prisma.pricingSetting.createMany({
    data: [
      {
        code: "BASE_FEE",
        name: "Base booking fee",
        value: 18
      },
      {
        code: "PER_MINUTE",
        name: "Per minute rate",
        value: 0.85
      }
    ]
  });

  const admin = await prisma.user.create({
    data: {
      fullName: "DriveMe Admin",
      email: "admin@driveme.com",
      phone: "+12045550110",
      passwordHash: await hashPassword("NewPass123$"),
      role: UserRole.ADMIN,
      status: AccountStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      adminUser: {
        create: {
          title: "Platform Administrator",
          permissions: ["drivers.review", "bookings.manage", "reports.view"]
        }
      }
    }
  });

  const customer = await prisma.user.create({
    data: {
      fullName: "Jordan Vehicle Owner",
      email: "owner@driveme.app",
      phone: "+12045550111",
      passwordHash: await hashPassword("OwnerPass123$"),
      role: UserRole.CUSTOMER,
      status: AccountStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      customerProfile: {
        create: {
          savedAddresses: ["1 Portage Ave, Winnipeg", "221 Carlton St, Winnipeg"],
          vehicles: {
            create: {
              make: "Toyota",
              model: "Camry",
              plateNumber: "DME-101",
              color: "Midnight Blue",
              notes: "Owner vehicle for evening bookings"
            }
          }
        }
      }
    },
    include: {
      customerProfile: {
        include: {
          vehicles: true
        }
      }
    }
  });

  const driverUser = await prisma.user.create({
    data: {
      fullName: "Avery Approved Driver",
      email: "driver@driveme.app",
      phone: "+12045550112",
      passwordHash: await hashPassword("DriverPass123$"),
      role: UserRole.DRIVER,
      status: AccountStatus.ACTIVE,
      emailVerifiedAt: new Date()
    }
  });

  const application = await prisma.driverApplication.create({
    data: {
      userId: driverUser.id,
      fullName: driverUser.fullName,
      email: driverUser.email,
      phone: driverUser.phone!,
      address: "44 Pembina Hwy, Winnipeg",
      licenseNumber: "MB-DRV-44021",
      yearsOfExperience: 7,
      emergencyContact: "Taylor Driver +12045550113",
      preferredServiceAreas: zones.map((zone) => zone.code),
      availabilitySchedule: "Weekdays 6am-10pm",
      status: "APPROVED",
      reviewNote: "Approved during seed",
      reviewedByUserId: admin.id,
      reviewedAt: new Date(),
      documents: {
        create: [
          {
            type: "DRIVER_LICENSE",
            fileName: "license.pdf",
            fileUrl: "https://example.com/license.pdf"
          },
          {
            type: "PASSPORT_PHOTO",
            fileName: "headshot.jpg",
            fileUrl: "https://example.com/headshot.jpg"
          }
        ]
      }
    }
  });

  const driver = await prisma.driver.create({
    data: {
      userId: driverUser.id,
      applicationId: application.id,
      licenseNumber: application.licenseNumber,
      yearsOfExperience: application.yearsOfExperience,
      emergencyContact: application.emergencyContact,
      serviceAreas: application.preferredServiceAreas,
      availabilitySchedule: application.availabilitySchedule,
      availabilityStatus: true,
      approvedAt: new Date(),
      currentLatitude: zones[0].centerLat,
      currentLongitude: zones[0].centerLng,
      locationUpdatedAt: new Date()
    }
  });

  const vehicle = customer.customerProfile!.vehicles[0];
  const startAt = new Date(Date.now() + 60 * 60 * 1000);
  const activeStart = new Date(Date.now() - 10 * 60 * 1000);

  const pendingBooking = await prisma.booking.create({
    data: {
      customerId: customer.customerProfile!.id,
      vehicleId: vehicle.id,
      pickupLocation: "201 Portage Ave, Winnipeg",
      pickupLat: 49.8959,
      pickupLng: -97.1385,
      destinationLocation: "The Forks, Winnipeg",
      destinationLat: 49.8870,
      destinationLng: -97.1318,
      scheduledStartAt: startAt,
      expectedDurationMinutes: 90,
      specialNotes: "Need assistance with downtown parking",
      vehicleDetails: "Toyota Camry - midnight blue",
      fareEstimate: 94.5,
      zoneCode: zones[0].code,
      activationWindowStartAt: new Date(startAt.getTime() - 15 * 60 * 1000),
      activationWindowEndAt: new Date(startAt.getTime() + 120 * 60 * 1000)
    }
  });

  await prisma.bookingDispatch.create({
    data: {
      bookingId: pendingBooking.id,
      driverId: driver.id,
      distanceKm: haversineDistanceKm(49.8959, -97.1385, zones[0].centerLat, zones[0].centerLng),
      status: "PENDING"
    }
  });

  const activeBooking = await prisma.booking.create({
    data: {
      customerId: customer.customerProfile!.id,
      vehicleId: vehicle.id,
      assignedDriverId: driver.id,
      pickupLocation: "275 Broadway, Winnipeg",
      pickupLat: 49.8844,
      pickupLng: -97.1423,
      destinationLocation: "St. Vital Centre, Winnipeg",
      destinationLat: 49.8277,
      destinationLng: -97.1147,
      scheduledStartAt: new Date(Date.now() - 5 * 60 * 1000),
      expectedDurationMinutes: 45,
      specialNotes: "Trip already in progress",
      vehicleDetails: "Toyota Camry - midnight blue",
      fareEstimate: 56.25,
      zoneCode: zones[0].code,
      activationWindowStartAt: new Date(activeStart.getTime() - 5 * 60 * 1000),
      activationWindowEndAt: new Date(activeStart.getTime() + 90 * 60 * 1000),
      status: "ACTIVE",
      acceptedAt: new Date(Date.now() - 20 * 60 * 1000),
      trip: {
        create: {
          driverId: driver.id,
          status: "ACTIVE",
          startedAt: new Date(Date.now() - 5 * 60 * 1000),
          navigationEnabled: true,
          liveTrackingEnabled: true
        }
      }
    }
  });

  await prisma.location.createMany({
    data: [
      {
        bookingId: activeBooking.id,
        driverId: driver.id,
        latitude: 49.8716,
        longitude: -97.1287,
        heading: 180,
        speedKph: 32
      },
      {
        bookingId: activeBooking.id,
        driverId: driver.id,
        latitude: 49.8503,
        longitude: -97.121,
        heading: 190,
        speedKph: 28
      }
    ]
  });

  await prisma.notification.createMany({
    data: [
      {
        userId: customer.id,
        type: "BOOKING_SUBMITTED",
        title: "Booking submitted",
        body: "Your next driver request is awaiting an available driver.",
        channel: "IN_APP",
        status: "SENT",
        meta: { bookingId: pendingBooking.id }
      },
      {
        userId: driverUser.id,
        type: "TRIP_STARTED",
        title: "Active trip",
        body: "Live tracking is enabled for your current assignment.",
        channel: "IN_APP",
        status: "SENT",
        meta: { bookingId: activeBooking.id }
      }
    ]
  });

  console.log("Seed complete");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
