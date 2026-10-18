import { t } from '../../i18n';
import type { DeckId, HotCueIndex } from '../../audio/types';
import { formatMediaTime } from '../../ui/time';

export interface HotCueValue { readonly positionSeconds: number }
export interface HotCueGridProps {
  readonly id: DeckId;
  readonly slots: readonly (HotCueValue | null)[];
  readonly loaded: boolean;
  readonly onSet: (index: HotCueIndex) => void;
  readonly onTrigger: (index: HotCueIndex) => void | Promise<unknown>;
  readonly onClear: (index: HotCueIndex) => void;
}

export function HotCueGrid({ id, slots, loaded, onSet, onTrigger, onClear }: HotCueGridProps) {
  return <div className={'hot-cues hot-cues-' + id} role="group" aria-label={t('Hot cues ' + id)}>
    {Array.from({ length: 8 }, (_, index) => {
      const cue = slots[index] ?? null;
      const cueIndex = index as HotCueIndex;
      const number = index + 1;
      const label = 'Hot cue ' + number + ' ' + id;
      const visibleNumber = String(number).padStart(2, '0');
      const visiblePosition = cue ? formatMediaTime(cue.positionSeconds) : 'Set';
      return <div className={'hot-cue' + (cue ? ' is-set' : '')} key={index}>
        <button className="hot-cue__pad" type="button" aria-label={t(label + ' · ' + visibleNumber + ' ' + visiblePosition)} aria-pressed={cue !== null} disabled={!loaded}
          title={t(cue ? 'Jump to ' + formatMediaTime(cue.positionSeconds) : 'Set cue at the current position')}
          onClick={() => { if (cue) void onTrigger(cueIndex); else onSet(cueIndex); }}>
          <span className="hot-cue__number">{t(visibleNumber)}</span>
          <span className="hot-cue__time">{t(visiblePosition)}</span>
        </button>
        <button className="hot-cue__clear" type="button" aria-label={t('Clear hot cue ' + number + ' ' + id)} disabled={!loaded || !cue} onClick={() => onClear(cueIndex)}>×</button>
      </div>;
    })}
  </div>;
}
