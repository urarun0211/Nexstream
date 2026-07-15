import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { spawn, exec } from 'child_process';
import { ensureBinaries, getBinaries } from './binaries.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const cookiesFilePath = path.join(projectRoot, 'cookies.txt');

const settingsPassword = process.env.SETTINGS_PASSWORD || '';

function writeCookiesFile(text) {
  let cleanedText = text.trim();
  
  if (cleanedText.startsWith('[') || cleanedText.startsWith('{')) {
    console.warn('WARNING: Cookies text appears to be JSON format. yt-dlp requires Netscape HTTP Cookie format!');
    fs.writeFileSync(cookiesFilePath, cleanedText + '\n', 'utf8');
    return;
  }

  const lines = cleanedText.split('\n');
  let spaceConvertedCount = 0;
  const processedLines = lines.map(line => {
    if (line.startsWith('#') || !line.trim()) return line;
    
    // Check if it uses spaces instead of tabs
    if (!line.includes('\t')) {
      const parts = line.split(/\s+/);
      if (parts.length >= 7) {
        spaceConvertedCount++;
        return parts.slice(0, 7).join('\t'); // Netscape requires 7 fields
      }
    }
    return line;
  });

  if (spaceConvertedCount > 0) {
    console.log(`Auto-converted ${spaceConvertedCount} space-separated cookie lines to Netscape tab-separated format.`);
  }

  cleanedText = processedLines.join('\n') + '\n';
  fs.writeFileSync(cookiesFilePath, cleanedText, 'utf8');
}

// Load cookies from environment variable if present on startup
if (process.env.YOUTUBE_COOKIES) {
  try {
    writeCookiesFile(process.env.YOUTUBE_COOKIES);
    console.log('Successfully loaded global cookies from YOUTUBE_COOKIES environment variable.');
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(cookiesFilePath, 0o600);
      } catch (e) {}
    }
  } catch (err) {
    console.error('Failed to save cookies from YOUTUBE_COOKIES environment variable:', err);
  }
}

function verifyPassword(req, res, next) {
  if (settingsPassword && req.headers['x-settings-password'] !== settingsPassword) {
    return res.status(401).json({ error: 'Incorrect settings password.' });
  }
  next();
}

function getGlobalArgs() {
  const args = [
    '--ignore-config',
    '--extractor-args', 'youtube:player_client=android,web'
  ];
  if (fs.existsSync(cookiesFilePath)) {
    console.log('Using cookies.txt for yt-dlp authentication.');
    args.push('--cookies', cookiesFilePath);
  }
  return args;
}

let ytDlpVersion = 'Unknown';

function checkYtDlpVersion() {
  const { ytDlpPath } = getBinaries();
  if (ytDlpPath && fs.existsSync(ytDlpPath)) {
    exec(`"${ytDlpPath}" --version`, (err, stdout) => {
      if (!err && stdout) {
        ytDlpVersion = stdout.trim();
        console.log(`yt-dlp version detected: ${ytDlpVersion}`);
      } else {
        console.error('Failed to detect yt-dlp version:', err);
      }
    });
  }
}

const defaultDownloadsDir = path.join(os.homedir(), 'Downloads');
let currentDownloadsDir = defaultDownloadsDir;

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Track download status progress in memory
const activeDownloads = new Map();

// Map to store completed file paths for serving browser download links
const completedFiles = new Map();

// Binary status checking and downloading progress
let binarySetupProgress = {
  status: 'checking', // 'checking', 'downloading', 'ready', 'error'
  downloadedBytes: 0,
  totalBytes: 0,
  percent: 0,
  error: null
};

// Start setup of binaries in background on startup
ensureBinaries((downloaded, total) => {
  binarySetupProgress.status = 'downloading';
  binarySetupProgress.downloadedBytes = downloaded;
  binarySetupProgress.totalBytes = total;
  binarySetupProgress.percent = Math.round((downloaded / total) * 100);
}).then(() => {
  binarySetupProgress.status = 'ready';
  binarySetupProgress.percent = 100;
  console.log('Binaries initialized successfully.');
  checkYtDlpVersion();
}).catch((err) => {
  binarySetupProgress.status = 'error';
  binarySetupProgress.error = err.message;
  console.error('Failed to setup binaries:', err);
});

