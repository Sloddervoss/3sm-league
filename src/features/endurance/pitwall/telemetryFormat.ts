export const preciseLapTime = (seconds: number | null | undefined): string => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const milliseconds=Math.round(seconds*1000);
  return `${Math.floor(milliseconds/60000)}:${((milliseconds%60000)/1000).toFixed(3).padStart(6,'0')}`;
};
