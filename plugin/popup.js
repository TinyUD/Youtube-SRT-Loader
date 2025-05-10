document.addEventListener('DOMContentLoaded', () => {
  const srtFileInput = document.getElementById('srtFile');
  const loadLocalSrtButton = document.getElementById('loadLocalSrt');

  const githubProfileSelect = document.getElementById('githubProfileSelect');
  const githubProfileNameInput = document.getElementById('githubProfileName');
  const githubUser = document.getElementById('githubUser');
  const githubRepo = document.getElementById('githubRepo');
  const githubBranch = document.getElementById('githubBranch');
  const githubPathInput = document.getElementById('githubPath');
  const githubPatInput = document.getElementById('githubPat');
  const saveGithubSettingsButton = document.getElementById('saveGithubSettings');
  const deleteGithubProfileButton = document.getElementById('deleteGithubProfile');
  const githubStatus = document.getElementById('githubStatus');
  const autoLoadGithubCheckbox = document.getElementById('autoLoadSrtGithub');

  const subFontSizeInput = document.getElementById('subFontSize');
  const subColorInput = document.getElementById('subColor');
  const subBgColorInput = document.getElementById('subBgColor');
  const subPositionInput = document.getElementById('subPosition');
  const saveSubtitleStylesButton = document.getElementById('saveSubtitleStyles');
  const subtitleStyleStatus = document.getElementById('subtitleStyleStatus');

  const generalStatus = document.getElementById('generalStatus');

  let githubProfiles = [];
  let activeGithubProfileName = null;
  let currentSubtitleStyles = {};

  function loadInitialSettings() {
    chrome.storage.local.get(['githubProfiles', 'activeGithubProfileName', 'autoLoadSrtGithubEnabled', 'subtitleStyles'], (data) => {
      githubProfiles = data.githubProfiles || [];
      activeGithubProfileName = data.activeGithubProfileName || null;
      autoLoadGithubCheckbox.checked = !!data.autoLoadSrtGithubEnabled;

      populateGithubProfileDropdown();
      if (activeGithubProfileName) {
        githubProfileSelect.value = activeGithubProfileName;
        displayProfileDetails(activeGithubProfileName);
      } else if (githubProfiles.length > 0) {
        githubProfileSelect.value = githubProfiles[0].name;
        displayProfileDetails(githubProfiles[0].name);
        chrome.storage.local.set({ activeGithubProfileName: githubProfiles[0].name });
      } else {
        clearGithubForm();
      }
      
      currentSubtitleStyles = data.subtitleStyles || {
        fontSize: '2.0em',
        color: '#FFFFFF',
        backgroundColor: 'rgba(8, 8, 8, 0.75)',
        bottom: '60px'
      };
      loadSubtitleStyleInputs();
    });
  }

  function populateGithubProfileDropdown() {
    githubProfileSelect.innerHTML = '<option value="">-- 프로필 선택 또는 새로 만들기 --</option>';
    githubProfiles.forEach(profile => {
      const option = document.createElement('option');
      option.value = profile.name;
      option.textContent = profile.name;
      githubProfileSelect.appendChild(option);
    });
  }

  function displayProfileDetails(profileName) {
    const profile = githubProfiles.find(p => p.name === profileName);
    if (profile) {
      githubProfileNameInput.value = profile.name;
      githubUser.value = profile.user || '';
      githubRepo.value = profile.repo || '';
      githubBranch.value = profile.branch || 'main';
      githubPathInput.value = profile.path || '';
      githubPatInput.value = profile.pat || '';
      activeGithubProfileName = profile.name;
      githubProfileNameInput.disabled = true;
    } else {
      clearGithubForm();
    }
  }

  function clearGithubForm() {
    githubProfileNameInput.value = '';
    githubUser.value = '';
    githubRepo.value = '';
    githubBranch.value = 'main';
    githubPathInput.value = '';
    githubPatInput.value = '';
    githubProfileNameInput.disabled = false;
  }
  
  githubProfileSelect.addEventListener('change', () => {
    const selectedName = githubProfileSelect.value;
    if (selectedName) {
      displayProfileDetails(selectedName);
      chrome.storage.local.set({ activeGithubProfileName: selectedName }, () => {
        notifyContentScriptForButtonRecheck();
      });
    } else {
      clearGithubForm();
      activeGithubProfileName = null; 
      chrome.storage.local.set({ activeGithubProfileName: null }, () => {
        notifyContentScriptForButtonRecheck();
      });
    }
  });

  saveGithubSettingsButton.addEventListener('click', () => {
    const profileName = githubProfileNameInput.value.trim();
    if (!profileName) {
      githubStatus.textContent = '프로필 이름을 입력해주세요.';
      setTimeout(() => githubStatus.textContent = '', 3000);
      return;
    }

    let pathValue = githubPathInput.value.trim();
    if (pathValue && !pathValue.endsWith('/') && pathValue !== '') {
        pathValue += '/';
    }
    if (pathValue === '/') { pathValue = ''; }

    const newProfileData = {
      name: profileName,
      user: githubUser.value.trim(),
      repo: githubRepo.value.trim(),
      branch: githubBranch.value.trim() || 'main',
      path: pathValue,
      pat: githubPatInput.value.trim()
    };

    if (!newProfileData.user || !newProfileData.repo) {
        githubStatus.textContent = '프로필에 사용자명과 저장소명을 입력해주세요.';
        setTimeout(() => githubStatus.textContent = '', 3000);
        return;
    }

    const existingProfileIndex = githubProfiles.findIndex(p => p.name === profileName);
    if (existingProfileIndex > -1) {
      githubProfiles[existingProfileIndex] = newProfileData;
    } else {
      githubProfiles.push(newProfileData);
    }

    chrome.storage.local.set({ githubProfiles: githubProfiles, activeGithubProfileName: profileName }, () => {
      githubStatus.textContent = `GitHub 프로필 '${profileName}'이(가) 저장되었습니다.`;
      setTimeout(() => githubStatus.textContent = '', 3000);
      populateGithubProfileDropdown();
      githubProfileSelect.value = profileName;
      displayProfileDetails(profileName);
      notifyContentScriptForButtonRecheck();
    });
  });

  deleteGithubProfileButton.addEventListener('click', () => {
    const selectedName = githubProfileSelect.value;
    if (!selectedName) {
      githubStatus.textContent = '삭제할 프로필을 선택해주세요.';
      setTimeout(() => githubStatus.textContent = '', 3000);
      return;
    }

    githubProfiles = githubProfiles.filter(p => p.name !== selectedName);
    let newActiveProfileName = null;
    if (githubProfiles.length > 0) {
        newActiveProfileName = githubProfiles[0].name;
    }

    chrome.storage.local.set({ githubProfiles: githubProfiles, activeGithubProfileName: newActiveProfileName }, () => {
      githubStatus.textContent = `프로필 '${selectedName}'이(가) 삭제되었습니다.`;
      setTimeout(() => githubStatus.textContent = '', 3000);
      populateGithubProfileDropdown();
      notifyContentScriptForButtonRecheck();
      if (newActiveProfileName) {
        githubProfileSelect.value = newActiveProfileName;
        displayProfileDetails(newActiveProfileName);
      } else {
        clearGithubForm();
      }
    });
  });

  autoLoadGithubCheckbox.addEventListener('change', () => {
    const enabled = autoLoadGithubCheckbox.checked;
    chrome.storage.local.set({ autoLoadSrtGithubEnabled: enabled });
    const currentProfile = githubProfiles.find(p => p.name === activeGithubProfileName);
    if (enabled && (!currentProfile || !currentProfile.user || !currentProfile.repo)) {
      githubStatus.textContent = '자동 로드를 위해 GitHub 프로필을 선택하고 사용자명/저장소명을 설정해주세요.';
    } else if (enabled) {
      githubStatus.textContent = 'GitHub 자동 로드 활성화됨 (현재 선택된 프로필 기준).';
    } else {
      githubStatus.textContent = 'GitHub 자동 로드 비활성화됨.';
    }
    setTimeout(() => githubStatus.textContent = '', 3000);
  });

  function notifyContentScriptForButtonRecheck() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id && tabs[0].url && tabs[0].url.includes("youtube.com/watch")) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "UPDATE_UPLOAD_BUTTON_VISIBILITY" })
          .catch(err => console.warn("Popup: Could not send UPDATE_UPLOAD_BUTTON_VISIBILITY to content script:", err.message));
      }
    });
  }
  
  function loadSubtitleStyleInputs() {
    subFontSizeInput.value = parseFloat(currentSubtitleStyles.fontSize) || 2.0;
    subColorInput.value = currentSubtitleStyles.color || '#FFFFFF';
    subBgColorInput.value = currentSubtitleStyles.backgroundColor || 'rgba(8, 8, 8, 0.75)';
    subPositionInput.value = parseInt(currentSubtitleStyles.bottom) || 60;
  }

  saveSubtitleStylesButton.addEventListener('click', () => {
    currentSubtitleStyles = {
      fontSize: `${parseFloat(subFontSizeInput.value) || 2.0}em`,
      color: subColorInput.value,
      backgroundColor: subBgColorInput.value,
      bottom: `${parseInt(subPositionInput.value) || 60}px`
    };
    chrome.storage.local.set({ subtitleStyles: currentSubtitleStyles }, () => {
      subtitleStyleStatus.textContent = '자막 스타일이 저장되었습니다.';
      setTimeout(() => subtitleStyleStatus.textContent = '', 3000);
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id && tabs[0].url && tabs[0].url.includes("youtube.com/watch")) {
          chrome.tabs.sendMessage(tabs[0].id, { type: "APPLY_SUBTITLE_STYLES", styles: currentSubtitleStyles })
            .catch(err => console.warn("Could not send APPLY_SUBTITLE_STYLES to content script:", err.message));
        }
      });
    });
  });

  loadLocalSrtButton.addEventListener('click', () => {
    const file = srtFileInput.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const srtContent = e.target.result;
        applySrtToActiveTab(srtContent, "로컬 파일");
      };
      reader.readAsText(file);
    } else {
      generalStatus.textContent = 'SRT 파일을 선택해주세요.';
      generalStatus.className = 'status-message error';
      setTimeout(() => { generalStatus.textContent = ''; generalStatus.className = 'status-message'; }, 3000);
    }
  });

  function applySrtToActiveTab(srtContent, source = "SRT") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id && tabs[0].url && tabs[0].url.includes("youtube.com/watch")) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "LOAD_CUSTOM_SRT", srtContent: srtContent })
          .then(response => {
            if (response && response.status === "success") {
              generalStatus.textContent = `${source} 자막이 적용되었습니다.`;
              generalStatus.className = 'status-message success';
              console.log(`${source} SRT content sent to content script from popup.`);
            } else {
              generalStatus.textContent = response?.message || `${source} 자막 적용 실패 (콘텐츠 스크립트 오류)`;
              generalStatus.className = 'status-message error';
              console.warn(`Failed to send ${source} SRT to content script from popup:`, response);
            }
          })
          .catch(err => {
            generalStatus.textContent = `${source} 자막 적용 실패 (메시지 전송 오류)`;
            generalStatus.className = 'status-message error';
            console.error(`Error sending ${source} SRT message to content script from popup: `, err);
          })
          .finally(() => {
            setTimeout(() => { generalStatus.textContent = ''; generalStatus.className = 'status-message'; }, 4000);
          });
      } else {
        generalStatus.textContent = '활성 유튜브 영상 탭을 찾을 수 없습니다.';
        generalStatus.className = 'status-message error';
        setTimeout(() => { generalStatus.textContent = ''; generalStatus.className = 'status-message'; }, 3000);
      }
    });
  }

  loadInitialSettings();
});