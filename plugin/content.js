let currentVideoId = null;
let subtitleDisplayElement = null;
let videoElement = null;
let customSubtitles = [];
let lastUrl = window.location.href;

let srtUploadButtonWrapper = null;
let srtUploadButton = null;
let fileInputForUpload = null;
let uploadStatusElement = null;
let isDraggingOverButton = false;
let actionsObserver = null;

let currentSubtitleStyles = {
  position: 'absolute',
  bottom: '60px',
  left: '50%',
  transform: 'translateX(-50%)',
  backgroundColor: 'rgba(8, 8, 8, 0.75)',
  color: 'white',
  padding: '8px 15px',
  borderRadius: '4px',
  textAlign: 'center',
  fontSize: '2.0em',
  zIndex: '2147483647',
  pointerEvents: 'none',
  maxWidth: '80%',
  visibility: 'hidden',
  whiteSpace: 'pre-wrap',
  lineHeight: '1.4',
  textShadow: '1px 1px 2px black, 0 0 1px black, 0 0 1px black'
};

function parseSRT(srtContent) {
  const subs = [];
  if (!srtContent || typeof srtContent !== 'string') {
    console.warn("Custom SRT: Invalid SRT content for parsing.");
    return subs;
  }
  
  const blocks = srtContent.trim().replace(/\r/g, '').split('\n\n');
  
  blocks.forEach(block => {
    const lines = block.split('\n');
    if (lines.length < 2) return;

    let timeLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) {
        timeLineIndex = i;
        break;
      }
    }

    if (timeLineIndex === -1) return;

    const timeMatch = lines[timeLineIndex].match(/(\d{1,2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{3})/);
    if (timeMatch) {
      const startTime = timeToSeconds(timeMatch[1]);
      const endTime = timeToSeconds(timeMatch[2]);
      const text = lines.slice(timeLineIndex + 1).join('\n').trim();
      
      if (text) {
        subs.push({ startTime, endTime, text });
      }
    }
  });
  
  return subs;
}

function timeToSeconds(timeStr) {
  const parts = timeStr.replace(',', '.').split(/[:.]/);
  return parseInt(parts[0], 10) * 3600 +
         parseInt(parts[1], 10) * 60 +
         parseInt(parts[2], 10) +
         (parts[3] ? parseInt(parts[3], 10) / 1000 : 0);
}

function applyStylesToDisplayElement(styles) {
  if (subtitleDisplayElement) {
    const newStyles = { ...currentSubtitleStyles, ...styles };
    currentSubtitleStyles = newStyles;
    
    Object.assign(subtitleDisplayElement.style, newStyles);
    
    if (styles.visibility) {
        subtitleDisplayElement.style.visibility = styles.visibility;
    }
  }
}

async function setupSubtitleDisplay() {
  try {
    const data = await chrome.storage.local.get('subtitleStyles');
    if (data.subtitleStyles) {
        currentSubtitleStyles = { ...currentSubtitleStyles, ...data.subtitleStyles };
    }
  } catch (e) {
    console.warn("Custom SRT: Could not load subtitle styles from storage.", e);
  }

  const player = document.querySelector('#movie_player');
  if (!player) {
    console.warn("Custom SRT: YouTube player element (#movie_player) not found.");
    return;
  }

  subtitleDisplayElement = document.getElementById('custom-srt-display');
  if (!subtitleDisplayElement) {
    subtitleDisplayElement = document.createElement('div');
    subtitleDisplayElement.id = 'custom-srt-display';
    player.appendChild(subtitleDisplayElement);
  } else if (subtitleDisplayElement.parentNode !== player) {
    player.appendChild(subtitleDisplayElement);
  }
  
  Object.assign(subtitleDisplayElement.style, currentSubtitleStyles);
}

