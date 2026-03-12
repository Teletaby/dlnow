// DLNow Frontend Application
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // DOM Elements
  const form = $('#downloadForm');
  const urlInput = $('#urlInput');
  const fetchBtn = $('#fetchBtn');
  const btnText = fetchBtn.querySelector('.btn-text');
  const btnLoader = fetchBtn.querySelector('.btn-loader');
  const errorMessage = $('#errorMessage');
  const infoCard = $('#infoCard');
  const progressCard = $('#progressCard');
  const completeCard = $('#completeCard');
  const downloadBtn = $('#downloadBtn');
  const newDownloadBtn = $('#newDownloadBtn');
  const saveFileBtn = $('#saveFileBtn');

  // Captcha elements
  const captchaCard = $('#captchaCard');
  const captchaImage = $('#captchaImage');
  const captchaInput = $('#captchaInput');
  const refreshCaptchaBtn = $('#refreshCaptcha');
  const verifyCaptchaBtn = $('#verifyCaptchaBtn');

  let currentVideoInfo = null;
  let selectedFormat = null;
  let pollInterval = null;
  let captchaToken = null;

  // —— Event Listeners ——

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await showCaptchaChallenge();
  });

  downloadBtn.addEventListener('click', async () => {
    if (!selectedFormat) return;
    await startDownload();
  });

  newDownloadBtn.addEventListener('click', () => {
    resetAll();
  });

  refreshCaptchaBtn.addEventListener('click', async () => {
    await loadCaptcha();
  });

  verifyCaptchaBtn.addEventListener('click', async () => {
    await verifyAndFetch();
  });

  captchaInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await verifyAndFetch();
    }
  });

  // Auto-paste detection — show captcha instead of auto-fetching
  urlInput.addEventListener('paste', () => {
    setTimeout(() => {
      const val = urlInput.value.trim();
      if (val && isValidUrl(val)) {
        showCaptchaChallenge();
      }
    }, 100);
  });

  // —— Functions ——

  function isValidUrl(str) {
    try {
      const url = new URL(str);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function showError(msg) {
    errorMessage.textContent = msg;
    errorMessage.hidden = false;
    setTimeout(() => { errorMessage.hidden = true; }, 8000);
  }

  function hideError() {
    errorMessage.hidden = true;
  }

  function setLoading(loading) {
    fetchBtn.disabled = loading;
    btnText.hidden = loading;
    btnLoader.hidden = !loading;
    urlInput.disabled = loading;
  }

  function formatDuration(seconds) {
    if (!seconds) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }

  function resetAll() {
    urlInput.value = '';
    urlInput.disabled = false;
    fetchBtn.disabled = false;
    selectedFormat = null;
    currentVideoInfo = null;
    captchaToken = null;
    captchaInput.value = '';
    captchaCard.hidden = true;
    infoCard.hidden = true;
    progressCard.hidden = true;
    completeCard.hidden = true;
    hideError();
    if (pollInterval) clearInterval(pollInterval);
    urlInput.focus();
  }

  // —— Captcha Flow ——

  async function loadCaptcha() {
    try {
      captchaImage.innerHTML = '<div style="padding:20px;color:var(--gray-400)">Loading...</div>';
      const res = await fetch('/api/captcha');
      const data = await res.json();
      captchaToken = data.token;
      captchaImage.innerHTML = data.svg;
      captchaInput.value = '';
      captchaInput.focus();
    } catch (err) {
      captchaImage.innerHTML = '<div style="padding:20px;color:var(--error)">Failed to load. Click refresh.</div>';
    }
  }

  async function showCaptchaChallenge() {
    const url = urlInput.value.trim();
    if (!url) {
      showError('Please enter a URL.');
      return;
    }
    if (!isValidUrl(url)) {
      showError('Please enter a valid URL.');
      return;
    }

    hideError();
    infoCard.hidden = true;
    progressCard.hidden = true;
    completeCard.hidden = true;

    // Show captcha
    captchaCard.hidden = false;
    captchaCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    await loadCaptcha();
  }

  async function verifyAndFetch() {
    const answer = captchaInput.value.trim();
    if (!answer) {
      showError('Please enter the number shown in the image.');
      return;
    }
    if (!captchaToken) {
      showError('Captcha error. Please refresh and try again.');
      return;
    }
    hideError();
    await fetchVideoInfo(captchaToken, answer);
  }

  async function fetchVideoInfo(token, answer) {
    const url = urlInput.value.trim();
    if (!url) return;

    setLoading(true);
    captchaCard.hidden = true;

    try {
      const res = await fetch('/api/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, captchaToken: token, captchaAnswer: answer }),
      });

      const data = await res.json();

      if (!res.ok) {
        // If captcha failed, show a new captcha
        if (data.captchaFailed) {
          captchaCard.hidden = false;
          await loadCaptcha();
        }
        showError(data.error || 'Something went wrong.');
        return;
      }

      currentVideoInfo = data;
      renderInfoCard(data);
    } catch (err) {
      showError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  function renderInfoCard(data) {
    // Thumbnail
    const thumbnail = $('#thumbnail');
    if (data.thumbnail) {
      thumbnail.src = data.thumbnail;
      thumbnail.alt = data.title;
    } else {
      thumbnail.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" fill="%23334155"><rect width="320" height="180" fill="%231e293b"/><text x="160" y="95" text-anchor="middle" fill="%2364748b" font-size="14" font-family="sans-serif">No Thumbnail</text></svg>');
    }

    // Duration
    const duration = $('#duration');
    if (data.duration) {
      duration.textContent = formatDuration(data.duration);
      duration.style.display = 'block';
    } else {
      duration.style.display = 'none';
    }

    // Platform
    $('#platformBadge').textContent = data.platform;

    // Title and uploader
    $('#videoTitle').textContent = data.title;
    $('#uploader').textContent = data.uploader;

    // Formats
    const formatGrid = $('#formatGrid');
    formatGrid.innerHTML = '';
    selectedFormat = null;
    downloadBtn.disabled = true;

    if (data.formats && data.formats.length) {
      // Group by type
      const videoFormats = data.formats.filter(f => f.type === 'video');
      const audioFormats = data.formats.filter(f => f.type === 'audio');

      const allFormats = [...videoFormats, ...audioFormats];

      allFormats.forEach((fmt, i) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'format-option';

        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'format';
        input.id = `format-${i}`;
        input.value = fmt.id;

        const label = document.createElement('label');
        label.htmlFor = `format-${i}`;
        label.textContent = fmt.label;

        input.addEventListener('change', () => {
          selectedFormat = fmt.id;
          downloadBtn.disabled = false;
        });

        wrapper.appendChild(input);
        wrapper.appendChild(label);
        formatGrid.appendChild(wrapper);
      });

      // Auto-select first
      const firstInput = formatGrid.querySelector('input');
      if (firstInput) {
        firstInput.checked = true;
        selectedFormat = firstInput.value;
        downloadBtn.disabled = false;
      }
    }

    infoCard.hidden = false;
    infoCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function startDownload() {
    const url = urlInput.value.trim();
    if (!url || !selectedFormat) return;

    infoCard.hidden = true;
    progressCard.hidden = false;
    completeCard.hidden = true;

    $('#progressBar').style.width = '0%';
    $('#progressPercent').textContent = '0%';
    $('#progressText').textContent = 'Starting download...';

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, format: selectedFormat }),
      });

      const data = await res.json();

      if (!res.ok) {
        progressCard.hidden = true;
        showError(data.error || 'Download failed.');
        infoCard.hidden = false;
        return;
      }

      // Serverless mode (Vercel): direct URL returned
      if (data.url) {
        // Show progress while we fetch the file as a blob (cross-origin download fix)
        $('#progressText').textContent = 'Fetching file from CDN...';
        $('#progressBar').style.width = '50%';
        $('#progressPercent').textContent = '...';

        try {
          const fileRes = await fetch(data.url);
          if (!fileRes.ok) throw new Error('CDN fetch failed');

          const contentLength = fileRes.headers.get('Content-Length');
          const total = contentLength ? parseInt(contentLength, 10) : 0;
          let loaded = 0;

          // Stream the response to track progress
          const reader = fileRes.body.getReader();
          const chunks = [];

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            loaded += value.length;
            if (total > 0) {
              const pct = Math.round((loaded / total) * 100);
              $('#progressBar').style.width = pct + '%';
              $('#progressPercent').textContent = pct + '%';
              $('#progressText').textContent = `Downloading... ${formatSize(loaded)} / ${formatSize(total)}`;
            } else {
              $('#progressText').textContent = `Downloading... ${formatSize(loaded)}`;
            }
          }

          // Create blob and trigger download
          const blob = new Blob(chunks);
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = data.filename || 'download.mp4';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);

          progressCard.hidden = true;
          completeCard.hidden = false;
          // Set save button to blob URL in case they want to click again
          saveFileBtn.href = blobUrl;
          saveFileBtn.removeAttribute('target');
          saveFileBtn.removeAttribute('rel');
          saveFileBtn.setAttribute('download', data.filename || 'download.mp4');
          $('.complete-subtitle').textContent = `Your file (${formatSize(loaded)}) has been downloaded!`;
        } catch (blobErr) {
          // Fallback: just open the URL in a new tab  
          progressCard.hidden = true;
          completeCard.hidden = false;
          saveFileBtn.href = data.url;
          saveFileBtn.setAttribute('target', '_blank');
          saveFileBtn.setAttribute('rel', 'noopener');
          if (data.filename) saveFileBtn.setAttribute('download', data.filename);
          $('.complete-subtitle').textContent = 'Click below to open your file. Use right-click → Save As to download.';
        }
        return;
      }

      // Server mode (Express): poll for status
      if (data.jobId) {
        pollStatus(data.jobId);
        return;
      }

      progressCard.hidden = true;
      showError('Unexpected server response.');
      infoCard.hidden = false;
    } catch (err) {
      progressCard.hidden = true;
      showError('Network error. Please try again.');
      infoCard.hidden = false;
    }
  }

  function pollStatus(jobId) {
    if (pollInterval) clearInterval(pollInterval);

    pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/status/${jobId}`);
        const data = await res.json();

        if (data.status === 'processing') {
          const pct = Math.round(data.progress || 0);
          $('#progressBar').style.width = pct + '%';
          $('#progressPercent').textContent = pct + '%';
          $('#progressText').textContent = pct > 0 ? `Downloading... ${pct}%` : 'Processing...';
        } else if (data.status === 'complete') {
          clearInterval(pollInterval);
          pollInterval = null;

          $('#progressBar').style.width = '100%';
          $('#progressPercent').textContent = '100%';

          setTimeout(() => {
            progressCard.hidden = true;
            completeCard.hidden = false;

            saveFileBtn.href = `/api/download/${jobId}`;
            if (data.size) {
              $('.complete-subtitle').textContent = `Your file (${formatSize(data.size)}) is ready. Click the button below to save it.`;
            }
          }, 500);
        } else if (data.status === 'error') {
          clearInterval(pollInterval);
          pollInterval = null;
          progressCard.hidden = true;
          showError(data.error || 'Download failed. Please try again.');
          infoCard.hidden = false;
        }
      } catch (err) {
        // Network error, keep trying
      }
    }, 1000);
  }

  // Smooth scroll for anchor links (exclude action buttons like save)
  $$('a[href^="#"]').forEach(link => {
    if (link.id === 'saveFileBtn') return;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.querySelector(link.getAttribute('href'));
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // Focus input on load
  urlInput.focus();
})();
