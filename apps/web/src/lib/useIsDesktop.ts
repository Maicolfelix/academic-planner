import { useMediaQuery } from './useMediaQuery';

/**
 * True from 1024 px up (the weekly grid needs seven readable columns; below that the agenda is a day list).
 * Breakpoints in use: 640 px (`sm`, filters in one row), 768 px (`md`, navigation in one row) and 1024 px (this one).
 */
export const useIsDesktop = (): boolean => useMediaQuery('(min-width: 1024px)');
