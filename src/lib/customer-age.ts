const MINIMUM_CUSTOMER_AGE = 18;

export function isEligibleCustomerAge(dateOfBirth: Date | null | undefined, referenceDate = new Date()) {
  if (!(dateOfBirth instanceof Date) || Number.isNaN(dateOfBirth.getTime())) {
    return false;
  }

  const latestEligibleBirthDate = Date.UTC(
    referenceDate.getUTCFullYear() - MINIMUM_CUSTOMER_AGE,
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate()
  );
  const normalizedDateOfBirth = Date.UTC(
    dateOfBirth.getUTCFullYear(),
    dateOfBirth.getUTCMonth(),
    dateOfBirth.getUTCDate()
  );

  return normalizedDateOfBirth <= latestEligibleBirthDate;
}
