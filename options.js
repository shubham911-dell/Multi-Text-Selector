// options.js
document.addEventListener('DOMContentLoaded', () => {
  const modEl     = document.getElementById('modifier');
  const colorEl   = document.getElementById('color');
  const saveBtn   = document.getElementById('save');
  const status    = document.getElementById('status');
  const copyModes = Array.from(document.querySelectorAll('input[name="copy-mode"]'));
  const toggles   = {
    multiSearch: document.getElementById('multiSearchToggle'),
    combinedSearch: document.getElementById('combinedSearchToggle')
  };
  const labels    = document.querySelectorAll('label');

  function updateVisuals() {
    labels.forEach(label => {
      const input = label.querySelector('input');
      if (input && input.checked) label.classList.add('selected');
      else label.classList.remove('selected');
    });
  }

  // Load everything
  chrome.storage.sync.get(
    ['modifierKey','highlightColor','copyMode','multiSearch','combinedSearch'],
    data => {
      if (data.modifierKey)   modEl.value   = data.modifierKey;
      if (data.highlightColor) colorEl.value = data.highlightColor;

      // Copy mode radios (default to 'space')
      const mode = data.copyMode || 'space';
      copyModes.forEach(radio => radio.checked = (radio.value === mode));

      // Menu toggles (default true)
      toggles.multiSearch.checked    = data.multiSearch !== false;
      toggles.combinedSearch.checked = data.combinedSearch !== false;

      updateVisuals();
    }
  );

  saveBtn.addEventListener('click', () => {
    const prefs = {
      modifierKey:   modEl.value,
      highlightColor: colorEl.value,
      copyMode:      document.querySelector('input[name="copy-mode"]:checked').value,
      multiSearch:   toggles.multiSearch.checked,
      combinedSearch: toggles.combinedSearch.checked
    };
    chrome.storage.sync.set(prefs, () => {
      status.textContent = 'Options saved.';
      updateVisuals();
      setTimeout(() => status.textContent = '', 2000);
    });
  });

  // Live visual updates
  [...copyModes, ...Object.values(toggles)].forEach(el => {
    el.addEventListener('change', updateVisuals);
    el.addEventListener('focus', updateVisuals);
    el.addEventListener('blur', updateVisuals);
  });
});