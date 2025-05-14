# MultiSelect

> **Developed by Shubham Dhakal**

## Overview

MultiSelect is a Chrome extension that lets you select, copy, and search multiple noncontiguous text fragments on any webpage. It supports custom highlight colors, undo/redo, and advanced copy/search options for efficient research and content curation.

---

## Installation

1. Download or clone this repository.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.



### Multi-Selection Mode

- **Hold Ctrl** (or Cmd on Mac) **before selecting text** to activate multi-selection mode.
- While holding Ctrl, select text with your mouse. Each selection will be highlighted in your chosen color.
- You can make multiple, noncontiguous selections on the page.

### Copying Selections

- **Ctrl+C** (Cmd+C) copies all selected texts using your chosen separator (newline, space, or bullets).
- Choose your preferred separator in the extension popup.

### Undo/Redo

- **Ctrl+Z** undoes the most recent selection.
- **Ctrl+Y** or **Ctrl+Shift+Z** redoes the most recently undone selection.
- Redo only works after an undo, and is cleared if you make a new selection or clear all.

### Lock Mode

- **Ctrl+Shift+L** toggles lock mode (prevents accidental clearing of selections).
- When locked, selections are not cleared by clicking elsewhere.

### Clearing Selections

- **Click anywhere without holding Ctrl** to clear all selections (unless locked).

### Context Menu Search

- **Right-click** a selection for context menu options:
  - Search Google, YouTube, or Wikipedia for the selected text.
  - **MultiSearch:** Opens a search tab for each selection.
  - **CombinedSearch:** Opens a single search tab with all selections combined.

### Highlight Color

- Change the highlight color using the color picker in the popup or options page.
- The preview updates live; new selections use the chosen color.

### Default Selection

- If you do **not** hold Ctrl before selecting, the browser's default text selection and copy behavior is used.

---

## Configuration

- Click the extension icon to open the popup.
- Choose your preferred copy separator: Newline, Spaces, or Bullets.
- Enable or disable MultiSearch and CombinedSearch context menu options.
- Change the highlight color with the color picker.
- Open the options page to set your modifier key (Ctrl/Alt/Shift) and highlight color.

---

## Notes

- Selections are stored per page and persist until the page is reloaded or cleared.
- Works on most web pages except Chrome Web Store and some system pages.
- Refresh tabs after installing or updating the extension.

---

## Credits

**Created and maintained by ~-Shubham Dhakal-~ ***

~~**##If you use or modify this extension, please retain this credit in your documentation or about page.##**~~~