function updateSubtitles() {
  if (!videoElement || !videoElement.isConnected) {
    attachVideoListeners();
    if (!videoElement) {
      if (subtitleDisplayElement) subtitleDisplayElement.style.visibility = 'hidden';
      return;
    }
  }

  if (customSubtitles.length === 0 || !subtitleDisplayElement) {
    if (subtitleDisplayElement) subtitleDisplayElement.style.visibility = 'hidden';
    return;
  }

  const currentTime = videoElement.currentTime;
  let currentSub = null;

  for (const sub of customSubtitles) {
    if (currentTime >= sub.startTime && currentTime <= sub.endTime) {
      currentSub = sub;
      break;
    }
  }

  if (currentSub) {
    subtitleDisplayElement.innerHTML = currentSub.text.replace(/\n/g, '<br>');
    subtitleDisplayElement.style.visibility = 'visible';
  } else {
    subtitleDisplayElement.style.visibility = 'hidden';
    subtitleDisplayElement.innerHTML = '';
  }
}

function attachVideoListeners() {
    if (videoElement) {
        videoElement.removeEventListener('timeupdate', updateSubtitles);
        videoElement.removeEventListener('loadedmetadata', handleVideoMetadataLoaded);
        videoElement.removeEventListener('seeked', updateSubtitles);
        videoElement.removeEventListener('play', updateSubtitles);
        videoElement.removeEventListener('pause', updateSubtitles);
    }

    videoElement = document.querySelector('video.html5-main-video');
    if (videoElement) {
        videoElement.addEventListener('timeupdate', updateSubtitles);
        videoElement.addEventListener('loadedmetadata', handleVideoMetadataLoaded);
        videoElement.addEventListener('seeked', updateSubtitles);
        videoElement.addEventListener('play', updateSubtitles);
        videoElement.addEventListener('pause', updateSubtitles);
        if (videoElement.readyState >= 1) {
             handleVideoMetadataLoaded();
        }
    }
}

function handleVideoMetadataLoaded() {
    updateSubtitles();
}

function getVideoIdFromUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    if (url.hostname === "www.youtube.com" && url.pathname === "/watch") {
      return url.searchParams.get('v');
    }
    return null;
  } catch (e) {
    return null;
  }
}

function checkForVideoChangeAndTriggerActions() {
  const newVideoId = getVideoIdFromUrl(window.location.href);

  if (newVideoId && newVideoId !== currentVideoId) {
    currentVideoId = newVideoId;
    customSubtitles = [];
    if (subtitleDisplayElement) {
        subtitleDisplayElement.innerHTML = '';
        subtitleDisplayElement.style.visibility = 'hidden';
    }

    attachVideoListeners();

    chrome.runtime.sendMessage({ type: "REQUEST_AUTO_LOAD_SRT_FOR_VIDEO_ID", videoId: currentVideoId })
      .then(response => {
        if (!response) {
            console.warn(`Custom SRT: No response from background for auto-load (video ID: ${currentVideoId}).`);
            return;
        }
        switch (response.status) {
          case "srt_found_and_loaded":
            showUploadStatus(`'${currentVideoId}.srt' 자동 로드 성공 (${response.source})`, "success");
            break;
          case "srt_not_found":
            // File not found, do nothing.
            break;
          case "auto_load_disabled":
            // This is a user setting, so no message is needed.
            break;
          case "no_profiles_configured":
            showUploadStatus("자동 로드 실패: 설정된 GitHub 프로필이 없습니다.", "error");
            break;
          case "error_unauthorized":
          case "error_forbidden":
          case "error_network":
            showUploadStatus(`자동 로드 실패: ${response.message}`, "error");
            break;
          default:
            console.warn(`Custom SRT: Unknown response for auto-load: '${response.status}'.`, response);
        }
      })
      .catch(err => {
        console.error(`Custom SRT: Error sending auto-load request (videoId ${currentVideoId}): `, err.message || err);
        showUploadStatus(`자동 로드 요청 중 오류: ${err.message || '알 수 없는 통신 오류'}`, "error");
      });

  } else if (!newVideoId && currentVideoId) {
    currentVideoId = null;
    customSubtitles = [];
    if (subtitleDisplayElement) {
        subtitleDisplayElement.innerHTML = '';
        subtitleDisplayElement.style.visibility = 'hidden';
    }
  } else if (newVideoId && newVideoId === currentVideoId) {
    if (!videoElement || !videoElement.isConnected) {
        attachVideoListeners();
    }
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "LOAD_CUSTOM_SRT") {
    setupSubtitleDisplay().then(() => {
        attachVideoListeners();
        customSubtitles = parseSRT(request.srtContent);
        if (customSubtitles.length > 0) {
            updateSubtitles();
            sendResponse({ status: "success", message: "SRT content received and processed." });
        } else {
            console.warn("Custom SRT (Content): SRT content parsed into 0 entries or was invalid.");
            if (subtitleDisplayElement) subtitleDisplayElement.style.visibility = 'hidden';
            sendResponse({ status: "error", message: "SRT content was empty or invalid after parsing." });
        }
    });
    return true;
  }
  if (request.type === "APPLY_SUBTITLE_STYLES") {
    if (subtitleDisplayElement) {
        applyStylesToDisplayElement(request.styles);
        updateSubtitles();
        sendResponse({ status: "success", message: "Styles applied." });
    } else {
        currentSubtitleStyles = { ...currentSubtitleStyles, ...request.styles };
        sendResponse({ status: "pending", message: "Styles will be applied on next display init." });
    }
    return true;
  }
  if (request.type === "UPDATE_UPLOAD_BUTTON_VISIBILITY") {
    createSrtUploadButton();
    sendResponse({status: "acknowledged"});
    return true;
  }
});

