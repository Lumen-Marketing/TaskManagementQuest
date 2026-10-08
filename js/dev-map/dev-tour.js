import { DEV_MAP_TOUR } from "./dev-map-data.js";

export function createDevTour({ annotations, enableMap }) {
  let index = -1;

  function getAnnotation(id) {
    return annotations.find((item) => item.id === id);
  }

  function resolveTarget(annotation) {
    if (!annotation?.target) return null;

    const selectors = annotation.target
      .split(",")
      .map((item) => item.trim());

    for (const selector of selectors) {
      const element = document.querySelector(selector);

      if (element) return element;
    }

    return null;
  }

  function clearHighlight() {
    document
      .querySelectorAll(".quest-dev-tour-active")
      .forEach((element) => {
        element.classList.remove("quest-dev-tour-active");
      });
  }

  function showStep(nextIndex) {
    enableMap();

    clearHighlight();

    index = nextIndex;

    if (index < 0) {
      index = DEV_MAP_TOUR.length - 1;
    }

    if (index >= DEV_MAP_TOUR.length) {
      index = 0;
    }

    const id = DEV_MAP_TOUR[index];
    const annotation = getAnnotation(id);

    if (!annotation) return;

    const target = resolveTarget(annotation);

    if (!target) {
      console.debug(`[DEV TOUR] Missing target for ${id}`);
      return;
    }

    target.classList.add("quest-dev-tour-active");

    target.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center",
    });

    const sticker = document.querySelector(
      `[data-annotation-id="${annotation.id}"]`
    );

    if (sticker) {
      setTimeout(() => sticker.click(), 250);
    }
  }

  window.questDevTour = {
    start() {
      showStep(0);
    },

    next() {
      showStep(index + 1);
    },

    previous() {
      showStep(index - 1);
    },

    stop() {
      clearHighlight();
      index = -1;
    },
  };
}