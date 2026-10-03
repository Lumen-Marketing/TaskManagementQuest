import { QuestShell } from './components/QuestShell';
import '../quest-shell.css';

document.addEventListener('DOMContentLoaded', () => {
  const appRoot = document.getElementById('app');
  if (!appRoot) return;

  const shell = new QuestShell();
  appRoot.innerHTML = shell.render();
  shell.bindEvents(appRoot);
});
