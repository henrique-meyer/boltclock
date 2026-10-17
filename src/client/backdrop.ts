import './backdrop.css';
import { sceneArt } from './backdrop-art.js';
import { SCENE_SKIES, type BackgroundScene } from './weather-background.js';

export interface Backdrop {
  /** Crossfade to a scene. Showing the scene already on screen does nothing. */
  show(scene: BackgroundScene): void;
}

/** A little longer than the CSS fade, so the old scene goes only once it is fully covered. */
const REMOVE_AFTER_MS = 2600;

/** Draws the weather scene in the display's full-screen backdrop element. Does nothing without one. */
export function mountBackdrop(root: HTMLElement | null): Backdrop {
  if (!root) return { show: () => {} };
  let current: BackgroundScene | undefined;
  return {
    show(scene) {
      if (scene === current) return;
      current = scene;
      const sky = SCENE_SKIES[scene];
      const next = document.createElement('div');
      next.className = `bg-scene bg-scene--${scene}`;
      next.style.backgroundImage = `linear-gradient(to bottom, ${sky.top}, ${sky.bottom})`;
      // The art is this module's own static markup; nothing from the network or the user goes into it.
      next.innerHTML = sceneArt(scene);
      const previous = [...root.children];
      root.append(next);
      // Read layout once so the browser starts the fade from transparent.
      void next.offsetWidth;
      next.classList.add('bg-scene--shown');
      setTimeout(() => previous.forEach((old) => old.remove()), REMOVE_AFTER_MS);
    },
  };
}
