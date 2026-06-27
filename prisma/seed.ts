import { AccountStatus, UserRole } from "@prisma/client";
import { defaultServiceZones } from "../src/lib/app-config.js";
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
        code: "PROVINCE::Manitoba::FLAT_FEE",
        name: "Manitoba flat hourly fee",
        value: 35,
        description: "Flat hourly fee for Manitoba"
      },
      {
        code: "PROVINCE::Manitoba::MIN_HOURS",
        name: "Manitoba minimum booking hours",
        value: 2,
        description: "Minimum booking hours for Manitoba"
      }
    ]
  });

  const admin = await prisma.user.create({
    data: {
      fullName: "ChaufX Admin",
      email: "admin@chaufx.ca",
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

  await prisma.user.create({
    data: {
      fullName: "Jordan Vehicle Owner",
      email: "owner@chaufx.app",
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
      email: "driver@chaufx.app",
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

  await prisma.driver.create({
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
