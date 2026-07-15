import { createRequire } from 'module';
const require = createRequire(import.meta.url);

try {
  const ffmpegPath = require('ffmpeg-static');
  console.log('ffmpegPath:', ffmpegPath);
} catch (err) {
  console.error('Error requiring ffmpeg-static:', err);
}
