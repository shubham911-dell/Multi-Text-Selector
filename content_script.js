// content_script.js

// First IIFE (SelectionEngine part) - unchanged from your provided code
(async () => {
  const prefs = await new Promise(res => {
    chrome.runtime.sendMessage({type: 'getSettings'}, res);
  });

  // Assuming window.SelectionEngine is defined elsewhere or in another script.
  // If not, this block will cause an error.
  if (typeof window.SelectionEngine === 'function') {
    const engine = new window.SelectionEngine({
      modifier: prefs.modifierKey || 'Control',
      highlightColor: prefs.highlightColor || 'rgba(180,213,255,0.6)'
    });

    let isMouseDown = false;

    document.addEventListener('dblclick', e => {
      engine.start(e.clientX, e.clientY);
      isMouseDown = true;
    });

    document.addEventListener('keydown', e => {
      if (!engine.isActive) return;
      if (e.key === engine.settings.modifier) {
        // Original code used document.pointerLockElement || e;
        // clientX/Y are not properties of e if pointerLockElement is null.
        // Using e.clientX, e.clientY directly for simplicity, assuming standard event context.
        engine.addWaypoint(e.clientX, e.clientY);
        e.preventDefault();
      }
    });

    document.addEventListener('mouseup', e => {
      if (!isMouseDown) return;
      isMouseDown = false;
      const text = engine.finish();
      if (text && typeof text.then === 'function') { // If engine.finish() is async
        text.then(resolvedText => {
          if (resolvedText && resolvedText.trim()) {
            navigator.clipboard.writeText(resolvedText).catch(err => {
              alert('Failed to copy text to clipboard: ' + err.message);
              console.error('Clipboard error:', err);
            });
          }
        }).catch(err => console.error("Error finishing selection:", err));
      } else if (text && text.trim()) { // If synchronous
        navigator.clipboard.writeText(text).catch(err => {
          alert('Failed to copy text to clipboard: ' + err.message);
          console.error('Clipboard error:', err);
        });
      }
    });
  } else {
    console.warn("SelectionEngine not defined. The first IIFE's functionality might be affected.");
  }
})();


