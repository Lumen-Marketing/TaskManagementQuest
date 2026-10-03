/**
 * QUEST OS — DEV MAP
 * Persistent developer walkthrough + implementation annotation layer.
 *
 * ROLE
 * - Lives inside the running Quest OS interface.
 * - Anchors implementation guidance directly to real DOM surfaces.
 * - Separates design intent from production application behavior.
 *
 * SHELL CONTRACT
 * - DEV MAP does not own routing, auth, data, mutations, or task behavior.
 * - DEV MAP must not alter Quest shell geometry.
 * - The right contextual sidecar is the canonical control location.
 *
 * STATUS LANGUAGE
 * - LOCK   → approved structure / preserve
 * - BUILD  → implementation belongs here
 * - WIRE   → surface exists / integration remains
 * - CHECK  → behavior requires verification
 * - DECIDE → architectural or product decision remains open
 *
 * ENABLEMENT
 * - localhost / 127.0.0.1
 * - Super Admin context
 * - explicit ?dev-map=1 URL opt-in
 */

import { DEV_MAP_ANNOTATIONS } from "./dev-map-data.js";
import { createDevTour } from "./dev-tour.js";

const ROOT_ID = "questDevMapLayer";
const TOGGLE_ID = "questDevMapToggle";

const PHASE_FROM_HASH = {
  "#/view/query": "query",
  "#/view/unit": "unit",
  "#/view/execute": "execute",
  "#/view/sight": "sight",
  "#/view/total": "total",
};

let enabled = false;
let currentPhase = null;
let observer = null;

/* ---------------------------------------------------------
   TARGET RESOLUTION
   --------------------------------------------------------- */

function resolveTarget(selector) {
  if (!selector) return null;

  const selectors = selector
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  for (const item of selectors) {
    const element = document.querySelector(item);

    if (element) {
      return element;
    }
  }

  return null;
}

/* ---------------------------------------------------------
   ACTIVE PHASE
   DOM state wins; canonical URL is the fallback.
   --------------------------------------------------------- */

function getActivePhase() {
  const active =
    document.querySelector("[data-phase].is-active") ||
    document.querySelector("[data-phase].active") ||
    document.querySelector("[data-phase][aria-current='page']") ||
    document.querySelector("[data-phase][aria-selected='true']");

  if (active?.dataset?.phase) {
    return active.dataset.phase;
  }

  const hash = decodeURIComponent(window.location.hash || "")
    .split("?")[0]
    .replace(/\/+$/, "");

  return PHASE_FROM_HASH[hash] || null;
}

function annotationAllowed(annotation) {
  if (!annotation.phase) return true;

  return annotation.phase === currentPhase;
}

/* ---------------------------------------------------------
   DEV MAP LAYER
   Stickers live here; production surfaces remain untouched.
   --------------------------------------------------------- */

function createLayer() {
  let root = document.getElementById(ROOT_ID);

  if (root) return root;

  root = document.createElement("div");
  root.id = ROOT_ID;
  root.className = "quest-dev-map-layer";
  root.hidden = true;

  document.body.appendChild(root);

  return root;
}

/* ---------------------------------------------------------
   TOGGLE
   Canonical home = contextual right sidecar.
   If QuestShell has not mounted yet, fallback temporarily and
   move the control into the sidecar as soon as it exists.
   --------------------------------------------------------- */

function getToggleMount() {
  return (
    document.querySelector("#questRightZone") ||
    document.querySelector("#questTopNav") ||
    document.querySelector("header") ||
    document.body
  );
}

function ensureToggleMount() {
  const button = document.getElementById(TOGGLE_ID);

  if (!button) return;

  const mount = getToggleMount();

  if (!mount) return;

  if (button.parentElement !== mount) {
    mount.prepend(button);
  }
}

function updateToggleState() {
  const toggle = document.getElementById(TOGGLE_ID);

  if (!toggle) return;

  toggle.dataset.active = enabled ? "true" : "false";
  toggle.setAttribute("aria-pressed", enabled ? "true" : "false");

  const state = toggle.querySelector(
    ".quest-dev-map-toggle__state"
  );

  if (state) {
    state.textContent = enabled ? "ON" : "OFF";
  }
}

