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
      ? "/chaufx-login-logo.png?v=1"
      : theme === "dark"
        ? "/chaufx-logo-dark.png?v=6"
        : "/chaufx-logo-light.png?v=6";

  return (
    <Link href={href} className="inline-flex items-center">
      <div className={`relative overflow-hidden rounded-2xl ${compact ? "h-14 w-14" : "h-16 w-16"}`}>
        <Image src={logoSrc} alt="ChaufX" fill className="object-contain" priority />
      </div>
    </Link>
  );
}
