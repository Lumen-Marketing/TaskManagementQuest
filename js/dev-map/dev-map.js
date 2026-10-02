import { DEV_MAP_ANNOTATIONS } from "./dev-map-data.js";
import { createDevTour } from "./dev-tour.js";

const ROOT_ID = "questDevMapLayer";
const TOGGLE_ID = "questDevMapToggle";

let enabled = false;
let currentPhase = null;

function resolveTarget(selector) {
  if (!selector) return null;

  const selectors = selector.split(",").map((item) => item.trim());

  for (const item of selectors) {
    const element = document.querySelector(item);

    if (element) {
      return element;
    }
  }

  return null;
}

function getActivePhase() {
  const active =
    document.querySelector("[data-phase].is-active") ||
    document.querySelector("[data-phase][aria-current='page']");

  return active?.dataset?.phase || null;
}

function annotationAllowed(annotation) {
  if (!annotation.phase) return true;

  return annotation.phase === currentPhase;
}

function createLayer() {
  let root = document.getElementById(ROOT_ID);

  if (root) return root;

  root = document.createElement("div");
  root.id = ROOT_ID;
  root.className = "quest-dev-map-layer";
  document.body.appendChild(root);

  return root;
}

function createNote(annotation, target) {
  const sticker = document.createElement("button");

  sticker.type = "button";
  sticker.className = "quest-dev-sticker";
  sticker.dataset.status = annotation.status;
  sticker.dataset.annotationId = annotation.id;

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
  const rect = target.getBoundingClientRect();

  sticker.style.left = `${window.scrollX + rect.left + 8}px`;
  sticker.style.top = `${window.scrollY + rect.top + 8}px`;
}

function closeNotes() {
  document
    .querySelectorAll(".quest-dev-note")
    .forEach((note) => note.remove());
}

function openNote(annotation, target, sticker) {
  closeNotes();

  target.classList.add("quest-dev-map-target");

  const note = document.createElement("div");
  note.className = "quest-dev-note";

  const files = annotation.files?.length
    ? `
      <div class="quest-dev-note__section">
        <strong>FILES</strong>
        ${annotation.files.map((file) => `<code>${file}</code>`).join("")}
      </div>
    `
    : "";

  const acceptance = annotation.acceptance?.length
    ? `
      <div class="quest-dev-note__section">
        <strong>ACCEPTANCE</strong>
        <ul>
          ${annotation.acceptance.map((item) => `<li>${item}</li>`).join("")}
        </ul>
      </div>
    `
    : "";

  const author = annotation.author
    ? `<span class="quest-dev-note__author">${annotation.author}</span>`
    : "";

  note.innerHTML = `
    <div class="quest-dev-note__header">
      <span>${annotation.status}</span>
      ${author}
      <button type="button" aria-label="Close developer note">×</button>
    </div>

    <h3>${annotation.title}</h3>

    <p>${annotation.body}</p>

    ${files}
    ${acceptance}
  `;

  document.body.appendChild(note);

  const stickerRect = sticker.getBoundingClientRect();

  note.style.left = `${window.scrollX + stickerRect.right + 12}px`;
  note.style.top = `${window.scrollY + stickerRect.top}px`;

  note.querySelector("button").addEventListener("click", () => {
    target.classList.remove("quest-dev-map-target");
    note.remove();
  });
}

function renderAnnotations() {
  const root = createLayer();

  root.innerHTML = "";

  currentPhase = getActivePhase();

  if (!enabled) {
    root.hidden = true;
    closeNotes();
    return;
  }

  root.hidden = false;

  DEV_MAP_ANNOTATIONS.forEach((annotation) => {
    if (!annotationAllowed(annotation)) return;

    const target = resolveTarget(annotation.target);

    if (!target) {
      console.debug(
        `[DEV MAP] Target not found for "${annotation.id}":`,
        annotation.target
      );

      return;
    }

    const sticker = createNote(annotation, target);

    root.appendChild(sticker);

    positionSticker(sticker, target);
  });
}

function repositionAnnotations() {
  if (!enabled) return;

  document
    .querySelectorAll(".quest-dev-sticker")
    .forEach((sticker) => {
      const annotation = DEV_MAP_ANNOTATIONS.find(
        (item) => item.id === sticker.dataset.annotationId
      );

      if (!annotation) return;

      const target = resolveTarget(annotation.target);

      if (!target) return;

      positionSticker(sticker, target);
    });
}

function toggleDevMap() {
  enabled = !enabled;

  const toggle = document.getElementById(TOGGLE_ID);

  if (toggle) {
    toggle.dataset.active = enabled ? "true" : "false";

    toggle.querySelector(".quest-dev-map-toggle__state").textContent =
      enabled ? "ON" : "OFF";
  }

  renderAnnotations();
}

function createToggle() {
  if (document.getElementById(TOGGLE_ID)) return;

  const button = document.createElement("button");

  button.id = TOGGLE_ID;
  button.type = "button";
  button.className = "quest-dev-map-toggle";

  button.innerHTML = `
    <span>DEV MAP</span>
    <span class="quest-dev-map-toggle__count">
      ${DEV_MAP_ANNOTATIONS.length}
    </span>
    <span class="quest-dev-map-toggle__state">
      OFF
    </span>
  `;

  button.addEventListener("click", toggleDevMap);

  const nav =
    document.querySelector("#questTopNav") ||
    document.querySelector("header") ||
    document.body;

  nav.appendChild(button);
}

function canUseDevMap() {
  const isLocal =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";

  const userRole =
    document.documentElement.dataset.userRole ||
    document.body.dataset.userRole;

  return isLocal || userRole === "super_admin";
}

export function initDevMap() {
  if (!canUseDevMap()) return;

  createToggle();
  createLayer();

  createDevTour({
    annotations: DEV_MAP_ANNOTATIONS,
    enableMap: () => {
      if (!enabled) {
        toggleDevMap();
      }
    },
  });

  window.addEventListener("resize", repositionAnnotations);
  window.addEventListener("scroll", repositionAnnotations, {
    passive: true,
  });

  const observer = new MutationObserver(() => {
    const nextPhase = getActivePhase();

    if (nextPhase !== currentPhase) {
      currentPhase = nextPhase;
      renderAnnotations();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "aria-current"],
  });
}