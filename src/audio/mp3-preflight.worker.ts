import { scanMp3Frames } from './mp3-scan';

self.addEventListener('message', (event: MessageEvent<{ readonly id: number; readonly blob: Blob; readonly maxDurationSeconds: number }>) => {
  const { id, blob, maxDurationSeconds } = event.data;
  void blob.arrayBuffer().then(buffer => {
    try {
      const scan = scanMp3Frames(buffer, maxDurationSeconds);
      self.postMessage({ id, scan, encodedBytes: buffer }, { transfer: [buffer] });
    } catch (cause) {
      self.postMessage({
        id,
        error: cause instanceof Error ? cause.message : 'MP3 frame scan failed.',
        code: (cause as { code?: string }).code ?? 'corrupt-file',
      });
    }
  }).catch(cause => {
    self.postMessage({ id, error: cause instanceof Error ? cause.message : 'MP3 read failed.', code: 'corrupt-file' });
  });
});