function createToggle() {
  let button = document.getElementById(TOGGLE_ID);

  if (!button) {
    button = document.createElement("button");

    button.id = TOGGLE_ID;
    button.type = "button";
    button.className = "quest-dev-map-toggle";
    button.setAttribute(
      "aria-label",
      "Toggle Quest developer map"
    );
    button.setAttribute("aria-pressed", "false");

    button.innerHTML = `
      <span class="quest-dev-map-toggle__label">
        DEV MAP
      </span>

      <span
        class="quest-dev-map-toggle__count"
        aria-label="${DEV_MAP_ANNOTATIONS.length} annotations"
      >
        ${DEV_MAP_ANNOTATIONS.length}
      </span>

      <span class="quest-dev-map-toggle__state">
        OFF
      </span>
    `;

    button.addEventListener("click", toggleDevMap);
  }

  ensureToggleMount();
  updateToggleState();

  return button;
}

/* ---------------------------------------------------------
   STICKERS
   --------------------------------------------------------- */

function createSticker(annotation, target) {
  const sticker = document.createElement("button");

  sticker.type = "button";
  sticker.className = "quest-dev-sticker";
  sticker.dataset.status = annotation.status;
  sticker.dataset.annotationId = annotation.id;

  sticker.setAttribute(
    "aria-label",
    `${annotation.status}: ${annotation.title}`
  );

  sticker.innerHTML = `
    <span class="quest-dev-sticker__status">
      ${annotation.status}
    </span>
  `;

  sticker.addEventListener("click", (event) => {
    event.stopPropagation();

    openNote(annotation, target, sticker);
  });

  return sticker;
}

function positionSticker(sticker, target) {
  if (!sticker?.isConnected || !target?.isConnected) {
    return;
  }

  const rect = target.getBoundingClientRect();

  sticker.style.left = `${
    window.scrollX + rect.left + 8
  }px`;

  sticker.style.top = `${
    window.scrollY + rect.top + 8
  }px`;
}

/* ---------------------------------------------------------
   NOTE / DETAIL CARD
   --------------------------------------------------------- */

function clearTargetHighlights() {
  document
    .querySelectorAll(".quest-dev-map-target")
    .forEach((target) => {
      target.classList.remove("quest-dev-map-target");
    });
}

