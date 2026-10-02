import { initDevMap } from "../js/dev-map/dev-map.js";
import { QuestShell } from './components/QuestShell';
import '../quest-shell.css';

document.addEventListener('DOMContentLoaded', () => {
  const appRoot = document.getElementById('app');
  if (!appRoot) return;

  const shell = new QuestShell();
  appRoot.innerHTML = shell.render();
  shell.bindEvents(appRoot);
});

// Quest developer walkthrough / annotation layer
window.addEventListener("DOMContentLoaded", () => initDevMap());