async function createSrtUploadButton() {
  if (actionsObserver) {
    actionsObserver.disconnect();
    actionsObserver = null;
  }

  // Always remove previous elements to ensure a clean state on re-injection.
  document.getElementById('srt-github-upload-button-wrapper')?.remove();
  document.getElementById('custom-srt-actions-container')?.remove();
  document.getElementById('srt-file-input-for-upload')?.remove();

  let tokenAvailable = false;
  try {
    const response = await chrome.runtime.sendMessage({ type: "CHECK_GITHUB_TOKEN_STATUS" });
    tokenAvailable = response && response.tokenExists;
  } catch (error) {
    console.warn("Custom SRT: Could not check GitHub token status. Assuming not available.", error.message);
    tokenAvailable = false;
  }

  if (!tokenAvailable) {
    return; 
  }

  const buttonContainer = document.querySelector('#top-level-buttons-computed');
  if (!buttonContainer) {
    console.warn("Custom SRT: Could not find the actions container (#top-level-buttons-computed) for button insertion.");
    return;
  }

  const actionsParent = buttonContainer.parentElement;
  if (!actionsParent) {
    console.warn("Custom SRT: Could not find the parent of #actions-inner.");
    return;
  }

  let customActionsContainer = document.getElementById('custom-srt-actions-container');
  if (!customActionsContainer) {
    customActionsContainer = document.createElement('div');
    customActionsContainer.id = 'custom-srt-actions-container';
    Object.assign(customActionsContainer.style, {
      display: 'flex',
      alignItems: 'center',
      marginRight: '8px',
      height: '36px'
    });
    // Insert before the buttonContainer
    actionsParent.insertBefore(customActionsContainer, buttonContainer);
  }

  srtUploadButtonWrapper = document.createElement('div');
  srtUploadButtonWrapper.id = 'srt-github-upload-button-wrapper';
  Object.assign(srtUploadButtonWrapper.style, {
      display: 'inline-flex',
      alignItems: 'center',
      outline: '2px dashed transparent',
      outlineOffset: '2px',
      borderRadius: '22px',
      transition: 'outline-color 0.2s ease-in-out, background-color 0.2s ease-in-out'
  });

  srtUploadButton = document.createElement('button');
  srtUploadButton.id = 'srt-github-upload-button';
  srtUploadButton.textContent = 'SRT 업로드';
  srtUploadButton.className = 'yt-spec-button-shape-next yt-spec-button-shape-next--tonal yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-m';
  srtUploadButtonWrapper.appendChild(srtUploadButton);

  fileInputForUpload = document.createElement('input');
  fileInputForUpload.type = 'file';
  fileInputForUpload.accept = '.srt';
  fileInputForUpload.id = 'srt-file-input-for-upload';
  fileInputForUpload.style.display = 'none';
  document.body.appendChild(fileInputForUpload); 

  srtUploadButton.addEventListener('click', () => {
      if (getVideoIdFromUrl(window.location.href)) {
          fileInputForUpload.click();
      } else {
          showUploadStatus("유튜브 영상 페이지에서만 업로드할 수 있습니다.", "error");
      }
  });

  fileInputForUpload.addEventListener('change', (event) => handleSrtFileSelect(event.target.files));

  srtUploadButtonWrapper.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!isDraggingOverButton) {
          isDraggingOverButton = true;
          srtUploadButtonWrapper.style.outlineColor = 'var(--yt-spec-call-to-action, #065fd4)';
          srtUploadButtonWrapper.style.backgroundColor = 'rgba(6, 95, 212, 0.1)';
      }
  });
  srtUploadButtonWrapper.addEventListener('dragleave', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (isDraggingOverButton && !srtUploadButtonWrapper.contains(event.relatedTarget)) {
          isDraggingOverButton = false;
          srtUploadButtonWrapper.style.outlineColor = 'transparent';
          srtUploadButtonWrapper.style.backgroundColor = 'transparent';
      }
  });
  srtUploadButtonWrapper.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation();
      isDraggingOverButton = false;
      srtUploadButtonWrapper.style.outlineColor = 'transparent';
      srtUploadButtonWrapper.style.backgroundColor = 'transparent';
      if (getVideoIdFromUrl(window.location.href)) {
          const files = event.dataTransfer.files;
          if (files && files.length > 0) {
              const srtFile = Array.from(files).find(file => file.name.toLowerCase().endsWith('.srt'));
              if (srtFile) {
                  handleSrtFileSelect([srtFile]);
              } else {
                  showUploadStatus("드롭된 파일 중 SRT 파일을 찾을 수 없습니다.", "error");
              }
          }
      } else {
          showUploadStatus("유튜브 영상 페이지에서만 업로드할 수 있습니다.", "error");
      }
  });

  customActionsContainer.appendChild(srtUploadButtonWrapper);

  toggleUploadButtonVisibility();

  actionsObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        const customContainer = document.getElementById('custom-srt-actions-container');
        const ytContainer = document.querySelector('#actions-inner');
        if (customContainer && ytContainer && ytContainer.parentElement) {
          // Check if our container's next sibling is the ytContainer
          if (customContainer.nextSibling !== ytContainer) {
            // If not, move our container to be before the ytContainer
            ytContainer.parentElement.insertBefore(customContainer, ytContainer);
          }
        }
      }
    }
  });

  actionsObserver.observe(actionsParent, { childList: true });
}

