// popup.js (updated with error handling)
document.addEventListener('DOMContentLoaded', () => {
  const elements = {
    modSel: document.getElementById('modifier'),
    colInp: document.getElementById('color'),
    saveBtn: document.getElementById('save'),
    status: document.getElementById('status')
  };

  // Check for missing elements
  if (Object.values(elements).some(el => !el)) {
    console.error('Missing elements:', Object.entries(elements).map(([key, el]) => `${key}: ${el ? 'OK' : 'NULL'}`));
    return;
  }

  const { modSel, colInp, saveBtn, status } = elements;

  // Load preferences
  chrome.storage.sync.get(
    ['modifierKey', 'highlightColor'],
    prefs => {
      try {
        if (prefs.modifierKey) modSel.value = prefs.modifierKey;
        if (prefs.highlightColor) colInp.value = prefs.highlightColor;
      } catch (error) {
        console.error('Error loading settings:', error);
      }
    }
  );

  // Save preferences
  saveBtn.addEventListener('click', () => {
    try {
      chrome.storage.sync.set({
        modifierKey: modSel.value,
        highlightColor: colInp.value
      }, () => {
        status.textContent = 'Options saved.';
        setTimeout(() => { status.textContent = ''; }, 2000);
      });
    } catch (error) {
      console.error('Error saving settings:', error);
      status.textContent = 'Save failed!';
    }
  });

  // Copy options UI (skeleton)
  const copyModes = document.querySelectorAll('input[name="copy-mode"]');
  const multiSearchToggle = document.getElementById('multiSearchToggle');
  const combinedSearchToggle = document.getElementById('combinedSearchToggle');

  // Load settings
  chrome.storage.sync.get(['copyMode', 'multiSearch', 'combinedSearch'], data => {
    if (data.copyMode) {
      document.querySelector(`input[name="copy-mode"][value="${data.copyMode}"]`).checked = true;
    }
    if (multiSearchToggle) multiSearchToggle.checked = data.multiSearch !== false;
    if (combinedSearchToggle) combinedSearchToggle.checked = data.combinedSearch !== false;
  });

  // Save copy mode
  copyModes.forEach(radio => {
    radio.addEventListener('change', () => {
      try {
        chrome.storage.sync.set({ copyMode: radio.value }, () => {
          status.textContent = 'Copy mode saved!';
          setTimeout(() => status.textContent = '', 1200);
        });
      } catch (e) {
        status.textContent = 'Save failed!';
      }
    });
  });

  // Save context menu toggles
  [multiSearchToggle, combinedSearchToggle].forEach(toggle => {
    if (!toggle) return;
    toggle.addEventListener('change', () => {
      const key = toggle.id.replace('Toggle', '');
      try {
        chrome.storage.sync.set({ [key]: toggle.checked }, () => {
          status.textContent = 'Menu option saved!';
          setTimeout(() => status.textContent = '', 1200);
        });
      } catch (e) {
        status.textContent = 'Save failed!';
      }
    });
  });
});