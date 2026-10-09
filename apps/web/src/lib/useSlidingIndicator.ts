import { useCallback, useLayoutEffect, useRef, useState } from 'react';

export interface IndicatorBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The position of a highlight that slides behind the selected one of a row of controls (a segmented control).
 * It measures the selected item (so items can have any width and can wrap onto a second row) and re-measures when the
 * container is resized. `ready` turns true after the first paint: until then there is no transition, so the
 * highlight does not fly in from the corner when the screen opens.
 *
 * Usage: `ref={indicator.setContainer}` on the container (which must be `relative`) and, on every item,
 * `ref={indicator.setItem}` plus `data-index={i}`. The highlight is moved with `transform`.
 */
export function useSlidingIndicator(selectedIndex: number) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const items = useRef(new Map<number, HTMLElement>());
  const [box, setBox] = useState<IndicatorBox | null>(null);
  const [ready, setReady] = useState(false);

  const setItem = useCallback((el: HTMLElement | null) => {
    if (el) items.current.set(Number(el.dataset.index), el);
  }, []);

  useLayoutEffect(() => {
    const measure = () => {
      const el = items.current.get(selectedIndex);
      setBox(
        el
          ? { x: el.offsetLeft, y: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight }
          : null,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (container) observer.observe(container);
    const frame = requestAnimationFrame(() => setReady(true));
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [selectedIndex, container]);

  return { setContainer, container, setItem, box, ready };
}
