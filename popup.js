// popup.js
document.addEventListener('DOMContentLoaded', () => {
  const modSel   = document.getElementById('modifier');
  const colInp   = document.getElementById('color');
  const saveBtn  = document.getElementById('save');
  const status   = document.getElementById('status');
  const copyModes = Array.from(document.querySelectorAll('input[name="copy-mode"]'));
  const toggles   = {
    multiSearch: document.getElementById('multiSearchToggle'),
    combinedSearch: document.getElementById('combinedSearchToggle')
  };
  const labels   = document.querySelectorAll('label');
  const radioLabels = Array.from(document.querySelectorAll('.radio-group label'));
  const toggleLabels = Array.from(document.querySelectorAll('.toggle label'));
  const colorInput = document.getElementById('highlightColor');
  const colorPreview = document.getElementById('highlightPreview');

  function updateVisuals() {
    labels.forEach(label => {
      const input = label.querySelector('input');
      if (input && input.checked) label.classList.add('selected');
      else label.classList.remove('selected');
    });
    // Radios
    radioLabels.forEach(label => {
      const radio = label.querySelector('input[type="radio"]');
      if (radio.checked) label.classList.add('selected');
      else label.classList.remove('selected');
    });
    // Checkboxes
    toggleLabels.forEach(label => {
      const checkbox = label.querySelector('input[type="checkbox"]');
      if (checkbox.checked) label.classList.add('selected');
      else label.classList.remove('selected');
    });
    // Color preview
    if (colorInput && colorPreview) {
      colorPreview.style.background = colorInput.value;
    }
  }

  // Load settings
  chrome.storage.sync.get(
    ['modifierKey','highlightColor','copyMode','multiSearch','combinedSearch'],
    prefs => {
      if (modSel && prefs.modifierKey) modSel.value = prefs.modifierKey;
      if (colInp && prefs.highlightColor) colInp.value = prefs.highlightColor;

      // Default to 'space' if not set
      const mode = prefs.copyMode || 'space';
      copyModes.forEach(r => r.checked = (r.value === mode));

      // Default to true if not set
      if (toggles.multiSearch) toggles.multiSearch.checked    = prefs.multiSearch !== false;
      if (toggles.combinedSearch) toggles.combinedSearch.checked = prefs.combinedSearch !== false;

      updateVisuals();
    }
  );

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const prefs = {
        modifierKey: modSel ? modSel.value : 'Control',
        highlightColor: colInp ? colInp.value : '#dbfc90',
        copyMode: document.querySelector('input[name="copy-mode"]:checked')?.value || 'space',
        multiSearch: toggles.multiSearch ? toggles.multiSearch.checked : true,
        combinedSearch: toggles.combinedSearch ? toggles.combinedSearch.checked : true
      };
      chrome.storage.sync.set(prefs, () => {
        status.textContent = 'Saved.';
        updateVisuals();
        setTimeout(() => status.textContent = '', 1500);
      });
    });
  }

  // Visual feedback
  [...copyModes, ...Object.values(toggles)].forEach(el => {
    if (!el) return;
    el.addEventListener('change', updateVisuals);
    el.addEventListener('focus', updateVisuals);
    el.addEventListener('blur', updateVisuals);
  });

  // Save copy mode
  copyModes.forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        chrome.storage.sync.set({ copyMode: radio.value }, () => {
          status.textContent = 'Copy mode saved!';
          updateVisuals();
          setTimeout(() => status.textContent = '', 1200);
        });
      }
    });
  });

  // Save context menu toggles
  [toggles.multiSearch, toggles.combinedSearch].forEach(toggle => {
    if (!toggle) return;
    toggle.addEventListener('change', () => {
      const key = toggle.id.replace('Toggle', '');
      chrome.storage.sync.set({ [key]: toggle.checked }, () => {
        status.textContent = 'Menu option saved!';
        updateVisuals();
        setTimeout(() => status.textContent = '', 1200);
      });
    });
  });

  // Save highlight color and update preview
  if (colorInput) {
    colorInput.addEventListener('input', () => {
      updateVisuals();
      chrome.storage.sync.set({ highlightColor: colorInput.value }, () => {
        status.textContent = 'Highlight color saved!';
        setTimeout(() => status.textContent = '', 1200);
      });
    });
  }

  // Keyboard accessibility: highlight on focus
  copyModes.forEach(radio => {
    radio.addEventListener('focus', updateVisuals);
    radio.addEventListener('blur', updateVisuals);
  });
  [toggles.multiSearch, toggles.combinedSearch].forEach(toggle => {
    if (!toggle) return;
    toggle.addEventListener('focus', updateVisuals);
    toggle.addEventListener('blur', updateVisuals);
  });
});