// Endpoint to force re-download / update yt-dlp binary
app.post('/api/binaries/update', verifyPassword, (req, res) => {
  const { ytDlpPath } = getBinaries();
  if (ytDlpPath && fs.existsSync(ytDlpPath)) {
    try {
      fs.unlinkSync(ytDlpPath);
      console.log('Deleted old yt-dlp binary to force update.');
    } catch (err) {
      console.error('Failed to delete old binary:', err);
      return res.status(500).json({ error: 'Failed to delete old binary.' });
    }
  }

  // Trigger setup in background
  binarySetupProgress.status = 'downloading';
  binarySetupProgress.downloadedBytes = 0;
  binarySetupProgress.percent = 0;
  binarySetupProgress.error = null;

  ensureBinaries((downloaded, total) => {
    binarySetupProgress.status = 'downloading';
    binarySetupProgress.downloadedBytes = downloaded;
    binarySetupProgress.totalBytes = total;
    binarySetupProgress.percent = Math.round((downloaded / total) * 100);
  }).then(() => {
    binarySetupProgress.status = 'ready';
    binarySetupProgress.percent = 100;
    console.log('Binaries updated/re-downloaded successfully.');
    checkYtDlpVersion();
  }).catch((err) => {
    binarySetupProgress.status = 'error';
    binarySetupProgress.error = err.message;
    console.error('Failed to re-download binaries:', err);
  });

  res.json({ success: true, message: 'Update/re-download started in background.' });
});

// Endpoint to get binary setup status
app.get('/api/status', (req, res) => {
  res.json({
    ...binarySetupProgress,
    ytDlpVersion
  });
});

// Endpoint to get or set download folder path configuration
app.get('/api/config', (req, res) => {
  res.json({ 
    downloadPath: currentDownloadsDir,
    passwordRequired: !!settingsPassword
  });
});

app.post('/api/config', verifyPassword, (req, res) => {
  const { downloadPath } = req.body;
  if (downloadPath && fs.existsSync(downloadPath)) {
    currentDownloadsDir = downloadPath;
    console.log(`Downloads path updated to: ${currentDownloadsDir}`);
    return res.json({ success: true, downloadPath: currentDownloadsDir });
  }
  res.status(400).json({ error: 'Invalid directory path.' });
});

// Endpoint to get cookies configuration status
app.get('/api/cookies', (req, res) => {
  const exists = fs.existsSync(cookiesFilePath);
  let preview = 'Not configured';
  if (exists) {
    try {
      const content = fs.readFileSync(cookiesFilePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim() && !line.startsWith('#'));
      preview = `Configured (${lines.length} cookies loaded)`;
    } catch (err) {
      preview = 'Error reading cookies file';
    }
  }
  res.json({ configured: exists, preview });
});

// Endpoint to save or clear cookies configuration
app.post('/api/cookies', verifyPassword, (req, res) => {
  const { cookiesText } = req.body;

  if (!cookiesText || !cookiesText.trim()) {
    if (fs.existsSync(cookiesFilePath)) {
      try {
        fs.unlinkSync(cookiesFilePath);
        console.log('Cookies file deleted.');
      } catch (err) {
        console.error('Failed to delete cookies file:', err);
        return res.status(500).json({ error: 'Failed to delete cookies file.' });
      }
    }
    return res.json({ success: true, configured: false, preview: 'Not configured' });
  }

  try {
    writeCookiesFile(cookiesText);
    console.log('Cookies file updated successfully.');
    
    // Set restricted permissions if not on Windows
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(cookiesFilePath, 0o600);
      } catch (e) {}
    }

    const lines = cookiesText.split('\n').filter(line => line.trim() && !line.startsWith('#'));
    const preview = `Configured (${lines.length} cookies loaded)`;
    res.json({ success: true, configured: true, preview });
  } catch (err) {
    console.error('Failed to write cookies file:', err);
    res.status(500).json({ error: 'Failed to save cookies on server.' });
  }
});