function handleSrtFileSelect(fileList) {
  if (!fileList || fileList.length === 0) return;
  const file = fileList[0];

  if (!file.name.toLowerCase().endsWith('.srt')) {
      showUploadStatus("SRT 파일만 업로드할 수 있습니다.", "error");
      if (fileInputForUpload) fileInputForUpload.value = null;
      return;
  }

  const currentVideoIdForUpload = getVideoIdFromUrl(window.location.href);
  if (!currentVideoIdForUpload) {
      showUploadStatus("현재 유튜브 영상 ID를 가져올 수 없습니다.", "error");
      if (fileInputForUpload) fileInputForUpload.value = null;
      return;
  }

  const finalFileName = `${currentVideoIdForUpload}.srt`;
  showUploadStatus(`'${finalFileName}' 업로드 준비 중...`, "info");

  const reader = new FileReader();
  reader.onload = (e) => {
      const srtContent = e.target.result;
      showUploadStatus(`'${finalFileName}' 업로드 중... 잠시만 기다려주세요.`, "info");
      chrome.runtime.sendMessage({
          type: "UPLOAD_SRT_TO_GITHUB",
          fileName: finalFileName,
          content: srtContent,
          videoId: currentVideoIdForUpload
      })
      .then(response => {
          if (response) {
              if (response.status === "success") {
                  showUploadStatus(`'${response.fileName}' GitHub 업로드 성공! (${response.url || ''})`, "success");
              } else if (response.status === "file_already_exists") {
                  showUploadStatus(response.message, "info");
              } else {
                  showUploadStatus(`업로드 실패: ${response.message || '알 수 없는 오류'} (코드: ${response.status || 'N/A'})`, "error");
              }
          } else {
              showUploadStatus("GitHub 업로드 응답 없음. 백그라운드 스크립트를 확인하세요.", "error");
          }
      })
      .catch(err => {
          showUploadStatus(`GitHub 업로드 요청 오류: ${err.message || '알 수 없는 통신 오류'}`, "error");
          console.error("Custom SRT: Error sending UPLOAD_SRT_TO_GITHUB message:", err);
      });
  };
  reader.onerror = (err) => {
    showUploadStatus(`파일 읽기 오류: ${err.toString()}`, "error");
    console.error("Custom SRT: FileReader error:", err);
  }
  reader.readAsText(file);

  if (fileInputForUpload) fileInputForUpload.value = null;
}

