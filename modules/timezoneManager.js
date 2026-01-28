const supportedZones =
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

export const AVAILABLE_ZONES = Array.isArray(supportedZones) ? supportedZones : [];

function formatDateKey(date, timeZone) {
  const options = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  };
  if (timeZone) options.timeZone = timeZone;
  const formatter = new Intl.DateTimeFormat("en-US", options);
  const parts = formatter.formatToParts(date);
  const lookup = {};
  parts.forEach((part) => {
    if (part.type !== "literal") {
      lookup[part.type] = part.value;
    }
  });
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function getOffsetMinutes(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const lookup = {};
  parts.forEach((part) => {
    if (part.type !== "literal") {
      lookup[part.type] = part.value;
    }
  });
  const hourValue = lookup.hour === "24" ? "00" : lookup.hour;
  const asUtc = Date.UTC(
    Number(lookup.year),
    Number(lookup.month) - 1,
    Number(lookup.day),
    Number(hourValue),
    Number(lookup.minute),
    Number(lookup.second),
  );
  return Math.round((asUtc - date.getTime()) / 60000);
}

function formatUtcOffset(offsetMinutes) {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  return `${sign}${hours}:${String(minutes).padStart(2, "0")}`;
}

export function getZoneInfo(zoneName) {
  const now = new Date();

  const timeFormatter = new Intl.DateTimeFormat(undefined, {
    timeZone: zoneName,
    hour: "numeric",
    minute: "2-digit",
  });

  const localDateKey = formatDateKey(now);
  const targetDateKey = formatDateKey(now, zoneName);
  const offsetMinutes = getOffsetMinutes(now, zoneName);
  const offsetLabel = formatUtcOffset(offsetMinutes);

  let dayDiffLabel = "";
  if (targetDateKey > localDateKey) dayDiffLabel = "Tomorrow";
  else if (targetDateKey < localDateKey) dayDiffLabel = "Yesterday";

  return {
    name: zoneName.split("/").pop().replace(/_/g, " "),
    fullZone: zoneName,
    time: timeFormatter.format(now),
    dayDiff: dayDiffLabel,
    offset: offsetLabel,
  };
}

export function isValidZone(zoneName) {
  if (!zoneName || typeof zoneName !== "string") return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: zoneName });
    return true;
  } catch (error) {
    return false;
  }
}
