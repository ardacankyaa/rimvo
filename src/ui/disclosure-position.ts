/** Place an open, fixed-position disclosure beside its trigger within the viewport. */
export function positionDisclosure(detail: HTMLDetailsElement): void {
  if (!detail.open) return;
  const trigger = detail.querySelector('summary');
  const menu = detail.querySelector<HTMLElement>('.session-menu__content,.deck-effects-menu,.library-display-menu>div');
  if (!trigger || !menu) return;
  const anchor = trigger.getBoundingClientRect();
  const deck = detail.matches('.deck-quick-effects') ? detail.closest('.deck-panel')?.getBoundingClientRect() : null;
  // A phone deck is half the screen; its performance pad uses the viewport, not a tiny half-deck menu.
  const compact = matchMedia('(max-width:899px), (max-width:1180px) and (max-height:639px), (pointer:coarse) and (max-width:1180px)').matches;
  if (deck) menu.style.maxWidth = Math.min(innerWidth - 16, compact ? innerWidth - 16 : deck.width - 16) + 'px';
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const margin = 8;
  let left = Math.max(margin, Math.min(anchor.right - width, innerWidth - width - margin));
  if (deck && !compact) left = Math.max(deck.left + margin, Math.min(left, deck.right - width - margin));
  const below = anchor.bottom + margin;
  const above = anchor.top - height - margin;
  const top = below + height <= innerHeight - margin ? below
    : above >= margin ? above : Math.max(margin, innerHeight - height - margin);
  menu.style.left = left + 'px';
  menu.style.right = 'auto';
  menu.style.top = top + 'px';
}
