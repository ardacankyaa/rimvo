import type { RecordingFormat } from '../../recording/types';

const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
export function recordingFilename(name: string, version: number, format: RecordingFormat = 'wav'): string {
  const safe = [...name.replace(/\.(wav|mp3)$/i, '').normalize('NFC')].map(character => character.charCodeAt(0) < 32 ? '-' : character).join('');
  let base = safe.replace(/[<>:"/\\|?*]/g, '-').replace(/[. ]+$/g, '').trim().slice(0, 80);
  if (!base) base = 'RIMVO mix';
  if (reserved.test(base)) base = 'RIMVO ' + base;
  const revision = Number.isSafeInteger(version) && version > 0 ? version : 1;
  return `${base} v${String(revision).padStart(2, '0')}.${format}`;
}
const leases = new Map<string, ReturnType<typeof setTimeout>>();
export function downloadRecording(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; link.hidden = true; document.body.append(link);
  try { link.click(); } finally { link.remove(); }
  // Safari may read the Blob after the click handler returns.
  leases.set(url, setTimeout(() => { URL.revokeObjectURL(url); leases.delete(url); }, 60_000));
}
export function releaseRecordingDownloads(): void {
  for (const [url, timer] of leases) { clearTimeout(timer); URL.revokeObjectURL(url); }
  leases.clear();
}
