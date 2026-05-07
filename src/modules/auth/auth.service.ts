import { AccountStatus, UserRole } from "@prisma/client";
import { AppError } from "../../common/AppError.js";
import { comparePassword, hashPassword, refreshExpiryDate, signAccessToken, signRefreshToken } from "../../lib/auth.js";
import { prisma } from "../../lib/prisma.js";

export async function buildSession(user: {
  id: string;
  role: UserRole;
  email: string;
  fullName: string;
  phone: string | null;
}) {
  const accessToken = signAccessToken({ userId: user.id, role: user.role.toLowerCase() });
  const refreshToken = signRefreshToken({ userId: user.id, role: user.role.toLowerCase() });

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: await hashPassword(refreshToken),
      expiresAt: refreshExpiryDate()
    }
  });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      role: user.role.toLowerCase(),
      email: user.email,
      fullName: user.fullName,
      phone: user.phone
    }
  };
}

export async function registerCustomer(input: {
  fullName: string;
  email: string;
  phone?: string;
  password: string;
}) {
  const existingUser = await prisma.user.findUnique({
    where: { email: input.email }
  });

  if (existingUser) {
    throw new AppError("An account already exists for that email", 409, "EMAIL_EXISTS");
  }

  const user = await prisma.user.create({
    data: {
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      passwordHash: await hashPassword(input.password),
      role: UserRole.CUSTOMER,
      status: AccountStatus.ACTIVE,
      customerProfile: {
        create: {
          savedAddresses: []
        }
      }
    }
  });

  return buildSession(user);
}

export async function createVerifiedCustomer(input: {
  fullName: string;
  email: string;
  phone?: string;
  passwordHash: string;
}) {
  const existingUser = await prisma.user.findUnique({
    where: {
      email: input.email
    }
  });

  if (existingUser) {
    if (existingUser.role !== UserRole.CUSTOMER) {
      throw new AppError("This email is already attached to a different account.", 409, "EMAIL_EXISTS");
    }

    const updatedUser = await prisma.user.update({
      where: {
        id: existingUser.id
      },
      data: {
        fullName: input.fullName,
        phone: input.phone,
        passwordHash: input.passwordHash,
        emailVerifiedAt: existingUser.emailVerifiedAt ?? new Date(),
        status: AccountStatus.ACTIVE
      }
    });

    await prisma.customerProfile.upsert({
      where: {
        userId: existingUser.id
      },
      update: {},
      create: {
        userId: existingUser.id,
        savedAddresses: []
      }
    });

    return updatedUser;
  }

  return prisma.user.create({
    data: {
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      passwordHash: input.passwordHash,
      role: UserRole.CUSTOMER,
      status: AccountStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      customerProfile: {
        create: {
          savedAddresses: []
        }
      }
    }
  });
}

export async function login(input: { email: string; password: string }) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: {
      driver: true
    }
  });

  if (!user) {
    throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");
  }

  const passwordMatches = await comparePassword(input.password, user.passwordHash);

  if (!passwordMatches) {
    throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");
  }

  if (user.status !== AccountStatus.ACTIVE) {
    throw new AppError("This account is not active yet", 403, "ACCOUNT_INACTIVE");
  }

  if (user.role === UserRole.DRIVER && !user.driver?.approvedAt) {
    throw new AppError("Driver access remains locked until admin approval", 403, "DRIVER_NOT_APPROVED");
  }

  return buildSession(user);
}
