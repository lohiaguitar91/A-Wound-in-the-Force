import type { AtlasIndex } from '../data/load';
import type { Store } from '../app/state';
import type { Renderer } from '../map/renderer';
import type { Sheet } from './sheet';

export interface Actions {
  jumpTo(time: number, announce?: boolean): void;
  showSystem(id: string, fly?: boolean): void;
  showEvent(id: string, fly?: boolean): void;
  showFaction(id: string): void;
  showWhatIf(tab?: 'pivots' | 'changes'): void;
  showSearch(): void;
  showEventsNow(): void;
  showAbout(): void;
  togglePivot(id: string): void;
  flyToSystem(id: string): void;
  highlight(systems: string[]): void;
}

export interface UiContext {
  index: AtlasIndex;
  store: Store;
  renderer: Renderer;
  sheet: Sheet;
  actions: Actions;
}
