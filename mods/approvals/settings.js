export const DEFAULT_DELAY_MS = 3000;

export function validDelay(ms) {
  return Number.isInteger(ms) && ms >= 1000 && ms <= 3600000 && ms % 1000 === 0;
}

export function savedDelay(ms) {
  return validDelay(ms) ? ms : DEFAULT_DELAY_MS;
}

export function parseDelaySeconds(text) {
  if (typeof text !== 'string' || !/^\d+$/.test(text)) return null;
  const ms = Number(text) * 1000;
  return validDelay(ms) ? ms : null;
}