// Endpoint to open native Win32 folder browser dialog and return selected path
app.post('/api/select-folder', verifyPassword, (req, res) => {
  if (process.platform !== 'win32') {
    return res.status(501).json({ error: 'Folder selection is only supported on Windows' });
  }

  // PowerShell script to invoke System.Windows.Forms.FolderBrowserDialog
  const psScript = `
    Add-Type -AssemblyName System.Windows.Forms;
    $f = New-Object System.Windows.Forms.FolderBrowserDialog;
    $f.Description = "Select Download Folder";
    $f.ShowNewFolderButton = $true;
    $f.SelectedPath = "${currentDownloadsDir.replace(/\\/g, '\\\\')}";
    if ($f.ShowDialog() -eq "OK") { Write-Output $f.SelectedPath }
  `;

  console.log('Opening native folder picker...');
  exec(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`, (err, stdout, stderr) => {
    if (err) {
      console.error('Folder picker error:', err);
      return res.status(500).json({ error: 'Failed to open folder picker' });
    }
    const selectedPath = stdout.trim();
    if (!selectedPath) {
      return res.json({ cancelled: true });
    }
    currentDownloadsDir = selectedPath;
    console.log(`Directory selected via popup: ${currentDownloadsDir}`);
    res.json({ success: true, path: currentDownloadsDir });
  });
});

// Endpoint to extract metadata (Optimized for speed)
app.get('/api/info', async (req, res) => {
  const videoUrl = req.query.url;
  const playlistMode = req.query.playlistMode === 'true'; // Toggle parameter

  if (!videoUrl) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const { ytDlpPath } = getBinaries();
  if (!ytDlpPath) {
    return res.status(503).json({ error: 'Downloader binary is not ready yet.' });
  }

  let targetUrl = videoUrl.trim();
  let processArgs = [];

  // SPEED OPTIMIZATION: If playlistMode is false, we strip the list parameters
  // and pass --no-playlist flag to prevent yt-dlp scanning the whole playlist list!
  if (!playlistMode) {
    try {
      const parsedUrl = new URL(targetUrl);
      if (parsedUrl.searchParams.has('list')) {
        parsedUrl.searchParams.delete('list');
        parsedUrl.searchParams.delete('index');
        targetUrl = parsedUrl.toString();
        console.log(`Stripped playlist parameter for speed. Target URL: ${targetUrl}`);
      }
    } catch (e) {
      console.warn('URL parsing failed, using raw URL:', e.message);
    }
    processArgs = ['--dump-single-json', '--no-playlist', '--no-warnings', targetUrl];
  } else {
    // Fetch complete playlist flat entries (taking a bit more time but getting all)
    processArgs = ['--dump-single-json', '--flat-playlist', '--no-warnings', targetUrl];
  }

  console.log(`Extracting metadata (PlaylistMode: ${playlistMode}) for URL: ${targetUrl}`);

  const spawnArgs = [...getGlobalArgs(), ...processArgs];
  console.log(`Spawning yt-dlp metadata extraction: ${spawnArgs.join(' ')}`);
  const child = spawn(ytDlpPath, spawnArgs);
  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (data) => { stdout += data; });
  child.stderr.on('data', (data) => { stderr += data; });

  child.on('close', (code) => {
    if (code !== 0) {
      console.error('yt-dlp failed to extract metadata:', stderr);
      const errLines = stderr.split('\n').map(l => l.trim()).filter(Boolean);
      const cleanErr = errLines.find(l => l.includes('ERROR:')) || errLines[0] || 'Failed to extract video info.';
      return res.status(500).json({ error: cleanErr.replace(/ERROR:\s*\[youtube\]\s*/gi, '') });
    }

    try {
      const data = JSON.parse(stdout);
      const isPlaylist = data._type === 'playlist';

      if (isPlaylist) {
        return res.json({
          type: 'playlist',
          title: data.title || 'Playlist',
          uploader: data.uploader || 'Unknown Creator',
          videoCount: data.playlist_count || data.entries?.length || 0,
          entries: (data.entries || []).map((entry, index) => ({
            id: entry.id,
            title: entry.title || `Video ${index + 1}`,
            url: `https://www.youtube.com/watch?v=${entry.id}`,
            duration: entry.duration || 0,
            uploader: entry.uploader || 'Unknown'
          }))
        });
      } else {
        const formats = data.formats || [];
        const cleanFormats = [];
        const seenResolutions = new Set();

        const sortedFormats = formats.sort((a, b) => (b.height || 0) - (a.height || 0));

        sortedFormats.forEach(f => {
          if (f.vcodec !== 'none' && f.height) {
            const resKey = `${f.height}p${f.fps ? ` (${f.fps}fps)` : ''}`;
            const hasAudio = f.acodec !== 'none';
            const uniqueId = hasAudio ? f.format_id : `${f.format_id}+bestaudio`;
            const label = `${resKey} - ${f.ext.toUpperCase()}${hasAudio ? '' : ' (HD - Audio auto-merged)'}`;
            
            const formatKey = `${f.height}p-${f.ext}-${hasAudio ? 'combined' : 'video-only'}`;
            if (!seenResolutions.has(formatKey)) {
              seenResolutions.add(formatKey);
              cleanFormats.push({
                formatId: uniqueId,
                resolution: resKey,
                ext: f.ext,
                filesize: f.filesize || f.filesize_approx || null,
                label: label,
                type: 'video',
                height: f.height
              });
            }
          }
        });

        if (cleanFormats.length === 0) {
          cleanFormats.push({
            formatId: 'best',
            resolution: 'Best Quality',
            ext: 'mp4',
            filesize: null,
            label: 'Best Available Quality (MP4)',
            type: 'video',
            height: 720
          });
        }

        // Add Audio only option (bestaudio)
        cleanFormats.push({
          formatId: 'bestaudio',
          resolution: 'Audio Only',
          ext: 'mp3',
          filesize: null,
          label: 'Audio Only (MP3)',
          type: 'audio',
          height: 0
        });

        return res.json({
          type: 'video',
          title: data.title || 'Video',
          description: data.description || '',
          thumbnail: data.thumbnail || (data.thumbnails && data.thumbnails.length > 0 ? data.thumbnails[0].url : ''),
          duration: data.duration || 0,
          uploader: data.uploader || 'Unknown Creator',
          formats: cleanFormats.sort((a, b) => b.height - a.height)
        });
      }
    } catch (err) {
      console.error('Error parsing JSON from yt-dlp:', err);
      return res.status(500).json({ error: 'Failed to parse video metadata.' });
    }
  });
});