function showUploadStatus(message, type = "info") {
  if (!uploadStatusElement) {
      uploadStatusElement = document.createElement('div');
      uploadStatusElement.id = 'srt-upload-status-message';
      Object.assign(uploadStatusElement.style, {
          position: 'fixed', bottom: '20px', left: '20px', padding: '12px 18px',
          borderRadius: '6px', zIndex: '2147483647', fontSize: '14px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)', color: 'white',
          opacity: '0', transition: 'opacity 0.3s ease-in-out',
          maxWidth: 'calc(100% - 40px)'
      });
      document.body.appendChild(uploadStatusElement);
  }

  uploadStatusElement.textContent = message;
  let bgColor = "#2980b9";
  if (type === "error") bgColor = "#e74c3c";
  else if (type === "success") bgColor = "#2ecc71";

  uploadStatusElement.style.backgroundColor = bgColor;
  uploadStatusElement.style.opacity = '1';

  if (uploadStatusElement.timerId) clearTimeout(uploadStatusElement.timerId);

  uploadStatusElement.timerId = setTimeout(() => {
      uploadStatusElement.style.opacity = '0';
  }, 5000);
}

function toggleUploadButtonVisibility() {
  if (!srtUploadButtonWrapper) { 
    return;
  }
  if (getVideoIdFromUrl(window.location.href)) {
      srtUploadButtonWrapper.style.display = 'inline-flex';
  } else {
      srtUploadButtonWrapper.style.display = 'none';
  }
}

async function initializeContentScript() {
  console.log("Custom SRT: Running initialization logic.");
  await setupSubtitleDisplay(); 
  attachVideoListeners();
  
  const videoId = getVideoIdFromUrl(window.location.href);
  if (videoId) {
      checkForVideoChangeAndTriggerActions();
      await createSrtUploadButton(); 
  } else {
      // If we are not on a video page, ensure the button is hidden.
      toggleUploadButtonVisibility();
  }
}

let initInterval = null;
let initTimeout = null;
let initializedForHref = null;

function initializeWhenReady() {
    if (initInterval) clearInterval(initInterval);
    if (initTimeout) clearTimeout(initTimeout);

    const currentHref = window.location.href;
    if (!currentHref.includes('/watch')) {
        return;
    }
    if (initializedForHref === currentHref) {
        return;
    }

    initInterval = setInterval(() => {
        const videoElement = document.querySelector('video.html5-main-video');
        const actionsContainer = document.querySelector('#top-level-buttons-computed');

        if (videoElement && videoElement.offsetHeight > 0 && actionsContainer && actionsContainer.children.length > 0) {
            clearInterval(initInterval);
            clearTimeout(initTimeout);
            console.log("Custom SRT: YouTube elements ready, initializing.");
            initializedForHref = currentHref;
            initializeContentScript();
        }
    }, 500);

    initTimeout = setTimeout(() => {
        clearInterval(initInterval);
        console.warn("Custom SRT: Timed out waiting for YouTube elements.");
    }, 10000);
}

document.addEventListener('yt-navigate-finish', () => {
    console.log("Custom SRT: 'yt-navigate-finish' event detected.");
    initializedForHref = null; 
    initializeWhenReady();
});

window.addEventListener('load', () => {
    console.log("Custom SRT: Window 'load' event detected.");
    initializeWhenReady();
});

if (document.readyState === 'complete') {
    console.log("Custom SRT: Document already complete.");
    initializeWhenReady();
}