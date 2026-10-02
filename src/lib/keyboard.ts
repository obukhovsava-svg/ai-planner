/**
 * Tracks the on-screen keyboard and toggles `html.kb-open`.
 *
 * Mobile WebViews (Telegram on iOS/Android) shrink or shift the viewport when the
 * keyboard opens, which drags `position: fixed; bottom: 0` elements (our tab bar)
 * up above the keyboard. While the class is set, CSS hides the tab bar instead.
 *
 * Signals: focus on a text-editable field (touch devices only) or the visual
 * viewport becoming much shorter than the layout viewport.
 */

const EDITABLE =
  'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]):not([type=color]), textarea, [contenteditable="true"]';

export function installKeyboardWatcher() {
  const touch = window.matchMedia('(pointer: coarse)').matches;
  const root = document.documentElement;
  let timer = 0;

  const update = () => {
    const el = document.activeElement;
    const focused = touch && el instanceof Element && el.matches(EDITABLE);
    const vv = window.visualViewport;
    const squeezed = vv ? vv.height < window.innerHeight * 0.75 : false;
    root.classList.toggle('kb-open', focused || squeezed);
  };

  // Focus moves between fields as focusout → focusin; settle before deciding.
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(update, 60);
  };

  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
}
