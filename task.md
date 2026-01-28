This proposal outlines the implementation plan for the **Countdown/Focus Mode** feature for the `supunlakmal/hash-calendar` project. This document is designed to guide a developer through the integration process while strictly adhering to the project's architectural constraints (Vanilla JS, modularity) and design philosophy.

---

# Feature Project Proposal: Focus Mode (Productivity Dashboard)

## 1. Executive Summary

The **Focus Mode** module transforms the `hash-calendar` from a passive planning tool into an active, "second-screen" productivity monitor. By toggling a specialized UI layer, the complex grid is hidden, and the user is presented with a minimalist interface displaying only the most critical information: the **Current Active Event** or the **Countdown to the Next Event**.

## 2. Motivation (The "Why")

- **User Pain Point:** The traditional calendar grid (Month/Week view) is excellent for planning but cluttered for moment-to-moment tracking. Users constantly switch tabs to check "How much time until my next meeting?"
- **Value Proposition:** Provides a zero-distraction view perfect for leaving on a side monitor. It keeps the user in "flow state" by removing visual noise.

## 3. UI/UX Design & Aesthetics

### Visual Style

- **Philosophy:** Extreme Minimalism. Large typography, high contrast, ample whitespace.
- **Color Logic:**
  - **Neutral/Green:** > 30 minutes until next event.
  - **Orange:** < 10 minutes until next event.
  - **Red:** < 2 minutes (Urgent) or Event in progress.
- **Transition:** A smooth fade-in/out transition when toggling between Grid View and Focus View to maintain the "App-like" feel.

### Mockup Structure

The view will act as an overlay covering the `#calendar-container`.

```text
+-------------------------------------------------------+
|  [Exit Focus Mode (x)]                       10:42 AM |
|                                                       |
|                  NEXT UP IN:                          |
|                                                       |
|            00 : 14 : 35                               |
|          (Hr) (Min) (Sec)                             |
|                                                       |
|         🚀 Daily Standup Meeting                      |
|           11:00 AM - 11:30 AM                         |
|                                                       |
|                                                       |
|  Up Later:                                            |
|  • 2:00 PM: Design Review                             |
+-------------------------------------------------------+
```

## 4. Technical Architecture

### Core Constraints

- **No Library Dependencies:** Must use native `Date` objects and `requestAnimationFrame` or `setInterval`.
- **Zero URL Impact:** This is a _view state_, not data state. Toggling this mode **does not** need to update the hash string, keeping the URL short.
- **Modules:** Logic must be encapsulated in a new module.

### File Structure Changes

1.  **New File:** `/modules/focusMode.js` (Handles logic, rendering, and timers).
2.  **Modify:** `style.css` (New styling for the dashboard).
3.  **Modify:** `index.html` (Add a container div for the Focus View, hidden by default).
4.  **Modify:** `script.js` (Initialize the module and attach event listener to the toolbar).

## 5. Implementation Details

### A. The Data Logic (`focusMode.js`)

We need a function `getNextEvent(eventsArray)` that:

1.  Takes the global `state.events`.
2.  Parses recurrences (using existing `recurrenceEngine.js`) to expand recurring events for "Today."
3.  Filters out events that have `endTime < now`.
4.  Sorts by `startTime`.
5.  Returns the object representing the immediate next event.

### B. The Render Loop

Instead of a static render, this view is live.

- Use a `setInterval` running every 1000ms.
- Calculate `delta = event.startTime - Date.now()`.
- Update the DOM element containing the timer string.
- If `delta` reaches 0, switch UI to "Event In Progress" mode.

### C. CSS & Aesthetics

Classes should reuse the project's existing variables (e.g., `--main-color`) to support Dark/Light mode automatically.

```css
/* style.css draft */
#focus-mode-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: var(--bg-color);
  z-index: 999;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.timer-big {
  font-size: 5rem;
  font-weight: 700;
  font-family: monospace; /* Monospaced prevents jittering numbers */
}
```

## 6. Implementation Steps

### Phase 1: Setup

1.  Add a generic `<button id="btn-focus">Focus</button>` to the top navigation bar.
2.  Create `<div id="focus-overlay" class="hidden">...</div>` in `index.html`.

### Phase 2: Logic Development (The Filter)

1.  Create `modules/focusMode.js`.
2.  Import `recurrenceEngine` to ensure we catch recurring daily meetings.
3.  Write the algorithm to find the nearest future event.

### Phase 3: The Countdown Engine

1.  Write the timer logic.
2.  Format milliseconds into `HH:MM:SS`.
3.  Handle the edge case where no events exist for the rest of the day ("All Clear!").

### Phase 4: UI Integration

1.  Hook up the "Focus" button to unhide the overlay and start the timer interval.
2.  Hook up the "Exit" button to clear the interval (to save resources) and hide the overlay.

## 7. Code Spec (Draft for `focusMode.js`)

```javascript
export class FocusMode {
  constructor(eventData, recurrenceEngine) {
    this.events = eventData;
    this.recurrence = recurrenceEngine;
    this.timerInterval = null;
    this.container = document.getElementById("focus-overlay");
  }

  findNextEvent() {
    const now = new Date();
    // 1. Expand recurring events for today
    // 2. Filter events where event.end > now
    // 3. Sort by start date
    // 4. Return list[0]
  }

  start() {
    this.container.classList.remove("hidden");
    this.render(); // Initial render
    this.timerInterval = setInterval(() => this.tick(), 1000);
  }

  tick() {
    const next = this.findNextEvent();
    if (!next) {
      this.renderEmptyState();
      return;
    }

    const now = new Date();
    const diff = next.startTime - now;

    // Check if event is currently happening
    if (diff <= 0 && next.endTime > now) {
      this.renderActiveState(next);
    } else {
      this.renderCountdown(next, diff);
    }
  }

  stop() {
    clearInterval(this.timerInterval);
    this.container.classList.add("hidden");
  }
}
```

## 8. Expected Challenges & Solutions

- **Challenge:** Recurrence Logic complexity.
  - **Solution:** Do not reinvent the wheel. Utilize the existing `recurrenceEngine.js` `getEventsForDate` function. Generate events for _Today_ and _Tomorrow_ only, merge them, then filter. This keeps performance high.
- **Challenge:** Time Zones.
  - **Solution:** All math uses `Date.now()` (UTC timestamp comparisons) to remain agnostic, rendering formatted time strings only at the last step.

## 9. Definition of Done

1.  [ ] Clicking "Focus" replaces the grid with the overlay.
2.  [ ] The countdown decrements accurately every second.
3.  [ ] Dark mode toggle works inside Focus Mode.
4.  [ ] Pressing "Esc" exits Focus Mode.
5.  [ ] No extra data is added to the URL hash.
