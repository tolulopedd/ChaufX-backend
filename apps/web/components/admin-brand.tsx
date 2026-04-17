"use client";

import Image from "next/image";
import Link from "next/link";

type AdminBrandProps = {
  href?: string;
  theme?: "light" | "dark";
  compact?: boolean;
  variant?: "default" | "login";
};

export function AdminBrand({ href = "/dashboard", theme = "light", compact = false, variant = "default" }: AdminBrandProps) {
  const logoSrc =
    variant === "login"
      ? "/driveme-login-logo.png?v=1"
      : theme === "dark"
        ? "/driveme-logo-dark.png?v=6"
        : "/driveme-logo-light.png?v=6";

  return (
    <Link href={href} className="inline-flex items-center">
      <div className={`relative ${compact ? "h-14 w-44" : "h-16 w-52"}`}>
        <Image src={logoSrc} alt="DriveMe" fill className="object-contain object-left" priority />
      </div>
    </Link>
  );
}
