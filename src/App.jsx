import React, { useState, useEffect, useRef } from 'react';
import { 
  Download, 
  FolderOpen, 
  FileVideo, 
  Music, 
  AlertCircle, 
  CheckCircle2, 
  Loader2, 
  ListMusic, 
  Check, 
  Search, 
  RefreshCw,
  Clock,
  ArrowRight,
  Sparkles,
  Pause,
  Play,
  Settings,
  X,
  Trash2,
  HelpCircle
} from 'lucide-react';

export default function App() {
  const [status, setStatus] = useState({ status: 'checking', percent: 0 });
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [downloadPath, setDownloadPath] = useState('');
  const [playlistMode, setPlaylistMode] = useState(false);
  
  // Settings & Cookies States
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState('general'); // 'general' | 'cookies'
  const [cookiesText, setCookiesText] = useState('');
  const [cookiesStatus, setCookiesStatus] = useState({ configured: false, preview: 'Not configured' });
  const [savingCookies, setSavingCookies] = useState(false);
  const [isPasswordRequired, setIsPasswordRequired] = useState(false);
  const [modalPassword, setModalPassword] = useState('');
  
  // Media info state
  const [mediaInfo, setMediaInfo] = useState(null); // { type: 'video' | 'playlist', title, thumbnail, formats, entries... }
  const [selectedVideos, setSelectedVideos] = useState([]); // Array of video indexes for playlists
  const [selectedFormat, setSelectedFormat] = useState('bestvideo+bestaudio/best');
  
  // Active download state
  const [downloadProgress, setDownloadProgress] = useState(null);
  const [downloadId, setDownloadId] = useState(null);
  const [toast, setToast] = useState(null);
  
  const progressSource = useRef(null);
  const triggeredDownloads = useRef(new Set());

  // Fetch config and cookies status on load
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch('/api/config');
        const data = await res.json();
        setDownloadPath(data.downloadPath);
        setIsPasswordRequired(!!data.passwordRequired);
      } catch (err) {
        console.error('Failed to fetch config:', err);
      }
    };
    
    const fetchCookiesStatus = async () => {
      try {
        const res = await fetch('/api/cookies');
        const data = await res.json();
        setCookiesStatus({ configured: data.configured, preview: data.preview });
      } catch (err) {
        console.error('Failed to fetch cookies status:', err);
      }
    };

    fetchConfig();
    fetchCookiesStatus();
  }, []);

  const handleSelectFolder = async () => {
    try {
      const res = await fetch('/api/select-folder', { 
        method: 'POST',
        headers: { 'x-settings-password': modalPassword }
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to select folder.');
      }
      if (data.success && data.path) {
        setDownloadPath(data.path);
      }
    } catch (err) {
      console.error('Failed to select folder:', err);
      setToast({ message: err.message, type: 'error' });
    }
  };

  const handleSaveCookies = async () => {
    setSavingCookies(true);
    try {
      const res = await fetch('/api/cookies', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-settings-password': modalPassword
        },
        body: JSON.stringify({ cookiesText })
      });
      const data = await res.json();
      if (data.success) {
        setCookiesStatus({ configured: data.configured, preview: data.preview });
        setToast({ message: cookiesText.trim() ? 'Cookies saved successfully!' : 'Cookies cleared successfully!', type: 'success' });
        if (!cookiesText.trim()) setCookiesText('');
      } else {
        throw new Error(data.error || 'Failed to save cookies.');
      }
    } catch (err) {
      setToast({ message: `Error saving cookies: ${err.message}`, type: 'error' });
    } finally {
      setSavingCookies(false);
    }
  };

  const handleClearCookies = async () => {
    setSavingCookies(true);
    try {
      const res = await fetch('/api/cookies', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-settings-password': modalPassword
        },
        body: JSON.stringify({ cookiesText: '' })
      });
      const data = await res.json();
      if (data.success) {
        setCookiesStatus({ configured: false, preview: 'Not configured' });
        setCookiesText('');
        setToast({ message: 'Cookies cleared successfully!', type: 'success' });
      } else {
        throw new Error(data.error || 'Failed to clear cookies.');
      }
    } catch (err) {
      setToast({ message: `Error clearing cookies: ${err.message}`, type: 'error' });
    } finally {
      setSavingCookies(false);
    }
  };

  // Check setup status of binaries
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        setStatus(data);
        
        if (data.status === 'ready') {
          clearInterval(statusInterval);
        }
      } catch (err) {
        console.error('Failed to check setup status:', err);
      }
    };

    const statusInterval = setInterval(checkStatus, 1500);
    checkStatus();

    return () => {
      clearInterval(statusInterval);
      if (progressSource.current) {
        progressSource.current.close();
      }
    };
  }, []);

  // Format Duration helper (seconds -> hh:mm:ss or mm:ss)
  const formatDuration = (sec) => {
    if (!sec) return '00:00';
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = Math.floor(sec % 60);
    
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Trigger media details fetching
  const handleFetchInfo = async (e) => {
    if (e) e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError(null);
    setMediaInfo(null);

    try {
      const res = await fetch(`/api/info?url=${encodeURIComponent(url.trim())}&playlistMode=${playlistMode}`);
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to extract video info.');
      }
      
      setMediaInfo(data);
      if (data.type === 'playlist') {
        // Select all by default
        setSelectedVideos(data.entries.map(entry => entry.id));
        // Default quality for playlists
        setSelectedFormat('bestvideo+bestaudio/best');
      } else {
        // Set first format (usually highest resolution) as default selected
        if (data.formats && data.formats.length > 0) {
          setSelectedFormat(data.formats[0].formatId);
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Playlist item toggling
  const togglePlaylistItem = (id) => {
    if (selectedVideos.includes(id)) {
      setSelectedVideos(selectedVideos.filter(item => item !== id));
    } else {
      setSelectedVideos([...selectedVideos, id]);
    }
  };

  const toggleSelectAll = () => {
    if (selectedVideos.length === mediaInfo.entries.length) {
      setSelectedVideos([]);
    } else {
      setSelectedVideos(mediaInfo.entries.map(entry => entry.id));
    }
  };

  const triggerBrowserDownload = (fileUrl) => {
    console.log('Triggering direct browser download for URL:', fileUrl);
    const link = document.createElement('a');
    link.href = fileUrl;
    link.setAttribute('download', '');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePauseDownload = async () => {
    if (!downloadId) return;
    try {
      await fetch('/api/download/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ downloadId })
      });
    } catch (err) {
      console.error('Failed to pause download:', err);
    }
  };

  const handleResumeDownload = async () => {
    if (!downloadId) return;
    try {
      await fetch('/api/download/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ downloadId })
      });
    } catch (err) {
      console.error('Failed to resume download:', err);
    }
  };

  // Trigger Download (Video or Audio)
  const startDownload = async (formatOverride = null) => {
    const activeFormat = formatOverride || selectedFormat;
    
    if (mediaInfo.type === 'video') {
      console.log('Single video direct browser download initiated...');
      let ext = 'mp4';
      if (activeFormat === 'bestaudio') ext = 'mp3';
      else {
        const foundFormat = mediaInfo.formats.find(f => f.formatId === activeFormat);
        if (foundFormat) ext = foundFormat.ext;
      }
      
      setLoading(true);
      setToast({ message: 'Request sent! Your native browser download will start shortly...', type: 'info' });
      
      const directUrl = `/api/download-direct?url=${encodeURIComponent(url.trim())}&formatId=${activeFormat}&title=${encodeURIComponent(mediaInfo.title)}&ext=${ext}`;
      triggerBrowserDownload(directUrl);
      
      setTimeout(() => {
        setLoading(false);
      }, 5000);
      return;
    }

    // Playlist download (fallback to folder-based native background download on server)
    const id = Date.now().toString();
    setDownloadId(id);
    setError(null);
    triggeredDownloads.current.clear();
    setToast({ message: 'Playlist downloading started directly to your system Downloads folder...', type: 'info' });

    // Close any existing progress listener
    if (progressSource.current) {
      progressSource.current.close();
    }

    // Connect to Server-Sent Events (SSE) progress listener to monitor completion
    const source = new EventSource(`/api/download/progress/${id}`);
    progressSource.current = source;

    source.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.status === 'completed') {
        setToast({ message: `Playlist download complete! Saved to Downloads.`, type: 'success' });
        source.close();
      }
      if (data.status === 'failed') {
        setToast({ message: 'Playlist download failed!', type: 'error' });
        source.close();
      }
    };

    source.onerror = (err) => {
      console.error('SSE Error:', err);
      source.close();
    };

    try {
      let endpoint = '/api/download-playlist';
      const filteredVideos = mediaInfo.entries.filter(entry => selectedVideos.includes(entry.id));
      
      if (filteredVideos.length === 0) {
        setToast({ message: 'Please select at least one video to download.', type: 'error' });
        if (progressSource.current) progressSource.current.close();
        return;
      }

      const payload = {
        playlistUrl: url.trim(),
        selectedVideos: filteredVideos,
        formatId: activeFormat,
        downloadId: id,
        playlistTitle: mediaInfo.title
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start download');
      }

    } catch (err) {
      setToast({ message: `Error: ${err.message}`, type: 'error' });
      if (progressSource.current) {
        progressSource.current.close();
      }
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#030712] relative overflow-hidden bg-grid-pattern">
      {/* Background ambient glows */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] aspect-square rounded-full bg-purple-900/10 blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] aspect-square rounded-full bg-pink-900/10 blur-[120px] pointer-events-none"></div>

      {/* Header */}
      <header className="glass-panel sticky top-0 z-50 w-full px-4 sm:px-6 py-4 flex items-center justify-between bg-gray-950/80 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 to-pink-500 shadow-lg shadow-purple-500/30">
            <Download className="w-5 h-5 text-white" />
            <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-pink-500"></span>
            </span>
          </div>
          <span className="text-2xl font-extrabold tracking-tight font-outfit text-white">
            Nex<span className="gradient-text">Stream</span>
          </span>
        </div>

        <button
          id="btn-open-settings"
          type="button"
          onClick={() => setIsSettingsOpen(true)}
          className="flex items-center justify-center p-2.5 rounded-xl bg-gray-900 border border-gray-800 text-gray-400 hover:text-white hover:bg-gray-800 transition-all cursor-pointer shadow-md hover:rotate-90 duration-500"
          title="Settings"
        >
          <Settings className="w-5 h-5" />
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-grow max-w-5xl w-full mx-auto px-4 py-8">
        
        {/* Step 1: Engine setup downloading screen */}
        {status.status === 'downloading' && (
          <div className="glass-panel rounded-2xl p-8 max-w-lg mx-auto text-center my-12 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 to-pink-500"></div>
            <Loader2 className="w-12 h-12 text-purple-500 animate-spin mx-auto mb-6" />
            <h1 className="text-xl font-semibold mb-2">Setting Up Downloading Core</h1>
            <p className="text-gray-400 text-sm mb-6">
              Please wait while we automatically download and configure the latest downloader engine (yt-dlp) for your system. This happens only once!
            </p>
            <div className="w-full bg-gray-900 rounded-full h-3 mb-2 overflow-hidden border border-gray-800">
              <div 
                className="h-full bg-gradient-to-r from-purple-600 to-pink-500 rounded-full transition-all duration-300"
                style={{ width: `${status.percent}%` }}
              ></div>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>Downloading components...</span>
              <span className="font-semibold text-purple-400">{status.percent}%</span>
            </div>
          </div>
        )}

        {/* Step 2: Main application UI */}
        {(status.status === 'ready' || status.status === 'checking') && (
          <div className="space-y-8 animate-fade-in">
            {/* Jumbotron Title */}
            <div className="text-center py-6 space-y-3">
              <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-purple-950/40 border border-purple-800/50 text-xs font-semibold text-purple-300">
                <Sparkles className="w-3.5 h-3.5 text-pink-400" />
                <span>All video formats and full playlists supported</span>
              </div>
              <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight font-outfit text-white">
                Download Any Video in <span className="gradient-text">Max Quality</span>
              </h1>
              <p className="text-gray-400 max-w-xl mx-auto text-sm md:text-base">
                Paste your YouTube video, channel, or playlist link below to extract direct download formats in 1080p, 4K, or high-bitrate MP3 audio.
              </p>
            </div>

             {/* Input Form */}
            <form onSubmit={handleFetchInfo} className="max-w-3xl mx-auto space-y-4">
              <div className="flex flex-col md:flex-row gap-3 p-2 rounded-2xl glass-panel">
                <div className="relative flex-grow flex items-center">
                  <svg viewBox="0 0 24 24" className="absolute left-4 w-5 h-5 text-gray-400 fill-current">
                    <path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.11C19.518 3.545 12 3.545 12 3.545s-7.518 0-9.388.507a3.003 3.003 0 0 0-2.11 2.11C0 8.033 0 12 0 12s0 3.967.502 5.837a3.003 3.003 0 0 0 2.11 2.11c1.87.507 9.388.507 9.388.507s7.518 0 9.388-.507a3.003 3.003 0 0 0 2.11-2.11C24 15.967 24 12 24 12s0-3.967-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                  </svg>
                  <input
                    id="input-video-url"
                    type="text"
                    placeholder="Paste YouTube video or playlist link here..."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="w-full pl-12 pr-4 py-3.5 bg-transparent border-0 text-white placeholder-gray-500 focus:ring-0 focus:outline-none text-sm"
                  />
                  {url && (
                    <button
                      type="button"
                      onClick={() => setUrl('')}
                      className="absolute right-3 text-xs text-gray-400 hover:text-white px-2 py-1 bg-gray-800 rounded-md"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <button
                  id="btn-fetch-info"
                  type="submit"
                  disabled={loading || !url.trim()}
                  className="flex items-center justify-center space-x-2 px-6 py-3.5 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-500 hover:to-pink-400 text-white rounded-xl font-semibold shadow-lg shadow-purple-500/25 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed text-sm w-full md:w-auto"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Parsing...</span>
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4" />
                      <span>Analyze URL</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 px-2 text-xs md:text-sm text-gray-400">
                {/* Playlist Mode checkbox */}
                <label className="flex items-center space-x-2.5 cursor-pointer select-none text-gray-300 font-medium hover:text-white transition-colors">
                  <input
                    id="checkbox-playlist-mode"
                    type="checkbox"
                    checked={playlistMode}
                    onChange={(e) => setPlaylistMode(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-700 bg-gray-900 text-purple-600 focus:ring-purple-500 focus:ring-offset-gray-950"
                  />
                  <span>Puri Playlist load karein (Playlist Mode)</span>
                </label>


              </div>
            </form>

            {/* Error Message */}
            {error && (
              <div className="max-w-3xl mx-auto p-4 rounded-xl bg-red-950/20 border border-red-900/50 flex items-start space-x-3 text-red-200">
                <AlertCircle className="w-5 h-5 mt-0.5 text-red-500 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-semibold text-red-400">Error Encountered</p>
                  <p className="text-gray-300 mt-0.5">{error}</p>
                </div>
              </div>
            )}



            {/* Results Section */}
            {mediaInfo && (
              <div className="max-w-3xl mx-auto animate-slide-up space-y-6">
                
                {/* Result 1: Single Video Metadata & Download Formats */}
                {mediaInfo.type === 'video' && (
                  <div className="glass-panel rounded-2xl overflow-hidden shadow-2xl">
                    <div className="flex flex-col md:flex-row">
                      {/* Image Thumbnail */}
                      <div className="md:w-5/12 relative aspect-video bg-gray-950 flex items-center justify-center">
                        {mediaInfo.thumbnail ? (
                          <img
                            src={mediaInfo.thumbnail}
                            alt={mediaInfo.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <FileVideo className="w-12 h-12 text-gray-700" />
                        )}
                        <span className="absolute bottom-3 right-3 px-2 py-1 bg-black/80 text-[10px] font-semibold text-white rounded">
                          {formatDuration(mediaInfo.duration)}
                        </span>
                      </div>

                      {/* Content details */}
                      <div className="p-6 md:w-7/12 flex flex-col justify-between">
                        <div>
                          <h2 className="text-lg md:text-xl font-bold text-white line-clamp-2 leading-snug">
                            {mediaInfo.title}
                          </h2>
                          <p className="text-sm text-purple-400 font-medium mt-1">
                            {mediaInfo.uploader}
                          </p>
                        </div>

                        <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:space-x-2">
                          <label className="text-xs text-gray-400 font-medium">Select Resolution:</label>
                          <select
                            id="select-format"
                            value={selectedFormat}
                            onChange={(e) => setSelectedFormat(e.target.value)}
                            className="bg-gray-900 text-gray-200 border border-gray-800 text-xs rounded-lg px-3 py-1.5 focus:ring-purple-500 focus:border-purple-500 w-full sm:w-auto cursor-pointer"
                          >
                            {mediaInfo.formats.map((fmt) => (
                              <option key={fmt.formatId} value={fmt.formatId}>
                                {fmt.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="mt-6 flex flex-col sm:flex-row gap-3">
                          <button
                            id="btn-download-selected"
                            onClick={() => startDownload()}
                            className="flex-grow flex items-center justify-center space-x-2 px-4 py-3.5 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-500 hover:to-pink-400 text-white text-sm font-bold rounded-xl shadow-lg transition-all w-full sm:w-auto"
                          >
                            <Download className="w-4 h-4" />
                            <span>Download Selected</span>
                          </button>
                          
                          <button
                            id="btn-download-audio"
                            onClick={() => startDownload('bestaudio')}
                            title="Download Audio Only (MP3)"
                            className="px-4 py-3.5 bg-gray-800 hover:bg-gray-700 text-gray-200 hover:text-white rounded-xl border border-gray-700 transition-all flex items-center justify-center w-full sm:w-auto sm:px-5"
                          >
                            <Music className="w-4 h-4 mr-2 sm:mr-0" />
                            <span className="sm:hidden text-sm font-bold">Download Audio Only (MP3)</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Result 2: Playlist Details & Video Checklist */}
                {mediaInfo.type === 'playlist' && (
                  <div className="glass-panel rounded-2xl overflow-hidden shadow-2xl p-4 sm:p-6 space-y-6">
                    {/* Header */}
                    <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b border-gray-800 pb-5">
                      <div className="flex items-start space-x-3">
                        <div className="w-10 h-10 rounded-xl bg-purple-900/40 border border-purple-800/40 flex items-center justify-center text-purple-400 mt-0.5 flex-shrink-0">
                          <ListMusic className="w-5 h-5" />
                        </div>
                        <div>
                          <h2 className="text-lg sm:text-xl font-bold text-white leading-tight line-clamp-2">
                            {mediaInfo.title}
                          </h2>
                          <p className="text-xs text-gray-400 mt-1">
                            Playlist by <span className="text-purple-400">{mediaInfo.uploader}</span> • {mediaInfo.videoCount} videos
                          </p>
                        </div>
                      </div>
                      
                      {/* Quality Select */}
                      <div className="flex items-center justify-between sm:justify-start space-x-2 bg-gray-950 p-2 rounded-lg border border-gray-800 w-full lg:w-auto">
                        <span className="text-xs text-gray-400 font-semibold px-2">Quality:</span>
                        <select
                          id="playlist-quality-select"
                          value={selectedFormat}
                          onChange={(e) => setSelectedFormat(e.target.value)}
                          className="bg-transparent text-gray-200 border-0 text-xs rounded focus:ring-0 focus:outline-none font-semibold cursor-pointer py-1"
                        >
                          <option value="bestvideo+bestaudio/best" className="bg-gray-900">Highest (HD)</option>
                          <option value="bestaudio" className="bg-gray-900">Audio Only (MP3)</option>
                          <option value="137+bestaudio/best" className="bg-gray-900">1080p MP4</option>
                          <option value="136+bestaudio/best" className="bg-gray-900">720p MP4</option>
                          <option value="134+bestaudio/best" className="bg-gray-900">360p MP4</option>
                        </select>
                      </div>
                    </div>

                    {/* Playlist Items List */}
                    <div className="space-y-2 max-h-[350px] overflow-y-auto pr-2">
                      <div className="flex justify-between items-center px-4 py-2 border-b border-gray-900 text-xs text-gray-500 font-medium">
                        <button
                          type="button"
                          onClick={toggleSelectAll}
                          className="flex items-center space-x-2 hover:text-white"
                        >
                          <span className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${selectedVideos.length === mediaInfo.entries.length ? 'bg-purple-600 border-purple-500' : 'border-gray-700 bg-transparent'}`}>
                            {selectedVideos.length === mediaInfo.entries.length && <Check className="w-2.5 h-2.5 text-white" />}
                          </span>
                          <span>Select All ({mediaInfo.entries.length})</span>
                        </button>
                        <span>Duration</span>
                      </div>
                      
                      {mediaInfo.entries.map((entry, index) => {
                        const isChecked = selectedVideos.includes(entry.id);
                        return (
                          <div
                            key={entry.id}
                            onClick={() => togglePlaylistItem(entry.id)}
                            className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer ${isChecked ? 'bg-purple-950/20 border-purple-800/40 hover:bg-purple-950/30' : 'bg-transparent border-transparent hover:bg-gray-900/40 hover:border-gray-800/40'}`}
                          >
                            <div className="flex items-start space-x-3 min-w-0 pr-4">
                              <span className={`w-5 h-5 rounded-lg border flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${isChecked ? 'bg-purple-600 border-purple-500' : 'border-gray-700'}`}>
                                {isChecked && <Check className="w-3.5 h-3.5 text-white" />}
                              </span>
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-white line-clamp-1 leading-snug">
                                  {index + 1}. {entry.title}
                                </p>
                                <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                                  {entry.uploader}
                                </p>
                              </div>
                            </div>
                            <span className="text-xs font-semibold text-gray-400 bg-gray-900 px-2 py-1 rounded flex-shrink-0">
                              {formatDuration(entry.duration)}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Submit Playlist button */}
                    <div className="flex flex-col sm:flex-row justify-between items-center gap-4 border-t border-gray-800 pt-5">
                      <p className="text-xs text-gray-400">
                        Selected <span className="text-purple-400 font-bold">{selectedVideos.length}</span> of <span className="font-semibold text-white">{mediaInfo.entries.length}</span> videos
                      </p>
                      
                      <button
                        id="btn-download-playlist"
                        onClick={() => startDownload()}
                        disabled={selectedVideos.length === 0}
                        className="w-full sm:w-auto flex items-center justify-center space-x-2 px-6 py-3.5 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-500 hover:to-pink-400 text-white text-sm font-bold rounded-xl shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Download className="w-4 h-4" />
                        <span>Download Selected Videos</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="py-8 text-center text-xs text-gray-600 border-t border-gray-900 mt-12 bg-gray-950/10">
        <p>NexStream Downloader client • By ARUN KUMAR • All rights reserved © 2026</p>
        <p>BSS EK GAANE KE LIEE </p>
        <p>Tu Hi Meri Shab Hai • Emraan Hashmi</p>
      </footer>

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center space-x-3 px-5 py-4 rounded-xl shadow-2xl border transition-all duration-300 animate-slide-up ${
          toast.type === 'success' 
            ? 'bg-emerald-950/90 border-emerald-800 text-emerald-300' 
            : toast.type === 'error' 
              ? 'bg-rose-950/90 border-rose-800 text-rose-300' 
              : 'bg-purple-950/90 border-purple-800 text-purple-300'
        }`}>
          <div className="flex-grow text-sm font-semibold pr-2">
            {toast.message}
          </div>
          <button 
            type="button"
            onClick={() => setToast(null)}
            className="text-xs hover:text-white transition-colors px-2 py-1 rounded bg-black/20"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
          <div className="glass-panel max-w-lg w-full rounded-2xl overflow-hidden shadow-2xl relative flex flex-col max-h-[85vh] border border-gray-800/80 animate-scale-up">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-gray-800/60 bg-gray-950/40">
              <div className="flex items-center space-x-2">
                <Settings className="w-5 h-5 text-purple-400 animate-pulse" />
                <h2 className="text-lg font-bold text-white font-outfit">Configuration & Settings</h2>
              </div>
              <button
                id="btn-close-settings"
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="p-1.5 rounded-lg bg-gray-900 hover:bg-gray-800 border border-gray-800 text-gray-400 hover:text-white cursor-pointer transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Tabs */}
            <div className="flex border-b border-gray-800/40 bg-gray-950/20 px-4">
              <button
                type="button"
                onClick={() => setSettingsTab('general')}
                className={`py-3 px-4 text-xs font-bold uppercase tracking-wider border-b-2 cursor-pointer transition-all ${
                  settingsTab === 'general'
                    ? 'border-purple-500 text-purple-400'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                General Settings
              </button>
              <button
                type="button"
                onClick={() => setSettingsTab('cookies')}
                className={`py-3 px-4 text-xs font-bold uppercase tracking-wider border-b-2 cursor-pointer transition-all ${
                  settingsTab === 'cookies'
                    ? 'border-purple-500 text-purple-400'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                YouTube Cookies
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 flex-grow overflow-y-auto space-y-5">
              
              {isPasswordRequired && (
                <div className="space-y-1.5 p-4 rounded-xl bg-gray-950 border border-gray-800/80 animate-fade-in mb-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Settings Password</label>
                  <input
                    type="password"
                    placeholder="Enter settings password..."
                    value={modalPassword}
                    onChange={(e) => setModalPassword(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-800 focus:border-purple-500 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-purple-500/20"
                  />
                  <p className="text-[10px] text-gray-500">
                    Administrator password required to modify global configurations.
                  </p>
                </div>
              )}

              {settingsTab === 'general' && (
                <div className="space-y-4 animate-fade-in">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Downloads Directory</label>
                    <p className="text-xs text-gray-500">
                      Specify the folder on the server where downloaded videos/playlists will be saved.
                    </p>
                    <div className="flex gap-2 items-center mt-1">
                      <input
                        type="text"
                        readOnly
                        value={downloadPath || 'Not Configured'}
                        className="flex-grow bg-gray-950/50 border border-gray-800 rounded-xl px-3 py-2.5 text-xs text-gray-300 select-all focus:outline-none"
                      />
                      {/* Windows Directory Dialog trigger */}
                      <button
                        type="button"
                        onClick={handleSelectFolder}
                        className="px-3.5 py-2.5 bg-gray-900 border border-gray-800 hover:border-gray-700 text-gray-200 hover:text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                        title="Choose Folder dialog works only on Windows"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        <span>Select</span>
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-600 italic">
                      Note: Folder picker works on Windows local server only. For hosting platforms like Render, the default project download path is used.
                    </p>
                  </div>
                </div>
              )}

              {settingsTab === 'cookies' && (
                <div className="space-y-4 animate-fade-in">
                  <div className="p-3.5 rounded-xl bg-purple-950/15 border border-purple-900/30 text-xs text-purple-300 flex items-start gap-2.5 leading-relaxed">
                    <HelpCircle className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-purple-200 mb-1">Bypass "Confirm you're not a bot" Blocking</p>
                      <p className="mb-2">
                        YouTube rate-limits and blocks server hosting IPs (like Render). Pasting your session cookies forces yt-dlp to authenticate as a browser.
                      </p>
                      <ol className="list-decimal pl-4 space-y-1 text-purple-400/80 font-medium">
                        <li>Install the Chrome/Firefox extension <strong>"Get cookies.txt LOCALLY"</strong>.</li>
                        <li>Go to YouTube, login, click the extension icon and copy the cookies content in <strong>Netscape</strong> format.</li>
                        <li>Paste that plain text contents below and save.</li>
                      </ol>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Paste Netscape Cookies Text</label>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        cookiesStatus.configured 
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/30' 
                          : 'bg-rose-950 text-rose-400 border border-rose-800/30'
                      }`}>
                        {cookiesStatus.preview}
                      </span>
                    </div>
                    
                    <textarea
                      value={cookiesText}
                      onChange={(e) => setCookiesText(e.target.value)}
                      placeholder="# Netscape HTTP Cookie File&#10;.youtube.com&#9;TRUE&#9;/&#9;TRUE&#9;1735680000&#9;SID&#9;..."
                      className="w-full h-36 bg-gray-950/60 border border-gray-800/80 focus:border-purple-500 rounded-xl p-3 text-[11px] font-mono text-gray-300 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-purple-500/20"
                    />
                  </div>

                  <div className="flex gap-2 justify-end">
                    {cookiesStatus.configured && (
                      <button
                        type="button"
                        onClick={handleClearCookies}
                        disabled={savingCookies}
                        className="px-4 py-2.5 bg-rose-950/40 hover:bg-rose-950/70 border border-rose-900/50 text-rose-200 hover:text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete Cookies</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleSaveCookies}
                      disabled={savingCookies}
                      className="px-4 py-2.5 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-500 hover:to-pink-400 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                    >
                      {savingCookies ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Saving...</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Save Cookies</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
