// options.js
// Wait for the DOM to be parsed before querying elements
document.addEventListener('DOMContentLoaded', () => {
  const modEl   = document.getElementById('modifier');
  const colorEl = document.getElementById('color');
  const saveBtn = document.getElementById('save');

  // Load existing settings
  chrome.storage.sync.get(['modifierKey', 'highlightColor'], data => {
    if (data.modifierKey)    modEl.value   = data.modifierKey;
    if (data.highlightColor) colorEl.value = data.highlightColor;
  });

  // Save on button click
  saveBtn.addEventListener('click', () => {
    chrome.storage.sync.set({
      modifierKey:   modEl.value,
      highlightColor: colorEl.value
    }, () => {
      // show a brief confirmation
      const msg = document.createElement('div');
      msg.textContent = 'Options saved.';
      document.body.appendChild(msg);
      setTimeout(() => msg.remove(), 2000);
    });
  });
});