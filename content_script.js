// content_script.js
// Last Updated: 2025-05-14 (Simulated Date for Code Context)

// -----------------------------------------------------------------------------
// FIRST IIFE: SelectionEngine (Assumed to be a separate, pre-existing module)
// This part is largely based on your initial provided code for SelectionEngine.
// -----------------------------------------------------------------------------
(async () => {
  try {
    const prefs = await new Promise((resolve) => {
      if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'getSettings' }, response => {
          if (chrome.runtime.lastError) {
            // console.warn('SelectionEngine: Error getting settings:', chrome.runtime.lastError.message);
            resolve({}); // Resolve with empty object on error to allow defaults
            return;
          }
          resolve(response || {}); // Ensure response is an object
        });
      } else {
        // console.warn('SelectionEngine: Chrome runtime not available for settings.');
        resolve({});
      }
    });

    // Ensure window.SelectionEngine is defined before attempting to use it.
    if (typeof window.SelectionEngine === 'function') {
      const engine = new window.SelectionEngine({
        modifier: (prefs && prefs.modifierKey) || 'Control', // Default to 'Control'
        highlightColor: (prefs && prefs.highlightColor) || 'rgb(219,252,144)' // Default color
      });

      let isSelectionEngineMouseDown = false; // Use a more specific variable name

      document.addEventListener('dblclick', e => {
        if (engine && typeof engine.start === 'function') {
          engine.start(e.clientX, e.clientY);
          isSelectionEngineMouseDown = true;
        }
      });

      document.addEventListener('keydown', e => {
        if (!engine || !engine.isActive || !engine.settings) return;
        if (e.key === engine.settings.modifier) {
          if (typeof engine.addWaypoint === 'function') {
            engine.addWaypoint(e.clientX, e.clientY);
          }
          e.preventDefault(); // Prevent default action for the modifier key if engine is active
        }
      });

      document.addEventListener('mouseup', e => {
        if (!isSelectionEngineMouseDown || !engine || typeof engine.finish !== 'function') {
            isSelectionEngineMouseDown = false; // Reset even if engine or finish is not available
            return;
        }
        isSelectionEngineMouseDown = false;
        const selectionTextResult = engine.finish(); // textResult is a bit generic

        const processAndCopyText = (text) => {
          if (text && typeof text === 'string' && text.trim()) {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
              navigator.clipboard.writeText(text.trim()).catch(err => {
                // console.error('SelectionEngine: Clipboard write error:', err.message);
                // alert('SelectionEngine: Failed to copy text: ' + err.message); // Alert can be intrusive
              });
            } else {
              // console.warn('SelectionEngine: Clipboard API not available.');
            }
          }
        };

        if (selectionTextResult && typeof selectionTextResult.then === 'function') { // Handle if engine.finish() is async
          selectionTextResult.then(resolvedText => {
            processAndCopyText(resolvedText);
          }).catch(err => console.error("SelectionEngine: Error finishing async selection:", err.message));
        } else { // Handle if synchronous
          processAndCopyText(selectionTextResult);
        }
      });
    } else {
      // console.warn("SelectionEngine class not found. The first IIFE's functionality will be affected.");
    }
  } catch (error) {
    console.error("Error in SelectionEngine IIFE:", error.message, error.stack);
  }
})();