// SSE endpoint to track download progress
app.get('/api/download/progress/:id', (req, res) => {
  const downloadId = req.params.id;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendProgress = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  if (!activeDownloads.has(downloadId)) {
    activeDownloads.set(downloadId, {
      clients: [],
      progress: { percent: 0, speed: '0 B/s', size: 'Unknown', eta: '--:--', status: 'starting', title: '' }
    });
  }

  const downloadState = activeDownloads.get(downloadId);
  downloadState.clients.push(res);

  sendProgress(downloadState.progress);

  req.on('close', () => {
    const state = activeDownloads.get(downloadId);
    if (state) {
      state.clients = state.clients.filter(c => c !== res);
    }
  });
});

// Helper: Start/resume single video download process
function startSingleDownload(downloadId) {
  const state = activeDownloads.get(downloadId);
  if (!state) return;

  const { ytDlpPath, ffmpegPath } = getBinaries();
  
  const updateProgress = (updates) => {
    state.progress = { ...state.progress, ...updates };
    state.clients.forEach(client => {
      try {
        client.write(`data: ${JSON.stringify(state.progress)}\n\n`);
      } catch (err) {
        console.error('Error writing to client:', err);
      }
    });
  };

  updateProgress({ status: 'downloading' });

  const child = spawn(ytDlpPath, [...getGlobalArgs(), ...state.args]);
  state.child = child;

  let finalFilePath = '';

  child.stdout.on('data', (data) => {
    const line = data.toString();
    console.log(`[Single Download stdout] ${downloadId}:`, line);

    const progressMatch = line.match(/\[download\]\s+(\d+\.\d+)%\s+of\s+([~\d\.]+\w+)\s+at\s+([\d\.]+\w+\/s)\s+ETA\s+([\d:]+)/);
    if (progressMatch) {
      const percent = parseFloat(progressMatch[1]);
      const size = progressMatch[2];
      const speed = progressMatch[3];
      const eta = progressMatch[4];
      updateProgress({ percent, size, speed, eta, status: 'downloading' });
    }

    const destMatch = line.match(/\[download\]\s+Destination:\s+(.+)$/);
    if (destMatch) {
      finalFilePath = destMatch[1].trim();
    }
    const mergeMatch = line.match(/\[Merger\]\s+Merging\s+formats\s+into\s+"([^"]+)"/);
    if (mergeMatch) {
      finalFilePath = mergeMatch[1].trim();
    }
    const alreadyMatch = line.match(/\[download\]\s+(.+?)\s+has\s+already\s+been\s+downloaded/);
    if (alreadyMatch) {
      finalFilePath = alreadyMatch[1].trim();
    }

    if (line.includes('[Merger]') || line.includes('Merging formats')) {
      updateProgress({ status: 'merging', percent: 99 });
    }
  });

  child.stderr.on('data', (data) => {
    console.error(`[Single Download stderr] ${downloadId}:`, data.toString());
  });

  child.on('close', (code) => {
    if (state.progress.status === 'paused') {
      return;
    }

    if (code === 0) {
      let resolvedPath = finalFilePath;
      if (resolvedPath) {
        if (!path.isAbsolute(resolvedPath)) {
          resolvedPath = path.resolve(currentDownloadsDir, path.basename(resolvedPath));
        }
        completedFiles.set(downloadId, {
          filePath: resolvedPath,
          fileName: path.basename(resolvedPath)
        });
      }

      updateProgress({ 
        percent: 100, 
        status: 'completed', 
        downloadUrl: resolvedPath ? `/api/files/${downloadId}` : null 
      });
    } else {
      updateProgress({ status: 'failed', error: 'Download failed.' });
    }
  });
}

