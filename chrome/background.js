chrome.runtime.onInstalled.addListener(() => {
  console.log("[Plex Sleep Timer] Extension installed.");
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[Plex Sleep Timer] Extension started.");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "log") {
    console.log("[Plex Sleep Timer]", message.data);
  }
});
