import { PaymentStatus } from "@prisma/client";

export function isPaymentAuthorizedForDispatch(status: PaymentStatus | null | undefined) {
  return (
    status === PaymentStatus.AUTHORIZED ||
    status === PaymentStatus.CAPTURED ||
    // Preserve bookings paid before the manual-capture rollout.
    status === PaymentStatus.RECORDED
  );
}

export function isPaymentCaptured(status: PaymentStatus | null | undefined) {
  return status === PaymentStatus.CAPTURED || status === PaymentStatus.RECORDED;
}
