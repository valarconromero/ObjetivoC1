// Microphone recording with MediaRecorder. Picks a format the browser
// supports (Opus/WebM on Chrome and Firefox, MP4/AAC on Safari).

const CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

export function recordingSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

export function extensionFor(mime = '') {
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4') || mime.includes('aac') || mime.includes('m4a')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg')) return 'jpg';
  if (mime.startsWith('text/markdown')) return 'md';
  if (mime.startsWith('text/')) return 'txt';
  return 'bin';
}

export class Recorder {
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = CANDIDATES.find((t) => MediaRecorder.isTypeSupported?.(t));
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.startedAt = performance.now();
    this.recorder.start(1000);
  }

  get elapsed() {
    return this.startedAt ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  stop() {
    return new Promise((resolve) => {
      const durationSec = this.elapsed;
      this.recorder.onstop = () => {
        const mime = this.recorder.mimeType || this.chunks[0]?.type || 'audio/webm';
        this.release();
        resolve({ blob: new Blob(this.chunks, { type: mime }), mime, durationSec });
      };
      this.recorder.stop();
    });
  }

  cancel() {
    if (this.recorder?.state === 'recording') {
      this.recorder.onstop = null;
      this.recorder.stop();
    }
    this.release();
  }

  release() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.startedAt = null;
  }
}
