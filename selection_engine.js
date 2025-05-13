// selection_engine.js
// Core logic for arbitrary-shape text selection

class SelectionEngine {
  constructor(settings) {
    this.settings = settings;
    this.waypoints = [];
    this.isActive = false;
    this.highlights = [];
  }

  // Start capturing on initial double-click
  start(x, y) {
    this.isActive = true;
    this.waypoints = [{x, y}];
    this._clearHighlights();
  }

  // Add a new waypoint on modifier press
  addWaypoint(x, y) {
    if (!this.isActive) return;
    this.waypoints.push({x, y});
    this._renderPath();
  }

  // Finish selection and return collected text
  finish() {
    this.isActive = false;
    const text = this._collectText();
    this._clearHighlights();
    return text;
  }

  // Highlight each segment between waypoints
  _renderPath() {
    this._clearHighlights();
    for (let i = 0; i < this.waypoints.length - 1; i++) {
      this._highlightSegment(this.waypoints[i], this.waypoints[i+1]);
    }
  }

  // Traverse between two points and highlight chars
  _highlightSegment(p1, p2) {
    const getRange = (x, y) => {
      if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(x, y);
        if (pos && pos.offsetNode) {
          const range = document.createRange();
          range.setStart(pos.offsetNode, pos.offset);
          range.setEnd(pos.offsetNode, pos.offset + 1);
          return range;
        }
      } else if (document.caretRangeFromPoint) {
        return document.caretRangeFromPoint(x, y);
      }
      return null;
    };

    const range = getRange(p1.x, p1.y);
    if (!range) return;
    // walk along a straight line from p1 to p2 in N steps
    const steps = Math.max(
      Math.abs(p2.x - p1.x),
      Math.abs(p2.y - p1.y)
    ) / 5; // sample every 5px
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = p1.x + (p2.x - p1.x) * t;
      const y = p1.y + (p2.y - p1.y) * t;
      const r = getRange(x, y);
      if (r && r.startContainer && r.startContainer.nodeType === Node.TEXT_NODE) {
        const offset = r.startOffset || 0;
        this._highlightChar(r.startContainer, offset);
      }
    }
  }

  // Wrap a single character with highlight span
  _highlightChar(node, index) {
    if (!node || index < 0 || index >= node.length) return;
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    const span = document.createElement('span');
    span.style.background = this.settings.highlightColor;
    range.surroundContents(span);
    this.highlights.push(span);
  }

  // Read text from all highlights in DOM order
  _collectText() {
    return this.highlights
      .map(span => span.textContent)
      .join('');
  }

  // Remove all highlight spans
  _clearHighlights() {
    for (const span of this.highlights) {
      const parent = span.parentNode;
      parent.replaceChild(document.createTextNode(span.textContent), span);
      parent.normalize();
    }
    this.highlights = [];
  }
}

// Expose to content_script
window.SelectionEngine = SelectionEngine;