function closeNotes() {
  document
    .querySelectorAll(".quest-dev-note")
    .forEach((note) => note.remove());

  clearTargetHighlights();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function positionNote(note, sticker) {
  const stickerRect = sticker.getBoundingClientRect();

  const noteRect = note.getBoundingClientRect();

  const gutter = 12;
  const viewportPadding = 16;

  let left =
    window.scrollX +
    stickerRect.right +
    gutter;

  let top =
    window.scrollY +
    stickerRect.top;

  const maxLeft =
    window.scrollX +
    window.innerWidth -
    noteRect.width -
    viewportPadding;

  const maxTop =
    window.scrollY +
    window.innerHeight -
    noteRect.height -
    viewportPadding;

  /*
   * If there is no room to the right, prefer the left side
   * of the sticker before applying the final viewport clamp.
   */
  if (left > maxLeft) {
    left =
      window.scrollX +
      stickerRect.left -
      noteRect.width -
      gutter;
  }

  left = clamp(
    left,
    window.scrollX + viewportPadding,
    Math.max(
      window.scrollX + viewportPadding,
      maxLeft
    )
  );

  top = clamp(
    top,
    window.scrollY + viewportPadding,
    Math.max(
      window.scrollY + viewportPadding,
      maxTop
    )
  );

  note.style.left = `${left}px`;
  note.style.top = `${top}px`;
}

function openNote(annotation, target, sticker) {
  closeNotes();

  target.classList.add("quest-dev-map-target");

  const note = document.createElement("aside");

  note.className = "quest-dev-note";
  note.dataset.annotationId = annotation.id;

  const files = annotation.files?.length
    ? `
      <div class="quest-dev-note__section">
        <strong>FILES</strong>

        ${annotation.files
          .map(
            (file) =>
              `<code>${file}</code>`
          )
          .join("")}
      </div>
    `
    : "";

  const acceptance = annotation.acceptance?.length
    ? `
      <div class="quest-dev-note__section">
        <strong>ACCEPTANCE</strong>

        <ul>
          ${annotation.acceptance
            .map(
              (item) =>
                `<li>${item}</li>`
            )
            .join("")}
        </ul>
      </div>
    `
    : "";

  const author = annotation.author
    ? `
      <span class="quest-dev-note__author">
        ${annotation.author}
      </span>
    `
    : "";

  note.innerHTML = `
    <div class="quest-dev-note__header">
      <span class="quest-dev-note__status">
        ${annotation.status}
      </span>

      ${author}

      <button
        type="button"
        class="quest-dev-note__close"
        aria-label="Close developer note"
      >
        ×
      </button>
    </div>

    <h3>${annotation.title}</h3>

    <p>${annotation.body}</p>

    ${files}
    ${acceptance}
  `;

  document.body.appendChild(note);

  positionNote(note, sticker);

  note
    .querySelector(".quest-dev-note__close")
    ?.addEventListener("click", (event) => {
      event.stopPropagation();
      closeNotes();
    });
}

/* ---------------------------------------------------------
   RENDERING
   --------------------------------------------------------- */

function renderAnnotations() {
  const root = createLayer();

  root.replaceChildren();

  currentPhase = getActivePhase();

  if (!enabled) {
    root.hidden = true;
    closeNotes();
    return;
  }

  root.hidden = false;

  DEV_MAP_ANNOTATIONS.forEach(
    (annotation) => {
      if (!annotationAllowed(annotation)) {
        return;
      }

      const target = resolveTarget(
        annotation.target
      );

      if (!target) {
        console.debug(
          `[DEV MAP] Target not found for "${annotation.id}":`,
          annotation.target
        );

        return;
      }

      const sticker = createSticker(
        annotation,
        target
      );

      root.appendChild(sticker);

      positionSticker(sticker, target);
    }
  );
}

function repositionAnnotations() {
  if (!enabled) return;

  document
    .querySelectorAll(".quest-dev-sticker")
    .forEach((sticker) => {
      const annotation =
        DEV_MAP_ANNOTATIONS.find(
          (item) =>
            item.id ===
            sticker.dataset.annotationId
        );

      if (!annotation) return;

      const target = resolveTarget(
        annotation.target
      );

      if (!target) return;

      positionSticker(sticker, target);
    });

  const openNote =
    document.querySelector(".quest-dev-note");

  if (openNote) {
    const annotationId =
      openNote.dataset.annotationId;

    const sticker =
      document.querySelector(
        `[data-annotation-id="${annotationId}"]`
      );

    if (sticker) {
      positionNote(openNote, sticker);
    }
  }
}

/* ---------------------------------------------------------
   STATE
   --------------------------------------------------------- */

function toggleDevMap() {
  enabled = !enabled;

  updateToggleState();
  renderAnnotations();
}

/* ---------------------------------------------------------
   ACCESS / ENABLEMENT
   --------------------------------------------------------- */

function canUseDevMap() {
  const isLocal =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";

  const userRole =
    document.documentElement.dataset.userRole ||
    document.body.dataset.userRole;

  const requested =
    new URLSearchParams(
      window.location.search
    ).get("dev-map") === "1";

  return (
    isLocal ||
    userRole === "super_admin" ||
    requested
  );
}

/* ---------------------------------------------------------
   INITIALIZATION
   --------------------------------------------------------- */

export function initDevMap() {
  if (!canUseDevMap()) return;

  createLayer();
  createToggle();

  // Explicit URL opt-in opens DEV MAP immediately.
  if (
    new URLSearchParams(window.location.search).get("dev-map") === "1"
  ) {
    enabled = true;
    updateToggleState();
    renderAnnotations();
  }

  createDevTour({
    annotations: DEV_MAP_ANNOTATIONS,

    enableMap: () => {
      if (!enabled) {
        toggleDevMap();
      }
    },
  });

  window.addEventListener(
    "resize",
    repositionAnnotations
  );

  window.addEventListener(
    "scroll",
    repositionAnnotations,
    { passive: true }
  );

  /*
   * QuestShell may create/rebuild the sidecar after DEV MAP has
   * initialized. Watch the app DOM so the control follows the
   * canonical right zone instead of remaining in a fallback host.
   */
  observer = new MutationObserver(() => {
    // QuestShell can replace the sidecar contents entirely.
    // Re-create the DEV MAP control if that render removed it.
    createToggle();

    const nextPhase = getActivePhase();

    if (nextPhase !== currentPhase) {
      currentPhase = nextPhase;
      renderAnnotations();
      return;
    }

    /*
     * DOM targets can arrive without the lifecycle phase changing.
     * Reposition existing stickers rather than rebuilding everything.
     */
    repositionAnnotations();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "class",
      "aria-current",
      "aria-selected",
      "data-phase",
    ],
  });

  /*
   * Exposed intentionally for development inspection.
   * This is not part of Quest application behavior.
   */
  window.questDevMap = {
    enable() {
      if (!enabled) toggleDevMap();
    },

    disable() {
      if (enabled) toggleDevMap();
    },

    toggle() {
      toggleDevMap();
    },

    refresh() {
      ensureToggleMount();
      renderAnnotations();
    },

    get enabled() {
      return enabled;
    },

    get phase() {
      return currentPhase;
    },
  };
}
