import { encodeRecordingMp3 } from './mp3';

self.addEventListener('message', async (event: MessageEvent<Blob>) => {
  try {
    const blob = encodeRecordingMp3(await event.data.arrayBuffer());
    self.postMessage({ blob });
  } catch (cause) {
    self.postMessage({ error: cause instanceof Error ? cause.message : 'MP3 encoding failed. Try WAV instead.' });
  }
});
