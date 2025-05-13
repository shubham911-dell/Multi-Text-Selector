// service_worker.js
// Manages storage and messaging between popup/options and content script

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getSettings') {
    chrome.storage.sync.get([
      'modifierKey',
      'highlightColor',
      'copyMode',
      'multiSearch',
      'combinedSearch'
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

function createMenus({ multiSearch = true, combinedSearch = true } = {}) {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'multi-search',
      title: 'MultiSearch (all selections)',
      contexts: ['all'],
      visible: multiSearch
    });
    chrome.contextMenus.create({
      id: 'combined-search',
      title: 'CombinedSearch (all selections)',
      contexts: ['all'],
      visible: combinedSearch
    });
    ['google', 'youtube', 'wikipedia'].forEach(engine => {
      chrome.contextMenus.create({
        id: `search-${engine}`,
        title: `Search ${engine[0].toUpperCase() + engine.slice(1)} for "%s"`,
        contexts: ['selection']
      });
    });
  });
}

chrome.runtime.onInstalled.addListener(details => {
  // Set defaults only on fresh install or update
  chrome.storage.sync.get(null, current => {
    const defaults = {
      modifierKey: 'Control',
      highlightColor: 'rgb(219,252,144)',
      copyMode: 'space',
      multiSearch: true,
      combinedSearch: true
    };
    // Only write defaults if they aren't already set
    const toSet = {};
    for (let k in defaults) {
      if (current[k] === undefined) toSet[k] = defaults[k];
    }
    if (Object.keys(toSet).length) {
      chrome.storage.sync.set(toSet);
    }
    // Build context menus with the stored (or default) toggles
    chrome.storage.sync.get(['multiSearch', 'combinedSearch'], createMenus);
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' &&
      ('multiSearch' in changes || 'combinedSearch' in changes)) {
    const newVals = {};
    if (changes.multiSearch)   newVals.multiSearch   = changes.multiSearch.newValue;
    if (changes.combinedSearch) newVals.combinedSearch = changes.combinedSearch.newValue;
    createMenus(newVals);
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const { menuItemId, selectionText } = info;
  if (menuItemId.startsWith('search-')) {
    const engine = menuItemId.replace('search-', '');
    const url = SEARCH_ENGINES[engine.charAt(0).toUpperCase() + engine.slice(1)](selectionText);
    chrome.tabs.create({ url });
  } else if (menuItemId === 'multi-search' || menuItemId === 'combined-search') {
    chrome.tabs.sendMessage(tab.id, { type: 'getSelections' }, res => {
      if (!res || !res.selections) return;
      if (menuItemId === 'multi-search') {
        res.selections.forEach(text => {
          if (text.trim())
            chrome.tabs.create({ url: SEARCH_ENGINES.Google(text) });
        });
      } else {
        const combined = res.selections.filter(Boolean).join(' ');
        if (combined) chrome.tabs.create({ url: SEARCH_ENGINES.Google(combined) });
      }
    });
  }
});

chrome.action.onClicked.addListener(() => {
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