// Helper: Start/resume playlist download process loop
async function startPlaylistDownload(downloadId) {
  const state = activeDownloads.get(downloadId);
  if (!state) return;

  const { ytDlpPath, ffmpegPath } = getBinaries();
  
  const updateProgress = (updates) => {
    state.progress = { ...state.progress, ...updates };
    state.clients.forEach(client => {
      try {
        client.write(`data: ${JSON.stringify(state.progress)}\n\n`);
      } catch (err) {
        console.error('Error writing to client:', err);
      }
    });
  };

  const totalVideos = state.selectedVideos.length;
  state.progress.status = 'downloading';

  while (state.currentIndex < totalVideos && state.progress.status === 'downloading') {
    const video = state.selectedVideos[state.currentIndex];
    const currentVideoIndex = state.currentIndex + 1;

    updateProgress({
      status: 'downloading',
      currentVideo: currentVideoIndex,
      totalVideos: totalVideos,
      title: video.title || `Video ${currentVideoIndex}`,
      percent: Math.round((state.completedVideos / totalVideos) * 100),
      speed: '0 B/s',
      eta: '--:--',
      videoPercent: 0,
      videoCompletedUrl: null
    });

    try {
      await new Promise((resolve, reject) => {
        const outputTemplate = path.join(currentDownloadsDir, '%(title)s.%(ext)s');
        let args = ['-o', outputTemplate, '--no-warnings'];

        if (ffmpegPath) {
          args.push('--ffmpeg-location', ffmpegPath);
        }

        if (state.formatId === 'bestaudio') {
          args.push('-f', 'bestaudio');
          args.push('--extract-audio');
          args.push('--audio-format', 'mp3');
          args.push('--audio-quality', '0');
        } else if (state.formatId) {
          args.push('-f', state.formatId);
        } else {
          args.push('-f', 'bestvideo+bestaudio/best');
        }

        const fullUrl = video.url.includes('http') ? video.url : `https://www.youtube.com/watch?v=${video.id}`;
        args.push(fullUrl);

        const child = spawn(ytDlpPath, [...getGlobalArgs(), ...args]);
        state.child = child;

        let finalFilePath = '';

        child.stdout.on('data', (data) => {
          const line = data.toString();
          console.log(`[Playlist stdout] Video index ${state.currentIndex}:`, line);

          const progressMatch = line.match(/\[download\]\s+(\d+\.\d+)%\s+of\s+([~\d\.]+\w+)\s+at\s+([\d\.]+\w+\/s)\s+ETA\s+([\d:]+)/);
          if (progressMatch) {
            const videoPercent = parseFloat(progressMatch[1]);
            const size = progressMatch[2];
            const speed = progressMatch[3];
            const eta = progressMatch[4];

            const overallPercent = Math.round(((state.completedVideos * 100) + videoPercent) / totalVideos);
            updateProgress({
              percent: overallPercent,
              videoPercent,
              size,
              speed,
              eta,
              status: 'downloading'
            });
          }

          const destMatch = line.match(/\[download\]\s+Destination:\s+(.+)$/);
          if (destMatch) {
            finalFilePath = destMatch[1].trim();
          }
          const mergeMatch = line.match(/\[Merger\]\s+Merging\s+formats\s+into\s+"([^"]+)"/);
          if (mergeMatch) {
            finalFilePath = mergeMatch[1].trim();
          }
          const alreadyMatch = line.match(/\[download\]\s+(.+?)\s+has\s+already\s+been\s+downloaded/);
          if (alreadyMatch) {
            finalFilePath = alreadyMatch[1].trim();
          }

          if (line.includes('[Merger]') || line.includes('Merging formats')) {
            updateProgress({ status: 'merging' });
          }
        });

        child.stderr.on('data', (data) => {
          console.error(`[Playlist stderr] Video index ${state.currentIndex}:`, data.toString());
        });

        child.on('close', (code) => {
          if (state.progress.status === 'paused') {
            return reject(new Error('paused'));
          }

          if (code === 0) {
            state.completedVideos++;
            
            let resolvedPath = finalFilePath;
            if (resolvedPath) {
              if (!path.isAbsolute(resolvedPath)) {
                resolvedPath = path.resolve(currentDownloadsDir, path.basename(resolvedPath));
              }
              const fileKey = `${downloadId}_${state.currentIndex}`;
              completedFiles.set(fileKey, {
                filePath: resolvedPath,
                fileName: path.basename(resolvedPath)
              });
              
              updateProgress({
                videoCompletedUrl: `/api/files/${fileKey}`,
                videoCompletedTitle: video.title
              });
            }

            state.currentIndex++;
            resolve();
          } else {
            state.currentIndex++;
            reject(new Error(`Failed to download video index ${state.currentIndex}`));
          }
        });
      });
    } catch (err) {
      if (err.message === 'paused') {
        console.log(`Playlist download ${downloadId} paused at index ${state.currentIndex}`);
        return;
      }
      console.error(`Error downloading video index ${state.currentIndex}:`, err);
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  if (state.currentIndex >= totalVideos) {
    updateProgress({
      status: 'completed',
      percent: 100,
      title: 'Playlist download complete!'
    });
  }
}

// Endpoint to trigger single video download
app.post('/api/download', (req, res) => {
  const { url, formatId, downloadId, title } = req.body;

  if (!url || !downloadId) {
    return res.status(400).json({ error: 'URL and downloadId are required' });
  }

  const { ytDlpPath, ffmpegPath } = getBinaries();
  if (!ytDlpPath) {
    return res.status(503).json({ error: 'Downloader binary is not ready' });
  }

  if (!fs.existsSync(currentDownloadsDir)) {
    fs.mkdirSync(currentDownloadsDir, { recursive: true });
  }

  // Setup args
  const outputTemplate = path.join(currentDownloadsDir, '%(title)s.%(ext)s');
  let args = ['-o', outputTemplate, '--no-warnings'];

  if (ffmpegPath) {
    args.push('--ffmpeg-location', ffmpegPath);
  }

  if (formatId === 'bestaudio') {
    args.push('-f', 'bestaudio');
    args.push('--extract-audio');
    args.push('--audio-format', 'mp3');
    args.push('--audio-quality', '0');
  } else if (formatId) {
    args.push('-f', formatId);
  } else {
    args.push('-f', 'bestvideo+bestaudio/best');
  }

  args.push(url);

  activeDownloads.set(downloadId, {
    type: 'video',
    url,
    args,
    child: null,
    clients: activeDownloads.get(downloadId)?.clients || [],
    progress: { percent: 0, speed: '0 B/s', size: 'Unknown', eta: '--:--', status: 'starting', title: title || 'Video' }
  });

  startSingleDownload(downloadId);

  res.json({ success: true, message: 'Download started' });
});

// Endpoint to trigger playlist download
app.post('/api/download-playlist', (req, res) => {
  const { selectedVideos, formatId, downloadId, playlistTitle } = req.body;

  if (!selectedVideos || !Array.isArray(selectedVideos) || selectedVideos.length === 0 || !downloadId) {
    return res.status(400).json({ error: 'selectedVideos array and downloadId are required' });
  }

  const { ytDlpPath } = getBinaries();
  if (!ytDlpPath) {
    return res.status(503).json({ error: 'Downloader binary is not ready' });
  }

  if (!fs.existsSync(currentDownloadsDir)) {
    fs.mkdirSync(currentDownloadsDir, { recursive: true });
  }

  activeDownloads.set(downloadId, {
    type: 'playlist',
    selectedVideos,
    formatId,
    currentIndex: 0,
    completedVideos: 0,
    playlistTitle,
    child: null,
    clients: activeDownloads.get(downloadId)?.clients || [],
    progress: { percent: 0, status: 'starting', currentVideo: 1, totalVideos: selectedVideos.length, title: playlistTitle || 'Playlist' }
  });

  startPlaylistDownload(downloadId);

  res.json({ success: true, message: 'Playlist download started' });
});

// Endpoint to Pause download
app.post('/api/download/pause', (req, res) => {
  const { downloadId } = req.body;
  const state = activeDownloads.get(downloadId);

  if (!state) {
    return res.status(404).json({ error: 'Download session not found' });
  }

  state.progress.status = 'paused';
  
  if (state.child) {
    console.log(`Killing child process to pause download session ${downloadId}`);
    state.child.kill();
    state.child = null;
  }

  state.clients.forEach(client => {
    try {
      client.write(`data: ${JSON.stringify(state.progress)}\n\n`);
    } catch (err) {}
  });

  res.json({ success: true, message: 'Download paused' });
});

// Endpoint to Resume download
app.post('/api/download/resume', (req, res) => {
  const { downloadId } = req.body;
  const state = activeDownloads.get(downloadId);

  if (!state) {
    return res.status(404).json({ error: 'Download session not found' });
  }

  if (state.progress.status !== 'paused') {
    return res.status(400).json({ error: 'Download is not paused' });
  }

  state.progress.status = 'downloading';
  
  if (state.type === 'playlist') {
    startPlaylistDownload(downloadId);
  } else {
    startSingleDownload(downloadId);
  }

  res.json({ success: true, message: 'Download resumed' });
});

// Endpoint to stream/download file to client browser
app.get('/api/files/:id', (req, res) => {
  const fileId = req.params.id;
  const fileInfo = completedFiles.get(fileId);

  if (!fileInfo || !fs.existsSync(fileInfo.filePath)) {
    return res.status(404).send('File not found.');
  }

  console.log(`Streaming file download: ${fileInfo.filePath}`);
  res.download(fileInfo.filePath, fileInfo.fileName, (err) => {
    if (err) {
      console.error('Error sending file download:', err);
    }
  });
});

// Endpoint to download/stream video directly to browser on-the-fly (triggers Save As immediately)
app.get('/api/download-direct', (req, res) => {
  const { url, formatId, title, ext } = req.query;

  if (!url) {
    return res.status(400).send('URL is required');
  }

  // Set infinite socket timeout to prevent ECONNRESET/timeouts during download
  req.socket.setTimeout(0);
  res.setTimeout(0);

  const { ytDlpPath, ffmpegPath } = getBinaries();
  if (!ytDlpPath) {
    return res.status(503).send('Downloader is not ready');
  }

  // Restore the '+' character which is decoded as a space in query strings
  const cleanFormatId = (formatId || '').trim().replace(/\s+/g, '+');

  const cleanTitle = (title || 'video').replace(/[\\/:*?"<>|]/g, '_');
  const fileExt = ext || 'mp4';

  // Check if format requires merging (contains "+" or is "bestvideo+bestaudio/best")
  const requiresMerging = cleanFormatId ? (cleanFormatId.includes('+') || cleanFormatId === 'bestvideo+bestaudio/best') : true;

  // Set final filename with correct extension immediately
  const finalExt = requiresMerging ? 'mkv' : fileExt;
  const filename = `${cleanTitle}.${finalExt}`;

  console.log(`Direct stream download request: ${filename} (Format: "${cleanFormatId}")`);

  // Set headers and flush IMMEDIATELY to trigger Chrome's Save As dialog instantly!
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.flushHeaders();

  if (!requiresMerging) {
    // 1. Pre-merged format: stream directly from yt-dlp to client on-the-fly!
    console.log(`Streaming pre-merged format directly to client: ${filename}`);

    let args = ['--quiet', '-o', '-', '--no-warnings', '--no-playlist'];
    
    if (ffmpegPath) {
      args.push('--ffmpeg-location', ffmpegPath);
    }

    if (cleanFormatId === 'bestaudio') {
      args.push('-f', 'bestaudio');
      args.push('--extract-audio');
      args.push('--audio-format', 'mp3');
      args.push('--audio-quality', '0');
    } else if (cleanFormatId) {
      args.push('-f', cleanFormatId);
    } else {
      args.push('-f', 'best');
    }

    args.push(url);

    const child = spawn(ytDlpPath, [...getGlobalArgs(), ...args], {
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });
    child.stdout.pipe(res);

    child.stderr.on('data', (data) => {
      console.error(`Direct stream error [${filename}]:`, data.toString());
    });

    req.on('close', () => {
      console.log(`Client cancelled stream: ${filename}`);
      child.kill();
    });
  } else {
    // 2. HD format: fetch streaming URLs and pipe merged output from ffmpeg directly!
    console.log(`HD format detected. Fetching URLs for on-the-fly merge stream: ${filename}`);

    const gChild = spawn(ytDlpPath, [...getGlobalArgs(), '-g', '-f', cleanFormatId, '--no-playlist', url]);
    let stdoutData = '';
    let stderrData = '';

    gChild.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    gChild.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    gChild.on('close', (code) => {
      if (code !== 0) {
        console.error(`Failed to get stream URLs. Exit code: ${code}. Error: ${stderrData}`);
        res.end(); // End the flushed response since we cannot send headers anymore
        return;
      }

      const lines = stdoutData.trim().split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        console.error(`Expected 2 URLs (video and audio), but got: ${lines.length}`);
        res.end();
        return;
      }

      const [videoUrl, audioUrl] = lines;
      console.log(`Stream URLs extracted. Spawning ffmpeg to pipe merged Matroska stream to client.`);

      // Spawn ffmpeg to merge on the fly
      const ffmpegArgs = [
        '-y',
        '-i', videoUrl,
        '-i', audioUrl,
        '-c:v', 'copy',
        '-c:a', 'copy',
        '-f', 'matroska',
        '-'
      ];

      const ffmpegProcess = spawn(ffmpegPath || 'ffmpeg', ffmpegArgs);
      ffmpegProcess.stdout.pipe(res);

      ffmpegProcess.stderr.on('data', (data) => {
        const log = data.toString();
        if (log.includes('Error') || log.includes('Failed')) {
          console.error(`ffmpeg merge stream error:`, log);
        }
      });

      req.on('close', () => {
        console.log(`Client closed request during on-the-fly ffmpeg merge. Killing process.`);
        ffmpegProcess.kill();
      });
    });

    req.on('close', () => {
      gChild.kill();
    });
  }
});

// Serve frontend build in production
const frontendBuildPath = path.join(projectRoot, 'dist');
if (fs.existsSync(frontendBuildPath)) {
  app.use(express.static(frontendBuildPath));
  app.get('*splat', (req, res) => {
    res.sendFile(path.join(frontendBuildPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
