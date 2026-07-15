import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths & platform detection
const projectRoot = path.resolve(__dirname, '..');
const binDir = path.join(projectRoot, 'bin');

let ytDlpFilename = 'yt-dlp';
let ytDlpUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

if (process.platform === 'win32') {
  ytDlpFilename = 'yt-dlp.exe';
  ytDlpUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
} else if (process.platform === 'darwin') {
  ytDlpFilename = 'yt-dlp_macos';
  ytDlpUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
}

const ytDlpPath = path.join(binDir, ytDlpFilename);

// Get FFMPEG path from ffmpeg-static package
let ffmpegPath = '';
try {
  ffmpegPath = require('ffmpeg-static');
} catch (err) {
  console.error('ffmpeg-static not found, fallback to system path:', err);
  ffmpegPath = 'ffmpeg'; // fallback
}

/**
 * Downloads a file following HTTP/HTTPS redirects
 */
function downloadFile(url, destPath, progressCallback) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      // Follow Redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return downloadFile(response.headers.location, destPath, progressCallback)
          .then(resolve)
          .catch(reject);
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download yt-dlp: Status code ${response.statusCode}`));
        return;
      }

      const file = fs.createWriteStream(destPath);
      const totalSize = parseInt(response.headers['content-length'] || '0', 10);
      let downloaded = 0;

      response.on('data', (chunk) => {
        downloaded += chunk.length;
        if (progressCallback && totalSize > 0) {
          progressCallback(downloaded, totalSize);
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve();
      });

      file.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });

    request.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Ensures yt-dlp binary is available
 * @param {function} progressCallback - (downloadedBytes, totalBytes) => void
 */
export async function ensureBinaries(progressCallback) {
  // Ensure bin directory exists
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  // Check if yt-dlp binary already exists
  if (fs.existsSync(ytDlpPath)) {
    console.log(`${ytDlpFilename} is already present.`);
    // Ensure execution permissions on Unix-like systems
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(ytDlpPath, 0o755);
      } catch (err) {
        console.warn('Failed to ensure execute permissions on existing binary:', err);
      }
    }
    return { ytDlpPath, ffmpegPath, status: 'ready' };
  }

  console.log(`Downloading ${ytDlpFilename}...`);
  
  try {
    await downloadFile(ytDlpUrl, ytDlpPath, progressCallback);
    console.log(`${ytDlpFilename} downloaded successfully.`);
    // Ensure execution permissions on Unix-like systems
    if (process.platform !== 'win32') {
      fs.chmodSync(ytDlpPath, 0o755);
      console.log(`Set execute permission (+x) for ${ytDlpFilename}`);
    }
    return { ytDlpPath, ffmpegPath, status: 'downloaded' };
  } catch (error) {
    console.error('Error downloading yt-dlp:', error);
    // Cleanup if file exists incomplete
    if (fs.existsSync(ytDlpPath)) {
      try { fs.unlinkSync(ytDlpPath); } catch (e) {}
    }
    throw error;
  }
}

export function getBinaries() {
  return {
    ytDlpPath: fs.existsSync(ytDlpPath) ? ytDlpPath : null,
    ffmpegPath: ffmpegPath
  };
}
