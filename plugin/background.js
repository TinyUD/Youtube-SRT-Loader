chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "REQUEST_AUTO_LOAD_SRT_FOR_VIDEO_ID" && request.videoId) {
    const videoId = request.videoId;
    const tabId = sender.tab.id;

    chrome.storage.local.get(['autoLoadSrtGithubEnabled', 'githubProfiles'], async (config) => {
      if (!config.autoLoadSrtGithubEnabled || !config.githubProfiles || config.githubProfiles.length === 0) {
        sendResponse({ 
          status: config.autoLoadSrtGithubEnabled ? "no_profiles_configured" : "auto_load_disabled", 
          source: "github_api_multi_profile" 
        });
        return;
      }

      for (const profile of config.githubProfiles) {
        if (profile?.user && profile?.repo) {
          const { user, repo, branch, path, pat } = profile;
          const srtFileName = `${videoId}.srt`;
          const filePath = path ? `${path.replace(/\/$/, '')}/${srtFileName}` : srtFileName;
          const apiUrl = `https://api.github.com/repos/${user}/${repo}/contents/${filePath}?ref=${branch || 'main'}`;
          const headers = { 'Accept': 'application/vnd.github.v3.raw' };
          if (pat) {
            headers['Authorization'] = `token ${pat}`;
          }
  
          console.log(`Background (Auto-Load Profile: ${profile.name}): Attempting from ${apiUrl}`);
          try {
            const response = await fetch(apiUrl, { headers: headers });
            if (response.ok) {
              const srtContent = await response.text();
              console.log(`Background (Auto-Load Profile: ${profile.name}): Successfully fetched SRT for ${videoId}.`);
              if (tabId) {
                chrome.tabs.sendMessage(tabId, { type: "LOAD_CUSTOM_SRT", srtContent: srtContent })
                  .then(contentResponse => sendResponse({ status: "srt_found_and_loaded", source: `github (${profile.name})` }))
                  .catch(err => sendResponse({ status: "content_script_error", message: err.message, source: `github (${profile.name})` }));
              } else { 
                sendResponse({ status: "error", message: "Tab ID not available.", source: `github (${profile.name})` }); 
              }
              return; 
            } else if (response.status === 404) {
              console.log(`Background (Auto-Load Profile: ${profile.name}): SRT not found (404) for ${videoId}. Trying next profile.`);
            } else if (response.status === 401) {
              console.warn(`Background (Auto-Load Profile: ${profile.name}): Unauthorized (401) for ${videoId}. PAT might be invalid. Trying next profile.`);
            } else if (response.status === 403) {
              console.warn(`Background (Auto-Load Profile: ${profile.name}): Forbidden (403) for ${videoId}. Permissions or rate limit. Trying next profile.`);
            } else {
              console.warn(`Background (Auto-Load Profile: ${profile.name}): Fetch error HTTP ${response.status} for ${videoId}. Trying next profile.`);
            }
          } catch (error) {
            console.error(`Background (Auto-Load Profile: ${profile.name}): Network error for ${videoId}: ${error.message}. Trying next profile.`);
          }
        } else {
          console.log(`Background (Auto-Load): Skipping profile "${profile.name}" due to missing user/repo.`);
        }
      }
      sendResponse({ status: "srt_not_found", source: "github_api_multi_profile" });
    });
    return true;
  }

  if (request.type === "CHECK_GITHUB_TOKEN_STATUS") {
    chrome.storage.local.get(['githubProfiles', 'activeGithubProfileName'], (settings) => {
        if (chrome.runtime.lastError) {
            console.error("Error getting GitHub profiles/active name for token check:", chrome.runtime.lastError.message);
            sendResponse({ tokenExists: false, error: chrome.runtime.lastError.message });
            return;
        }

        let activeProfileHasPat = false;
        if (settings.activeGithubProfileName && settings.githubProfiles && settings.githubProfiles.length > 0) {
            const activeProfile = settings.githubProfiles.find(p => p.name === settings.activeGithubProfileName);
            if (activeProfile && activeProfile.user && activeProfile.repo && activeProfile.pat) {
                activeProfileHasPat = true;
            }
        }
        sendResponse({ tokenExists: activeProfileHasPat });
    });
    return true;
  }

  if (request.type === "UPLOAD_SRT_TO_GITHUB") {
    const { fileName, content, videoId } = request;

    chrome.storage.local.get(['githubProfiles', 'activeGithubProfileName'], async (config) => {
      if (!config.githubProfiles || config.githubProfiles.length === 0) {
        sendResponse({ status: "config_missing", message: "GitHub 프로필이 설정되지 않았습니다." });
        return;
      }
      if (!config.activeGithubProfileName) {
          sendResponse({ status: "no_active_profile", message: "선택된 활성 GitHub 프로필이 없습니다. 팝업에서 프로필을 선택해주세요." });
          return;
      }

      const activeProfile = config.githubProfiles.find(p => p.name === config.activeGithubProfileName);

      if (!activeProfile) {
          sendResponse({ status: "active_profile_not_found", message: `활성 프로필 '${config.activeGithubProfileName}'을(를) 찾을 수 없습니다.` });
          return;
      }
      if (!activeProfile.user || !activeProfile.repo || !activeProfile.pat) {
        sendResponse({ 
          status: "active_profile_incomplete_pat_missing",
          message: `활성 프로필 '${activeProfile.name}'에 사용자명, 저장소명 또는 PAT가 설정되지 않았습니다.` 
        });
        return;
      }

      console.log(`Background (GitHub Upload): Using ACTIVE profile "${activeProfile.name}" for upload.`);
      const { user, repo, branch, path, pat } = activeProfile;
      const fullPath = path ? `${path.replace(/\/$/, '')}/${fileName}` : fileName;
      const apiUrl = `https://api.github.com/repos/${user}/${repo}/contents/${fullPath}`;
      const encodedContent = btoa(unescape(encodeURIComponent(content))); 
      const commitMessage = `SRT for YouTube ${videoId}: ${fileName}`;
      let fileExistsIndicator = null;

      try {
          const checkUrl = apiUrl + `?ref=${branch || 'main'}`;
          console.log(`Background (GitHub Upload Check - Active Profile: ${activeProfile.name}): Checking: ${checkUrl}`);

          const checkResponse = await fetch(checkUrl, {
              method: 'GET',
              headers: { 'Authorization': `token ${pat}`, 'Accept': 'application/vnd.github.v3+json', "X-GitHub-Api-Version": "2022-11-28" }
          });

          const responseStatus = checkResponse.status;
          const responseContentType = checkResponse.headers.get('content-type');

          if (checkResponse.ok) {
              if (responseContentType && responseContentType.includes('application/json')) {
                  const fileData = await checkResponse.json();
                  if (Array.isArray(fileData)) {
                      sendResponse({ status: "check_failed", message: `경로 '${fullPath}'가 디렉토리입니다 (프로필: ${activeProfile.name}).` }); return;
                  }
                  if (fileData && fileData.sha && fileData.type === 'file') {
                      fileExistsIndicator = fileData.sha;
                  } else if (fileData && fileData.type !== 'file') {
                      sendResponse({ status: "check_failed", message: `경로 '${fullPath}'는 파일이 아닙니다 (타입: ${fileData.type}, 프로필: ${activeProfile.name}).` }); return;
                  } else {
                      sendResponse({ status: "check_failed", message: `파일 확인 중 예상치 못한 JSON 응답 (프로필: ${activeProfile.name}).` }); return;
                  }
              } else if (responseContentType && responseContentType.includes('application/vnd.github.v3.raw')) {
                  fileExistsIndicator = "exists_raw_content";
              } else {
                  fileExistsIndicator = "exists_unknown_content_type";
              }
          } else if (responseStatus === 404) {
              fileExistsIndicator = null;
          } else {
              let errorMessage = `파일 확인 실패 (HTTP ${responseStatus}, 프로필: ${activeProfile.name}): `;
              try {
                  const errorBody = await checkResponse.text();
                  errorMessage += (JSON.parse(errorBody).message || errorBody.substring(0,100) || checkResponse.statusText);
              } catch (e) { errorMessage += checkResponse.statusText; }
              if (responseStatus === 401) errorMessage += " (PAT 확인 필요)";
              sendResponse({ status: "check_failed", message: errorMessage }); return;
          }
      } catch (error) { 
          sendResponse({ status: "check_error", message: `파일 확인 중 네트워크 오류 (프로필: ${activeProfile.name}): ${error.message}` }); return;
      }

      if (fileExistsIndicator) {
        sendResponse({
          status: "file_already_exists",
          message: `파일 '${fileName}'이(가) GitHub 프로필 '${activeProfile.name}'에 이미 존재합니다.`,
          fileName: fileName
        });
        return;
      }

      const payload = { message: commitMessage, content: encodedContent, branch: branch || 'main' };
      console.log(`Background (GitHub Upload - Active Profile: ${activeProfile.name}): Creating new file '${fullPath}'.`);
      try {
          const uploadResponse = await fetch(apiUrl, {
              method: 'PUT',
              headers: {
                  'Authorization': `token ${pat}`, 'Accept': 'application/vnd.github.v3+json',
                  "X-GitHub-Api-Version": "2022-11-28", 'Content-Type': 'application/json'
              },
              body: JSON.stringify(payload)
          });
          
          const uploadStatus = uploadResponse.status;
          const uploadResponseBodyText = await uploadResponse.text();

          if (uploadResponse.ok) {
              const responseData = JSON.parse(uploadResponseBodyText);
              sendResponse({ status: "success", message: `GitHub 파일 생성 성공 (프로필: ${activeProfile.name})`, fileName: fileName, url: responseData.content?.html_url || responseData.commit?.html_url });
          } else {
              let errorResponseMessage = `GitHub 업로드 실패 (HTTP ${uploadStatus}, 프로필: ${activeProfile.name})`;
              try { errorResponseMessage += `: ${(JSON.parse(uploadResponseBodyText).message || uploadResponseBodyText.substring(0,200))}`; } 
              catch (e) { errorResponseMessage += `: ${uploadResponseBodyText.substring(0,200) || uploadResponse.statusText}`; }
              sendResponse({ status: "upload_failed", message: errorResponseMessage });
          }
      } catch (error) { 
          sendResponse({ status: "network_error", message: `GitHub 업로드 중 네트워크 오류 (프로필: ${activeProfile.name}): ${error.message}` });
      }
    });
    return true;
  }
});

chrome.runtime.onInstalled.addListener((details) => {
console.log('YouTube Custom SRT Loader (GitHub Private & Upload) (re)installed. Reason:', details.reason);
chrome.storage.local.get(['autoLoadSrtGithubEnabled', 'githubProfiles', 'activeGithubProfileName', 'subtitleStyles'], (items) => {
  if (items.autoLoadSrtGithubEnabled === undefined) {
    chrome.storage.local.set({ autoLoadSrtGithubEnabled: false });
  }
  if (items.githubProfiles === undefined) {
    chrome.storage.local.set({ githubProfiles: [] }); 
  }
  if (items.activeGithubProfileName === undefined) {
    chrome.storage.local.set({ activeGithubProfileName: null });
  }
  if (items.subtitleStyles === undefined) {
    chrome.storage.local.set({ 
      subtitleStyles: {
        fontSize: '2.0em',
        color: '#FFFFFF',
        backgroundColor: 'rgba(8, 8, 8, 0.75)',
        bottom: '60px'
      } 
    });
  }
});
});