// Multi-selection and context menu logic (Revised)
(() => {
  const HIGHLIGHT_CLASS = 'multi-select-highlight';
  const STORAGE_KEY = 'multiSelections';
  let selections = [];
  let redoStack = [];
  let locked = false;
  let debounceTimer = null;

  // --- Utility Functions ---

  function debounce(fn, delay = 100) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fn, delay);
  }

  async function saveSelections() {
    try {
      // Store a serializable version of selections (without live DOM elements)
      const serializableSelections = selections.map(sel => ({
        text: sel.text,
        xpath: sel.xpath,
        startOffset: sel.startOffset,
        endOffset: sel.endOffset,
      }));
      await chrome.storage.local.set({ [STORAGE_KEY]: serializableSelections });
    } catch (e) {
      console.warn('Failed to save selections:', e);
    }
  }

  async function loadSelections() {
    try {
      const data = await chrome.storage.local.get([STORAGE_KEY]);
      const loadedData = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
      // Selections will be populated by restoreHighlights after this,
      // where highlightElements will be added.
      selections = loadedData.map(item => ({...item, highlightElements: []}));
    } catch (e) {
      console.warn('Failed to load selections:', e);
      selections = [];
    }
  }

  function clearAllHighlightsFromDOM() {
    document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach(span => {
      const parent = span.parentNode;
      if (parent) {
        // Replace the span with its text content
        // More robustly, move children out if span could contain other nodes.
        // For simple text, textContent is fine.
        while (span.firstChild) {
            parent.insertBefore(span.firstChild, span);
        }
        parent.removeChild(span);
        parent.normalize(); // Merge adjacent text nodes
      }
    });
  }

  function highlightRange(range) {
    if (!range || range.collapsed) return null;
    const span = document.createElement('span');
    span.className = HIGHLIGHT_CLASS;
    // Styling is now primarily handled by injected CSS.
    // span.style.background = 'rgba(255,51,51,0.5)'; // Removed, rely on CSS class

    try {
      // Clone the range contents before surrounding to avoid issues with the original range
      // If the range partially selects nodes, surroundContents can fail.
      // A more robust method involves iterating segments of the range.
      // For simplicity, we stick to surroundContents and catch errors.
      range.surroundContents(span);
      return span;
    } catch (e) {
      console.error('Failed to surround contents for highlighting. Range might be complex or invalid.', e, range.toString());
      // Fallback: could try to wrap text nodes within the range individually, but that's more complex.
      return null;
    }
  }

  async function restoreHighlights() {
    clearAllHighlightsFromDOM(); // Clear existing DOM highlights first
    const restoredSelections = [];

    for (const selData of selections) { // 'selections' here are from storage (text, xpath, offsets)
        try {
            const range = document.createRange();
            // Evaluate XPath
            const result = document.evaluate(selData.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            const node = result.singleNodeValue;

            if (node && node.nodeType === Node.TEXT_NODE &&
                Number.isInteger(selData.startOffset) && Number.isInteger(selData.endOffset) &&
                selData.startOffset <= node.textContent.length && selData.endOffset <= node.textContent.length &&
                selData.startOffset <= selData.endOffset) {

                range.setStart(node, selData.startOffset);
                range.setEnd(node, selData.endOffset);

                if (range.collapsed && selData.text.trim() !== "") {
                    // If range is collapsed but text was stored, XPath might be off or DOM changed.
                    console.warn("Stored selection range is collapsed on restore, but had text:", selData.text, selData.xpath);
                    // Attempt to expand range if it makes sense or skip.
                }
                
                const highlightedSpan = highlightRange(range.cloneRange()); // Clone for safety
                if (highlightedSpan) {
                    restoredSelections.push({
                        ...selData,
                        highlightElements: [highlightedSpan]
                    });
                } else {
                    console.warn('Failed to re-highlight stored selection:', selData.text);
                    restoredSelections.push({ ...selData, highlightElements: [] }); // Keep data, no live highlight
                }
            } else {
                console.warn('Node not found, not a text node, or offsets invalid for stored selection:', selData.text, selData.xpath, node ? node.nodeType : 'null', selData.startOffset, selData.endOffset, node ? node.textContent.length : 'N/A');
                restoredSelections.push({ ...selData, highlightElements: [] });
            }
        } catch (e) {
            console.error('Error restoring highlight for selection:', selData.text, e);
            restoredSelections.push({ ...selData, highlightElements: [] });
        }
    }
    selections = restoredSelections; // Update main selections array with live elements
}


  // Your existing getXPath or a more robust one
  function getXPath(node) {
    // Using your provided getXPath. Consider improving for robustness if needed.
    if (node.nodeType !== Node.TEXT_NODE && !(node.nodeType === Node.ELEMENT_NODE && node.childNodes.length === 0) ) { // Allow empty elements if that's a target
        // If startContainer is an element, try to find the first text node within it for the path,
        // or adjust path logic. For now, let's assume typical selections start in text nodes.
        // console.warn("getXPath: startContainer is not a text node. Path might be inaccurate.", node);
        // For simplicity, we'll try to get path to parent if node isn't text, assuming offset will be 0.
        // This part might need careful review based on how selections are made.
    }

    let path = '';
    let parent = (node.nodeType === Node.TEXT_NODE) ? node.parentNode : node;

    while (parent && parent !== document.body && parent !== document.documentElement) {
        let idx = 1;
        let sib = parent.previousSibling;
        while (sib) {
            if (sib.nodeName === parent.nodeName) idx++;
            sib = sib.previousSibling;
        }
        path = `/${parent.nodeName.toLowerCase()}[${idx}]` + path; // Use lowercase for consistency
        parent = parent.parentNode;
    }
    // Prepend /html/body structure
    if (parent === document.body) {
        path = `/html[1]/body[1]` + path;
    } else if (parent === document.documentElement) {
        path = `/html[1]` + path;
    } else {
        // Fallback if path resolution stopped unexpectedly
        path = (parent ? `/${parent.nodeName.toLowerCase()}[1]` : '') + path;
    }

    // Append /text() if original node was a text node
    if (node.nodeType === Node.TEXT_NODE) {
        let textIdx = 1;
        let prevTextSib = node.previousSibling;
        while(prevTextSib){
            if(prevTextSib.nodeType === Node.TEXT_NODE) textIdx++;
            prevTextSib = prevTextSib.previousSibling;
        }
        return path + `/text()[${textIdx}]`;
    }
    return path;
}

  function getSelectionTextForCopy(separator = '\n') { // Renamed to avoid conflict
    return selections.map(sel => sel.text).join(separator);
  }

  function isValidSelection(sel) {
    return sel && typeof sel.text === 'string' && sel.text.trim().length > 0 &&
           typeof sel.xpath === 'string' && sel.xpath.trim().length > 0 &&
           typeof sel.startOffset === 'number' && typeof sel.endOffset === 'number';
  }

  // --- Event Handlers & Actions ---

  function handleSelection(e) {
    debounce(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

      const range = sel.getRangeAt(0).cloneRange(); // Clone to work with it
      if (range.collapsed) return;

      const text = sel.toString();
      if (!text.trim()) return;

      // Ensure startContainer is suitable for getXPath (e.g., text node or element)
      const startNodeForXPath = range.startContainer;
      const xpath = getXPath(startNodeForXPath);

      if (!xpath) {
        console.warn("Could not generate XPath for selection.", range.startContainer);
        sel.removeAllRanges(); // Clear browser selection as we couldn't process it
        return;
      }

      const highlightedSpan = highlightRange(range.cloneRange()); // Highlight a clone of the range

      // If highlighting failed (e.g. complex range across block elements),
      // we might choose not to add the selection, or add it without a visual highlight.
      if (!highlightedSpan) {
          console.warn("Failed to highlight the new selection. Selection not added.", text);
          sel.removeAllRanges();
          return;
      }

      const selectionObj = {
        text,
        xpath,
        startOffset: range.startOffset,
        endOffset: range.endOffset,
        highlightElements: [highlightedSpan] // Store the actual DOM element(s)
      };

      if (!isValidSelection(selectionObj)) {
        console.warn("Invalid selection object created.", selectionObj);
        // Attempt to clean up the created span if it exists but object is invalid
        if (highlightedSpan && highlightedSpan.parentNode) {
            const parent = highlightedSpan.parentNode;
            while(highlightedSpan.firstChild) parent.insertBefore(highlightedSpan.firstChild, highlightedSpan);
            parent.removeChild(highlightedSpan);
            parent.normalize();
        }
        sel.removeAllRanges();
        return;
      }

      selections.push(selectionObj);
      redoStack = []; // Clear redoStack on new selection
      saveSelections();
      sel.removeAllRanges(); // Clear native browser selection after custom handling
    }, 80);
  }

  function undoSelection() {
    if (selections.length === 0) return;

    const undoneSelection = selections.pop();
    if (!undoneSelection) return;

    // Remove the specific highlights for this undone selection from the DOM
    if (undoneSelection.highlightElements && undoneSelection.highlightElements.length > 0) {
      undoneSelection.highlightElements.forEach(span => {
        if (span && span.parentNode) {
          const parent = span.parentNode;
          while (span.firstChild) { // Move content out of span
            parent.insertBefore(span.firstChild, span);
          }
          parent.removeChild(span);
          parent.normalize(); // Merge adjacent text nodes
        }
      });
    } else {
        console.warn("Undo: Selection to undo had no highlight elements.", undoneSelection.text);
        // If no highlight elements, it implies an issue earlier or selection from non-highlighted storage.
        // No DOM action needed, but good to log.
    }

    redoStack.push(undoneSelection); // Add to redo stack
    saveSelections(); // Save the modified selections array
    showNotification('Selection undone.');
  }

  function redoSelection() {
    if (redoStack.length === 0) return;

    const redoneSelectionData = redoStack.pop();
    if (!redoneSelectionData) return;

    try {
        const range = document.createRange();
        const result = document.evaluate(redoneSelectionData.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const node = result.singleNodeValue;

        if (node && node.nodeType === Node.TEXT_NODE &&
            Number.isInteger(redoneSelectionData.startOffset) && Number.isInteger(redoneSelectionData.endOffset) &&
            redoneSelectionData.startOffset <= node.textContent.length && redoneSelectionData.endOffset <= node.textContent.length &&
            redoneSelectionData.startOffset <= redoneSelectionData.endOffset) {

            range.setStart(node, redoneSelectionData.startOffset);
            range.setEnd(node, redoneSelectionData.endOffset);
            
            const highlightedSpan = highlightRange(range.cloneRange()); // Re-highlight

            if (highlightedSpan) {
                const liveRedoneSelection = {
                    ...redoneSelectionData,
                    highlightElements: [highlightedSpan]
                };
                selections.push(liveRedoneSelection); // Add back to selections with live highlight
                saveSelections();
                showNotification('Selection redone.');
            } else {
                console.warn("Redo: Failed to re-highlight selection. Pushing back to redo stack.", redoneSelectionData.text);
                redoStack.push(redoneSelectionData); // Push back if highlighting failed
                showNotification('Redo failed: Could not re-highlight.');
            }
        } else {
            console.warn('Redo: Node not found or offsets invalid for selection. Pushing back to redo stack.', redoneSelectionData.text, redoneSelectionData.xpath);
            redoStack.push(redoneSelectionData); // Push back if node/range is invalid
            showNotification('Redo failed: Selection data invalid.');
        }
    } catch (e) {
        console.error('Error redoing selection:', redoneSelectionData.text, e);
        redoStack.push(redoneSelectionData); // Push back on error
        showNotification('Redo error.');
    }
  }

  function toggleLock() {
    locked = !locked;
    showNotification(locked ? 'Selections locked.' : 'Selections unlocked.');
    // Do NOT clear selections or highlights when unlocking!
    // Just toggle the lock state and notify the user.
  }

  function showNotification(msg) {
    let n = document.getElementById('multi-select-notify');
    if (!n) {
      n = document.createElement('div');
      n.id = 'multi-select-notify';
      // Using CSS for styling is generally better, but inline styles are fine for dynamic elements.
      n.style.cssText = 'position:fixed;top:20px;right:20px;z-index:2147483647;background:#333;color:#fff;padding:10px 18px;border-radius:5px;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.15); opacity:0; transition: opacity 0.3s ease-out; font-family: sans-serif;';
      document.body.appendChild(n);
    }
    n.textContent = msg;
    n.style.opacity = '1'; // Fade in
    setTimeout(() => {
      n.style.opacity = '0'; // Fade out
      // Optional: remove element after fade out to keep DOM clean if not reused soon
      // setTimeout(() => { if (n.style.opacity === '0') n.remove(); }, 300);
    }, 2200); // Increased duration for visibility
  }

  // --- Event Listeners ---

  let ctrlSelecting = false;

  // Track Ctrl key state
  document.addEventListener('keydown', e => {
    if (e.key === 'Control') ctrlSelecting = true;

    // --- Multi-selection shortcuts only if ctrlSelecting ---
    if (ctrlSelecting) {
      // Undo: Ctrl+Z or Cmd+Z (no Shift)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undoSelection();
      }
      // Redo: Ctrl+Shift+Z or Cmd+Shift+Z
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        redoSelection();
      }
      // Redo: Ctrl+Y or Cmd+Y (no Shift)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redoSelection();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        toggleLock();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (selections.length > 0) {
          e.preventDefault();
          chrome.storage.sync.get(['copyMode'], data => {
            let sep = '\n';
            const mode = data.copyMode;
            if (mode === 'space') sep = ' ';
            else if (mode === 'bullets') sep = '\n• ';
            let textToCopy = getSelectionTextForCopy(sep);
            if (mode === 'bullets') {
              if (!textToCopy.startsWith('• ') && selections.length > 0) {
                   textToCopy = '• ' + selections.map(s => s.text).join('\n• ');
              }
            }
            try {
              navigator.clipboard.writeText(textToCopy);
              showNotification('Selected texts copied!');
            } catch (err) {
              console.error('Clipboard write error:', err);
              showNotification('Copy failed: ' + err.message);
            }
          });
        }
      }
    }
  });

  document.addEventListener('keyup', e => {
    if (e.key === 'Control') ctrlSelecting = false;
  });

  document.addEventListener('mouseup', e => {
    // Only run custom selection if ctrlSelecting is true
    if (ctrlSelecting) {
      // Only trigger selection on left-click (button 0)
      if (e.button !== 0) return;

      handleSelection(e);
      return;
    }

    // If not locked and not ctrlSelecting, clear all selections on click anywhere
    if (!locked) {
      if (selections.length > 0) {
        clearAllHighlightsFromDOM();
        selections = [];
        redoStack = [];
        saveSelections();
      }
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'getSelections') {
      // Send only the text for context menu or other requests
      sendResponse({ selections: selections.map(s => s.text) });
    }
    return true; // Keep message channel open for async response if needed.
  });

  window.addEventListener('beforeunload', () => {
    // clearAllHighlightsFromDOM(); // Highlights will be gone anyway.
    // No need to clear storage here if selections should persist across sessions.
    // Original code cleared storage, which might be desired if selections are per-page-visit.
    // For persistence as implemented with load/save, don't remove here.
    // If you want selections to be transient per visit:
    // chrome.storage.local.remove([STORAGE_KEY]);
  });

  // Initial load and highlight restoration
  async function init() {
    await loadSelections();
    await restoreHighlights();

    // Inject CSS for highlights
    const style = document.createElement('style');
    style.textContent = `
      .${HIGHLIGHT_CLASS} {
        background:rgb(107, 138, 157) !important; /* Example color from original code */
        border-radius: 3px;
        /* box-shadow: 0 0 0 1px rgba(255, 51, 51, 0.7); */ /* Optional border */
        color: inherit !important; /* Prevent text color changes */
        padding: 0.1em 0; /* Slight vertical padding for better visual */
        margin: -0.1em 0; /* Counteract padding to maintain line height */
        display: inline; /* Default, but good to be explicit */
        /* transition: background 0.2s; */ /* Transition can be nice but sometimes distracting */
      }
    `;
    document.head.appendChild(style);
    console.log("Multi-selection script initialized and highlights restored.");
  }

  init().catch(err => console.error("Initialization failed:", err));

})();