// -----------------------------------------------------------------------------
// SECOND IIFE: Multi-Selection, Highlighting, Undo/Redo, and Context Menu Logic
// -----------------------------------------------------------------------------
(() => {
  const HIGHLIGHT_CLASS = 'multi-select-text-highlight'; // More specific class name
  const STORAGE_KEY = 'multiPageSelections'; // More descriptive storage key
  const NOTIFICATION_ID = 'multi-select-notification-banner';
  const HIGHLIGHT_STYLE_ID = 'multi-select-highlight-dynamic-style';

  let selections = []; // Stores: { text, xpath, startOffset, endOffset, highlightElements: [spanNode] }
  let redoStack = [];  // Stores: { text, xpath, startOffset, endOffset } (NO DOM elements)
  let isLocked = false; // Renamed for clarity
  let debounceTimer = null;

  // Default settings, will be updated from chrome.storage or message
  let settings = {
    modifierKey: 'Control', // Default modifier for multi-selection actions
    highlightColor: 'rgb(219,252,144)', // Default highlight color
    copyMode: 'newline' // 'newline', 'space', 'bullets'
  };

  /**
   * Updates local settings and re-applies CSS if needed.
   * @param {Object} newSettings - The new settings object.
   */
  function applySettings(newSettings) {
    if (newSettings) {
      settings.modifierKey = newSettings.modifierKey || settings.modifierKey;
      settings.highlightColor = newSettings.highlightColor || settings.highlightColor;
      settings.copyMode = newSettings.copyMode || settings.copyMode;
    }
    injectHighlightCSS();
    // console.log("MultiSelect: Settings applied", settings);
  }

  /**
   * Injects or updates the CSS for highlighting spans.
   */
  function injectHighlightCSS() {
    let styleElement = document.getElementById(HIGHLIGHT_STYLE_ID);
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = HIGHLIGHT_STYLE_ID;
      document.head.appendChild(styleElement);
    }
    styleElement.textContent = `
      .${HIGHLIGHT_CLASS} {
        background-color: ${settings.highlightColor} !important;
        border-radius: 3px;
        color: inherit !important; /* Crucial for maintaining original text color and contrast */
        padding: 0.1em 0; /* Minimal padding */
        margin: -0.1em 0; /* Counteract padding to maintain line flow */
        display: inline; /* Default for span, but good to be explicit */
      }
    `;
  }

  /**
   * Debounces a function call.
   * @param {Function} fn - The function to debounce.
   * @param {number} delay - The debounce delay in milliseconds.
   */
  function debounce(fn, delay = 150) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fn, delay);
  }

  /**
   * Saves the current selections (serializable data) to local storage.
   */
  async function saveSelectionsToStorage() {
    try {
      const serializableSelections = selections.map(sel => ({
        text: sel.text,
        xpath: sel.xpath,
        startOffset: sel.startOffset,
        endOffset: sel.endOffset,
      }));
      if (chrome && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ [STORAGE_KEY]: serializableSelections });
      }
    } catch (e) {
      console.warn('MultiSelect: Failed to save selections to storage:', e.message);
    }
  }

  /**
   * Loads selections from local storage.
   */
  async function loadSelectionsFromStorage() {
    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        const data = await chrome.storage.local.get([STORAGE_KEY]);
        const loadedData = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
        // Initialize with highlightElements as empty; restoreHighlights will populate them.
        selections = loadedData.map(item => ({ ...item, highlightElements: [] }));
      } else {
        selections = []; // Fallback if storage is not available
      }
    } catch (e) {
      console.warn('MultiSelect: Failed to load selections from storage:', e.message);
      selections = [];
    }
  }

  /**
   * Removes a highlight span from the DOM, restoring its original text content.
   * @param {HTMLElement} span - The highlight span element to unwrap.
   */
  function unwrapHighlightSpan(span) {
    const parent = span.parentNode;
    if (parent) {
      while (span.firstChild) {
        parent.insertBefore(span.firstChild, span);
      }
      parent.removeChild(span);
      parent.normalize(); // Merges adjacent text nodes for clean DOM
    }
  }

  /**
   * Clears all highlight spans added by this script from the DOM.
   */
  function clearAllHighlightsFromDOM() {
    document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach(unwrapHighlightSpan);
  }

  /**
   * Highlights a given DOM Range by wrapping it in a span.
   * @param {Range} range - The DOM Range to highlight.
   * @returns {HTMLElement|null} The created highlight span or null on failure.
   */
  function highlightDOMRange(range) {
    if (!range || range.collapsed) return null;

    // Basic validation for the range
    if (!document.body.contains(range.commonAncestorContainer)) {
      // console.warn("MultiSelect: Range container not in document.", range.commonAncestorContainer);
      return null;
    }
    try {
      // Validate offsets if start/end containers are text nodes
      if (range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset > range.startContainer.textContent.length) {
        // console.warn("MultiSelect: Start offset out of bounds.");
        return null;
      }
      if (range.endContainer.nodeType === Node.TEXT_NODE && range.endOffset > range.endContainer.textContent.length) {
        // console.warn("MultiSelect: End offset out of bounds.");
        return null;
      }
    } catch (e) {
      // console.warn("MultiSelect: Error validating range offsets", e.message);
      return null; // Error accessing textContent length (e.g. node removed)
    }

    const span = document.createElement('span');
    span.className = HIGHLIGHT_CLASS;
    // Styling is handled by the injected CSS class

    try {
      range.surroundContents(span); // This can fail for complex ranges (e.g., spanning table cells partially)
      return span;
    } catch (e) {
      console.error('MultiSelect: Failed to surround contents for highlighting.', e.message, "Range:", range.toString());
      // A more robust solution for complex ranges would involve iterating segments of the range
      // and wrapping individual text nodes, but that's significantly more complex.
      return null;
    }
  }

  /**
   * Restores highlights on the page based on the currently loaded `selections` data.
   */
  async function restoreHighlightsOnPage() {
    clearAllHighlightsFromDOM(); // Ensure a clean slate
    const restoredSelectionsWithLiveElements = [];

    for (const selData of selections) { // 'selections' are from storage (text, xpath, offsets, empty highlightElements)
      try {
        const range = document.createRange();
        // Use document.evaluate to find the node. XPath must point to the text node itself or its parent.
        const result = document.evaluate(selData.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const node = result.singleNodeValue;

        if (node && node.nodeType === Node.TEXT_NODE && // Ensure it's a text node for text selections
            Number.isInteger(selData.startOffset) && Number.isInteger(selData.endOffset) &&
            selData.startOffset >= 0 && selData.startOffset <= node.textContent.length &&
            selData.endOffset >= 0 && selData.endOffset <= node.textContent.length &&
            selData.startOffset <= selData.endOffset) {

          range.setStart(node, selData.startOffset);
          range.setEnd(node, selData.endOffset);

          if (range.collapsed && selData.text.trim() !== "") {
            // console.warn("MultiSelect Restore: Stored range is collapsed but had text:", selData.text, selData.xpath);
            // This might indicate DOM changes or an issue with the stored offsets/XPath.
          }
          
          const currentRangeText = range.toString();
          if (currentRangeText.trim() !== selData.text.trim() && selData.text.trim() !== "") {
              // console.warn(`MultiSelect Restore: Text content mismatch for XPath [${selData.xpath}]. Expected "${selData.text}", found "${currentRangeText}". DOM might have changed.`);
              // Decide whether to still highlight or skip. For now, attempt to highlight what the range covers.
          }

          const highlightedSpan = highlightDOMRange(range.cloneRange()); // Clone for safety before modification
          if (highlightedSpan) {
            restoredSelectionsWithLiveElements.push({
              ...selData, // text, xpath, startOffset, endOffset
              highlightElements: [highlightedSpan] // Add the live DOM element
            });
          } else {
            // console.warn('MultiSelect Restore: Failed to re-highlight stored selection:', selData.text);
            restoredSelectionsWithLiveElements.push({ ...selData, highlightElements: [] }); // Keep data, no live highlight
          }
        } else {
        //   console.warn('MultiSelect Restore: Node not found, not a text node, or offsets invalid for stored selection:',
        //                selData.text, selData.xpath, node ? `Type: ${node.nodeType}` : 'Node null',
        //                `Offsets: ${selData.startOffset}-${selData.endOffset}`, node ? `Len: ${node.textContent.length}` : 'N/A');
          restoredSelectionsWithLiveElements.push({ ...selData, highlightElements: [] });
        }
      } catch (e) {
        console.error('MultiSelect: Error restoring highlight for selection:', selData.text, e.message, e.stack);
        restoredSelectionsWithLiveElements.push({ ...selData, highlightElements: [] }); // Keep data, mark as unhighlighted
      }
    }
    selections = restoredSelectionsWithLiveElements; // Update main selections array with live elements
  }

  /**
   * Generates an XPath expression for a given DOM node.
   * Aims for precision with text nodes by indexing them relative to their parent.
   * @param {Node} targetNode - The DOM node to get the XPath for.
   * @returns {string|null} The XPath string or null on failure.
   */
  function getXPathForNode(targetNode) {
    if (!targetNode || !targetNode.parentNode) {
        // console.warn("getXPathForNode: Target node is null or has no parent.");
        return null;
    }

    // If it's a text node, the XPath should be to its parent element,
    // and then append the text node index (e.g., /text()[1]).
    let effectiveNode = (targetNode.nodeType === Node.TEXT_NODE) ? targetNode.parentNode : targetNode;
    if (!effectiveNode || effectiveNode.nodeType !== Node.ELEMENT_NODE) { // Parent of text node must be an element
        // console.warn("getXPathForNode: Effective node for XPath is not an element.", effectiveNode);
        return null; // Cannot build XPath without an element ancestor
    }

    const pathSegments = [];
    let currentElement = effectiveNode;

    while (currentElement && currentElement.nodeType === Node.ELEMENT_NODE) {
        let segment = currentElement.nodeName.toLowerCase();
        let index = 1;
        let sibling = currentElement.previousElementSibling;
        while (sibling) {
            if (sibling.nodeName === currentElement.nodeName) {
                index++;
            }
            sibling = sibling.previousElementSibling;
        }
        segment += `[${index}]`;
        pathSegments.unshift(segment);

        // Stop if we reach the root of the document
        if (currentElement === document.body || currentElement === document.documentElement) break;
        currentElement = currentElement.parentNode; // Move up to the parent element
    }
    
    // Ensure path is absolute from /html
    let xpath = '/' + pathSegments.join('/');
    if (pathSegments.length > 0) {
        if (pathSegments[0].startsWith('body') && !xpath.startsWith('/html')) {
            xpath = '/html[1]' + xpath;
        } else if (!pathSegments[0].startsWith('html')) {
            // If path doesn't start with html or body, it's likely a fragment or error.
            // A robust solution might require more context, but for now, prepend a sensible root.
            // This fallback might not be universally correct.
            xpath = '/html[1]/body[1]' + (xpath.startsWith('/') ? '' : '/') + xpath.replace(/^\/(html\[1\]\/body\[1\]|html\[1\]|body\[1\])\//, '');

        }
    } else {
        // console.warn("getXPathForNode: Could not generate path segments.", targetNode);
        return null; // No valid path segments generated
    }


    // If the original targetNode was a text node, append its index.
    if (targetNode.nodeType === Node.TEXT_NODE) {
        let textNodeIndex = 1;
        let prevTextSibling = targetNode.previousSibling;
        while (prevTextSibling) {
            if (prevTextSibling.nodeType === Node.TEXT_NODE) {
                textNodeIndex++;
            }
            prevTextSibling = prevTextSibling.previousSibling;
        }
        xpath += `/text()[${textNodeIndex}]`;
    }
    return xpath;
  }

  /**
   * Gets the combined text of all current selections.
   * @param {string} separator - The string to use as a separator between texts.
   * @returns {string} The combined text.
   */
  function getCombinedSelectionText(separator = '\n') {
    return selections.map(sel => sel.text.trim()).join(separator);
  }

  /**
   * Validates the core data of a selection object.
   * @param {Object} selectionData - The selection data to validate.
   * @returns {boolean} True if valid, false otherwise.
   */
  function isValidSelectionDataObject(selectionData) {
    return selectionData &&
           typeof selectionData.text === 'string' && selectionData.text.trim().length > 0 &&
           typeof selectionData.xpath === 'string' && selectionData.xpath.trim().length > 0 &&
           typeof selectionData.startOffset === 'number' && selectionData.startOffset >= 0 &&
           typeof selectionData.endOffset === 'number' && selectionData.endOffset >= 0 &&
           selectionData.startOffset <= selectionData.endOffset;
  }

  /**
   * Handles a new text selection made by the user.
   */
  function processUserSelection() {
    debounce(() => {
      const domSelection = window.getSelection();
      if (!domSelection || domSelection.isCollapsed || domSelection.rangeCount === 0) return;

      const range = domSelection.getRangeAt(0).cloneRange(); // Clone to preserve it
      if (range.collapsed) return;

      const selectedText = domSelection.toString();
      if (!selectedText.trim()) return;

      // Determine the most accurate node and offsets for XPath.
      // XPath should ideally point to the specific text node where selection begins.
      let xPathStartNode = range.startContainer;
      let xPathStartOffset = range.startOffset;

      // If startContainer is an Element node, try to find the actual Text node child
      // that contains the beginning of the selection.
      if (xPathStartNode.nodeType === Node.ELEMENT_NODE) {
        if (xPathStartNode.childNodes.length > xPathStartOffset) {
          const childAtOffset = xPathStartNode.childNodes[xPathStartOffset];
          if (childAtOffset && childAtOffset.nodeType === Node.TEXT_NODE) {
            xPathStartNode = childAtOffset; // Target the text node directly
            xPathStartOffset = 0; // Offset is now 0 within this text node
          } else if (childAtOffset && childAtOffset.firstChild && childAtOffset.firstChild.nodeType === Node.TEXT_NODE) {
            // Dive deeper if selection is at the boundary of an element containing text
            xPathStartNode = childAtOffset.firstChild;
            xPathStartOffset = 0;
          }
        } else if (xPathStartNode.firstChild && xPathStartNode.firstChild.nodeType === Node.TEXT_NODE && xPathStartOffset === 0) {
            // If offset is 0 and first child is text node, use it
            xPathStartNode = xPathStartNode.firstChild;
        }
      }
      
      // Ensure the node used for XPath is a text node if possible, or its element parent.
      const xpath = getXPathForNode(xPathStartNode);

      if (!xpath) {
        // console.warn("MultiSelect: Could not generate XPath for the current selection.");
        domSelection.removeAllRanges(); // Clear the visual selection from the browser
        return;
      }

      // The startOffset and endOffset for storage should be relative to the
      // text node identified by the XPath.
      // If range.startContainer was already a text node, range.startOffset is correct.
      // If we adjusted xPathStartNode, range.startOffset needs to be relative to that.
      // For simplicity, this implementation assumes that if xPathStartNode is a text node,
      // range.startOffset and range.endOffset (if endContainer is same) are valid within it.
      // This is generally true for selections within a single text node.
      // Selections spanning multiple text nodes are more complex to represent with a single XPath and offsets.
      let finalStartOffset = range.startOffset;
      let finalEndOffset = range.endOffset;

      if (range.startContainer !== xPathStartNode && xPathStartNode.nodeType === Node.TEXT_NODE) {
          // This case implies xPathStartNode was derived. If range.startContainer was an element,
          // finalStartOffset was an index into childNodes. Now it should be 0 for the derived text node.
          // This needs careful handling if selection can start mid-element.
          // For now, assuming getXPathForNode gets to the text node, and offsets are relative to *that* node.
          // If the original range.startContainer was the *parent* of xPathStartNode, and original startOffset
          // was the index of xPathStartNode, then the new startOffset for the text itself should be 0.
          // However, DOM selections report offsets *within* the startContainer. If startContainer is Text, offset is char offset.
          // If startContainer is Element, offset is child index.
          // We need char offsets relative to the text node pointed by XPath.
          // This implies range.startContainer must be the text node for reliable offset storage.
           if (xPathStartNode === range.startContainer && xPathStartNode.nodeType === Node.TEXT_NODE) {
               finalStartOffset = range.startOffset;
               finalEndOffset = (range.endContainer === range.startContainer) ? range.endOffset : xPathStartNode.textContent.length;
           } else {
               // If XPath targets a text node but range.startContainer was its parent, we need to adjust.
               // This is complex. For now, we rely on getXPathForNode finding the *actual* text node
               // and assume range.startOffset is relevant if range.startContainer *is* that text node.
               // The most robust way is if range.startContainer is always the text node itself.
               // Let's ensure our XPath points to a text node, and the offsets are for that text node.
               if (range.startContainer.nodeType !== Node.TEXT_NODE) {
                   // console.warn("MultiSelect: Selection start container is not a text node. Offset accuracy may vary.");
                   // Attempt to use the text node derived, assuming selection starts at its beginning for simplicity if offsets are problematic.
                   finalStartOffset = 0; // Default if we had to derive the text node from an element container.
                   finalEndOffset = xPathStartNode.textContent.length; // And select its entirety.
                   // More precise would be to find the original selected string within this text node.
                   const actualSelectedTextInNode = range.toString(); // The part of string that was selected
                   const pos = xPathStartNode.textContent.indexOf(actualSelectedTextInNode);
                   if (pos !== -1) {
                       finalStartOffset = pos;
                       finalEndOffset = pos + actualSelectedTextInNode.length;
                   }
               }
           }
      }
       // If selection spans multiple text nodes, endOffset might be in a different text node.
       // The current XPath targets the start node. Highlighting restoration will use start/end offsets on *that* node.
       // This is a simplification; truly robust multi-node selection restoration is harder.
      if (range.startContainer !== range.endContainer) {
        // console.warn("MultiSelect: Selection spans multiple DOM text nodes. Highlighting might be limited to the first node on restore if DOM changes significantly.");
        // If endContainer is different, endOffset is relative to endContainer.
        // For simplicity, when restoring, we apply endOffset to the startContainer text node.
        // This means we effectively only store/restore the part of the selection within the first text node.
        // To fix this, one would need multiple XPath/offset pairs or a range-based XPath.
        if (range.startContainer.nodeType === Node.TEXT_NODE) {
            finalEndOffset = range.startContainer.textContent.length; // Select till end of the first text node
        }
      }


      const selectionDataObject = {
        text: selectedText,
        xpath: xpath,
        startOffset: finalStartOffset,
        endOffset: finalEndOffset,
      };

      if (!isValidSelectionDataObject(selectionDataObject)) {
        // console.warn("MultiSelect: Invalid selection data object created.", selectionDataObject);
        domSelection.removeAllRanges();
        return;
      }

      const highlightedSpan = highlightDOMRange(range.cloneRange()); // Highlight the current visual selection
      if (!highlightedSpan) {
        // console.warn("MultiSelect: Failed to highlight the new selection.");
        domSelection.removeAllRanges();
        return;
      }

      selections.push({
        ...selectionDataObject,
        highlightElements: [highlightedSpan] // Store the live DOM element
      });
      redoStack = []; // CRITICAL: A new selection clears the redo stack.
      saveSelectionsToStorage();
      domSelection.removeAllRanges(); // Clear the browser's visual selection after processing
    }, 80); // Debounce to handle rapid mouse movements during selection
  }

  /**
   * Undoes the last selection. Moves it to the redo stack.
   */
  function undoLastSelection() {
    if (selections.length === 0) {
      showAppNotification('Nothing to undo.');
      return;
    }

    const undoneSelection = selections.pop(); // This object has { text, xpath, ..., highlightElements }
    if (!undoneSelection) return; // Should not happen if length > 0

    // Remove the highlight spans from the DOM
    if (undoneSelection.highlightElements && undoneSelection.highlightElements.length > 0) {
      undoneSelection.highlightElements.forEach(unwrapHighlightSpan);
    } else {
    //   console.warn("MultiSelect Undo: Selection being undone had no highlight elements tracked.", undoneSelection.text);
    }

    // Push only the serializable data part to the redoStack
    const serializableUndoneData = {
      text: undoneSelection.text,
      xpath: undoneSelection.xpath,
      startOffset: undoneSelection.startOffset,
      endOffset: undoneSelection.endOffset
    };
    redoStack.push(serializableUndoneData);

    saveSelectionsToStorage(); // Save the state after removing one selection
    showAppNotification('Selection undone.');
  }

  /**
   * Redoes the last undone selection.
   */
  function redoLastUndoneSelection() {
    if (redoStack.length === 0) {
      showAppNotification('Nothing to redo.');
      return;
    }

    const dataToRedo = redoStack.pop(); // This is { text, xpath, startOffset, endOffset }
    if (!dataToRedo || !isValidSelectionDataObject(dataToRedo)) {
    //   console.warn("MultiSelect Redo: Invalid data popped from redo stack.", dataToRedo);
      showAppNotification('Redo failed: Invalid data.');
      // Optionally, push it back if it's a recoverable error, or just discard.
      // if (dataToRedo) redoStack.push(dataToRedo);
      return;
    }

    try {
      const range = document.createRange();
      const result = document.evaluate(dataToRedo.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      const node = result.singleNodeValue;

      if (node && node.nodeType === Node.TEXT_NODE && // Must be a text node
          dataToRedo.startOffset <= node.textContent.length && dataToRedo.endOffset <= node.textContent.length &&
          dataToRedo.startOffset <= dataToRedo.endOffset) { // Offsets must be valid for current node content

        range.setStart(node, dataToRedo.startOffset);
        range.setEnd(node, dataToRedo.endOffset);
        
        // Optional: Validate if the text content at the re-found range still matches the stored text.
        const currentRangeText = range.toString();
        if (currentRangeText.trim() !== dataToRedo.text.trim()) {
            // console.warn(`MultiSelect Redo: Text content mismatch. Expected "${dataToRedo.text}", found "${currentRangeText}". DOM may have changed. Attempting highlight anyway.`);
        }

        const highlightedSpan = highlightDOMRange(range.cloneRange()); // Re-highlight the range

        if (highlightedSpan) {
          const liveRedoneSelection = {
            ...dataToRedo, // text, xpath, startOffset, endOffset
            highlightElements: [highlightedSpan] // Add the NEW live highlight element
          };
          selections.push(liveRedoneSelection); // Add back to the main selections array
          saveSelectionsToStorage();
          showAppNotification('Selection redone.');
        } else {
        //   console.warn("MultiSelect Redo: Failed to re-highlight selection. Pushing data back to redo stack.", dataToRedo.text);
          redoStack.push(dataToRedo); // Push back if re-highlighting failed, allowing another try
          showAppNotification('Redo failed: Could not re-highlight.');
        }
      } else {
        // console.warn('MultiSelect Redo: Node not found, not a text node, or offsets invalid for redo. Pushing back.',
        //              dataToRedo.text, dataToRedo.xpath, node ? `Type: ${node.nodeType}` : 'Node null',
        //              `Offsets: ${dataToRedo.startOffset}-${dataToRedo.endOffset}`, node ? `Len: ${node.textContent.length}` : 'N/A');
        redoStack.push(dataToRedo); // Push back data if node/range is invalid
        showAppNotification('Redo failed: Selection data invalid or DOM changed significantly.');
      }
    } catch (e) {
      console.error('MultiSelect: Error during redo operation:', dataToRedo.text, e.message, e.stack);
      redoStack.push(dataToRedo); // Push back on generic error
      showAppNotification('Redo error.');
    }
  }

  /**
   * Toggles the lock state for selections.
   */
  function toggleSelectionLock() {
    isLocked = !isLocked;
    showAppNotification(isLocked ? 'Selections locked.' : 'Selections unlocked.');
    // Note: Unlocking does not clear selections. Clearing happens on explicit user action or page conditions.
  }

  let notificationTimeout;
  /**
   * Shows a temporary notification message on the screen.
   * @param {string} message - The message to display.
   */
  function showAppNotification(message) {
    clearTimeout(notificationTimeout);
    let notificationElement = document.getElementById(NOTIFICATION_ID);
    if (!notificationElement) {
      notificationElement = document.createElement('div');
      notificationElement.id = NOTIFICATION_ID;
      // Basic styling, can be enhanced with CSS classes
      notificationElement.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 2147483647; /* Max z-index */
        background-color: #333;
        color: #fff;
        padding: 12px 20px;
        border-radius: 6px;
        font-size: 14px;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
        box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        opacity: 0;
        transform: translateY(-10px);
        transition: opacity 0.3s ease-out, transform 0.3s ease-out;
        max-width: 300px;
        word-wrap: break-word;
      `;
      document.body.appendChild(notificationElement);
    }

    notificationElement.textContent = message;
    // Trigger reflow for transition animation to play correctly
    // eslint-disable-next-line no-unused-expressions
    notificationElement.offsetHeight; // Reading offsetHeight forces a reflow

    notificationElement.style.opacity = '1';
    notificationElement.style.transform = 'translateY(0px)';

    notificationTimeout = setTimeout(() => {
      if (notificationElement) {
        notificationElement.style.opacity = '0';
        notificationElement.style.transform = 'translateY(-10px)';
        // Remove from DOM after transition
        setTimeout(() => {
          if (notificationElement && notificationElement.parentNode && notificationElement.style.opacity === '0') {
            notificationElement.remove();
          }
        }, 350); // Matches transition duration + a bit
      }
    }, 2800); // Notification visible duration
  }

  // --- Event Listeners ---
  let isModifierKeyForMultiSelectActive = false;

  document.addEventListener('keydown', e => {
    // Check if the specific modifier key for multi-selection is pressed
    if (e.key === settings.modifierKey) {
      isModifierKeyForMultiSelectActive = true;
    }

    const isCtrlOrCmd = e.ctrlKey || e.metaKey; // For standard OS-level shortcuts

    // Undo: Ctrl/Cmd + Z (without Shift)
    if (isCtrlOrCmd && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault(); // Prevent browser's default undo
      undoLastSelection();
    }
    // Redo: (Ctrl/Cmd + Shift + Z) OR (Ctrl/Cmd + Y)
    if ( (isCtrlOrCmd && e.shiftKey && e.key.toLowerCase() === 'z') ||
         (isCtrlOrCmd && !e.shiftKey && e.key.toLowerCase() === 'y') ) {
      e.preventDefault(); // Prevent browser's default redo
      redoLastUndoneSelection();
    }
    // Toggle Lock: Example: Ctrl/Cmd + Shift + L
    if (isCtrlOrCmd && e.shiftKey && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      toggleSelectionLock();
    }

    // Custom Copy: (Ctrl/Cmd + C)
    // Only if our multi-select modifier key is ALSO active, to distinguish from normal copy.
    // OR, if there are selections and the user just presses Ctrl/Cmd+C, assume they want to copy multi-selections.
    // Let's make it so that if selections exist, Ctrl/Cmd+C copies them.
    if (isCtrlOrCmd && e.key.toLowerCase() === 'c') {
      if (selections.length > 0) {
        e.preventDefault(); // Prevent default browser copy if we are handling it
        
        let separator = '\n'; // Default for 'newline'
        if (settings.copyMode === 'space') {
          separator = ' ';
        } else if (settings.copyMode === 'bullets') {
          separator = '\n• '; // Separator includes the bullet for subsequent items
        }

        let textToCopy;
        if (settings.copyMode === 'bullets') {
          // Add bullet to the first item as well if using bullet mode
          textToCopy = selections.length > 0 ? '• ' + selections.map(s => s.text.trim()).join('\n• ') : '';
        } else {
          textToCopy = getCombinedSelectionText(separator);
        }

        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(textToCopy)
            .then(() => showAppNotification('Selected texts copied!'))
            .catch(err => {
              console.error('MultiSelect: Clipboard write error:', err.message);
              showAppNotification('Copy failed: ' + err.message);
            });
        } else {
          showAppNotification('Copy failed: Clipboard not available.');
        }
      }
      // If no selections, let default Ctrl+C behavior proceed.
    }
  });

  document.addEventListener('keyup', e => {
    if (e.key === settings.modifierKey) {
      isModifierKeyForMultiSelectActive = false;
    }
  });

  document.addEventListener('mouseup', e => {
    // Only process for left mouse button releases
    if (e.button !== 0) return;

    // If the multi-select modifier key is active, attempt to process a new selection.
    if (isModifierKeyForMultiSelectActive) {
      processUserSelection(); // This function is debounced
      // Modifier key state will be reset by its 'keyup' event.
      return; // Prevent clearing logic below if a selection was just potentially made.
    }

    // If selections are NOT locked AND the multi-select modifier is NOT active:
    // Clear selections if the click occurs outside any existing highlight or extension UI.
    if (!isLocked && !isModifierKeyForMultiSelectActive) {
      const targetElement = e.target;
      // Check if the click target is part of our highlights or notifications
      if (targetElement && typeof targetElement.closest === 'function' && // Ensure closest method exists
          !targetElement.closest(`.${HIGHLIGHT_CLASS}`) &&
          !targetElement.closest(`#${NOTIFICATION_ID}`)) {
        
        if (selections.length > 0) {
          clearAllHighlightsFromDOM();
          selections = [];
          redoStack = []; // CRITICAL: Clearing all selections also clears the redo stack.
          saveSelectionsToStorage();
          // showAppNotification('Selections cleared.'); // Optional: can be noisy if cleared frequently.
        }
      }
    }
  });

  // Listen for messages from background script or popup (e.g., settings updates)
  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'getSelectionsForPopup') { // Example message type
        sendResponse({ selections: selections.map(s => s.text) });
      } else if (message.type === 'settingsUpdated') {
        // console.log("MultiSelect: Received settings update from background/popup", message.settings);
        applySettings(message.settings);
        // Optionally, re-render existing highlights if only color changed and want immediate effect without page reload
        // For now, injectHighlightCSS updates the class definition.
        // restoreHighlightsOnPage(); // Could be called to force re-draw with new color, but might be slow.
      } else if (message.type === 'clearAllPageSelections') {
          clearAllHighlightsFromDOM();
          selections = [];
          redoStack = [];
          saveSelectionsToStorage();
          showAppNotification('All selections cleared via extension action.');
          sendResponse({status: "cleared"});
      }
      return true; // Keep message channel open for asynchronous sendResponse if needed.
    });
  }

  // Clean up or save state before the page is unloaded
  window.addEventListener('beforeunload', () => {
    // saveSelectionsToStorage(); // Good practice, though frequent saves already occur.
    // DOM highlights will be gone with the page anyway. Storage handles persistence.
  });

  /**
   * Initializes the multi-selection script.
   * Loads settings, injects CSS, loads prior selections, and restores highlights.
   */
  async function initializeMultiSelect() {
    // Fetch initial settings first
    if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'getSettings' }, initialSettings => {
        if (chrome.runtime.lastError) {
        //   console.warn('MultiSelect Init: Error getting initial settings:', chrome.runtime.lastError.message);
          applySettings({}); // Use defaults
        } else {
          applySettings(initialSettings || {});
        }
        // After settings (and CSS) are ready, load and restore highlights
        loadAndRestore();
      });
    } else {
      // console.warn('MultiSelect Init: Chrome runtime not available. Using default settings.');
      applySettings({}); // Apply default settings and CSS
      loadAndRestore();
    }
  }

  async function loadAndRestore() {
    await loadSelectionsFromStorage(); // Loads data into `selections` (without live elements yet)
    await restoreHighlightsOnPage(); // Re-applies highlights to the DOM and populates `highlightElements`
    // console.log("MultiSelect: Script initialized. Highlights restored (if any).");
  }

  // Wait for the DOM to be fully loaded before initializing to ensure all elements are available.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeMultiSelect);
  } else {
    initializeMultiSelect().catch(err => console.error("MultiSelect: Initialization failed:", err.message, err.stack));
  }

})();