type SettlementPayment = {
  amount: number;
  capturedAmount?: number | null;
} | null;

type SettlementExtension = {
  amount: number;
  status: string;
};

type SettlementBooking = {
  fareEstimate: number;
  payment?: SettlementPayment;
  tripExtensions?: SettlementExtension[];
};

function money(value: number) {
  return Number(value.toFixed(2));
}

export function calculateBookingSettlement(
  booking: SettlementBooking,
  platformSharePercent: number
) {
  const baseAmount = money(
    Number(booking.payment?.capturedAmount ?? booking.payment?.amount ?? booking.fareEstimate ?? 0)
  );
  const extensionAmount = money(
    (booking.tripExtensions ?? [])
      .filter((extension) => extension.status === "RECORDED")
      .reduce((sum, extension) => sum + Number(extension.amount || 0), 0)
  );
  const extensionCount = (booking.tripExtensions ?? []).filter(
    (extension) => extension.status === "RECORDED"
  ).length;
  const grossAmount = money(baseAmount + extensionAmount);
  const normalizedPlatformSharePercent = Math.max(0, Math.min(100, platformSharePercent));
  const platformShareAmount = money((grossAmount * normalizedPlatformSharePercent) / 100);
  const driverShareAmount = money(grossAmount - platformShareAmount);

  return {
    baseAmount,
    extensionAmount,
    extensionCount,
    grossAmount,
    platformShareAmount,
    driverShareAmount
  };
}
