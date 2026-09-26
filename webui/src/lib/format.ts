/**
 * Small, dependency-free formatting helpers shared by the UI.
 */

/** `0x1234…abcd` — short form of an address for compact display. */
export function formatAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 2) {
    return address;
  }
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

/** Formats a token amount with thousands separators and up to 6 decimals. */
export function formatTokenAmount(
  amount: bigint,
  decimals = 18,
  maxFractionDigits = 6,
): string {
  const negative = amount < 0n;
  const value = negative ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;

  let fractionText = fraction.toString().padStart(decimals, "0");
  fractionText = fractionText.slice(0, maxFractionDigits).replace(/0+$/, "");

  const wholeText = whole.toLocaleString("en-US");
  const sign = negative ? "-" : "";
  return fractionText ? `${sign}${wholeText}.${fractionText}` : `${sign}${wholeText}`;
}

/** Formats a 0–10000 basis-point value as a percentage string. */
export function formatBasisPoints(bp: number, maxFractionDigits = 2): string {
  const percent = bp / 100;
  return `${percent.toFixed(maxFractionDigits).replace(/\.?0+$/, "")}%`;
}

/** Converts a unix timestamp (seconds) to a short locale string. */
export function formatTimestamp(seconds: number): string {
  if (!seconds) {
    return "—";
  }
  return new Date(seconds * 1000).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Formats a number of seconds as a compact duration (e.g. "2d 3h"). */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) {
    return "—";
  }
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (!days && minutes) parts.push(`${minutes}m`);
  return parts.length ? parts.join(" ") : `${seconds}s`;
}
