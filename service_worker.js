// service_worker.js
// Manages storage and messaging between popup/options and content script

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getSettings') {
    chrome.storage.sync.get([
      'modifierKey',
      'highlightColor',
      'domainsEnabled'
    ], prefs => sendResponse(prefs));
    return true; // async
  }
});

// Context menu and search logic

const SEARCH_ENGINES = {
  Google: q => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  YouTube: q => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  Wikipedia: q => `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(q)}`
};

const CONTEXT_MENU_IDS = ['multi-search', 'combined-search'];

function createMenus(options = {}) {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'multi-search',
      title: 'MultiSearch (all selections)',
      contexts: ['all'],
      visible: options.multiSearch !== false
    });
    chrome.contextMenus.create({
      id: 'combined-search',
      title: 'CombinedSearch (all selections)',
      contexts: ['all'],
      visible: options.combinedSearch !== false
    });
    chrome.contextMenus.create({
      id: 'search-google',
      title: 'Search Google for "%s"',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: 'search-youtube',
      title: 'Search YouTube for "%s"',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: 'search-wikipedia',
      title: 'Search Wikipedia for "%s"',
      contexts: ['selection']
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['multiSearch', 'combinedSearch'], createMenus);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes.multiSearch || changes.combinedSearch)) {
    chrome.storage.sync.get(['multiSearch', 'combinedSearch'], createMenus);
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId.startsWith('search-')) {
    const engine = info.menuItemId.replace('search-', '');
    const url = SEARCH_ENGINES[engine.charAt(0).toUpperCase() + engine.slice(1)](info.selectionText);
    chrome.tabs.create({ url });
  }
  if (info.menuItemId === 'multi-search' || info.menuItemId === 'combined-search') {
    chrome.tabs.sendMessage(tab.id, { type: 'getSelections' }, res => {
      if (!res || !res.selections) return;
      if (info.menuItemId === 'multi-search') {
        res.selections.forEach(text => {
          if (text && text.trim()) chrome.tabs.create({ url: SEARCH_ENGINES.Google(text) });
        });
      } else {
        const combined = res.selections.filter(Boolean).join(' ');
        if (combined) chrome.tabs.create({ url: SEARCH_ENGINES.Google(combined) });
      }
    });
  }
});

chrome.action.onClicked.addListener(tab => {
  chrome.runtime.openOptionsPage();
});

// Cleanup on uninstall/update
chrome.runtime.setUninstallURL('https://yourdomain.com/extension-uninstalled');
chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'update') {
    chrome.storage.local.clear();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getSelections') {
    // Not used in this skeleton, but could be used for popup/options
    sendResponse({ selections: [] });
  }
});