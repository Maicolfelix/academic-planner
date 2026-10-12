import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RemindersPanel } from '../pages/reminders/RemindersPanel';
import { DUE_REMINDERS_KEY } from '../reminders/useReminders';
import { ReminderBadge } from './ReminderBadge';

const text = (html: string) =>
  html.replaceAll(/<svg[\s\S]*?<\/svg>/g, '').replaceAll(/<[^>]+>/g, '');

describe('the reminder badge on "Inicio"', () => {
  it('renders nothing when nothing is due', () => {
    expect(renderToStaticMarkup(<ReminderBadge count={0} />)).toBe('');
  });

  it.each([1, 2, 9, 12])('keeps the count %i, with an SVG bell and no emoji', (count) => {
    const html = renderToStaticMarkup(<ReminderBadge count={count} />);
    expect(html).not.toContain('🔔');
    expect(html).toContain('<svg');
    expect(html).toContain(`<span aria-hidden="true">${count}</span>`);
    // the number is never the only signal: screen readers get the words
    expect(html).toContain(`${count} ${count === 1 ? 'recordatorio' : 'recordatorios'}</span>`);
  });

  it('is a small circle ringed in the bar color, and the bell is hidden from assistive tech', () => {
    const html = renderToStaticMarkup(<ReminderBadge count={3} />);
    expect(html).toContain('rounded-full');
    expect(html).toContain('ring-2 ring-surface');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).not.toContain('<button');
  });
});

describe('the reminders card', () => {
  const NOW = new Date('2026-10-05T17:00:00.000Z');
  const due = {
    total: 2,
    reminders: [1, 2].map((n) => ({
      id: `00000000-0000-4000-8000-00000000000${n}`,
      activity: {
        title: `Parcial ${n}`,
        dueAt: '2026-10-06T13:00:00.000Z',
        hasTime: true,
      },
      subject: null,
    })),
  };
  const render = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(DUE_REMINDERS_KEY, due);
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <RemindersPanel timeZone="America/Bogota" now={NOW} />
      </QueryClientProvider>,
    );
  };

  it('shows a small bell icon per reminder instead of the emoji, and keeps its words and buttons', () => {
    const html = render();
    expect(html).not.toContain('🔔');
    expect(html.match(/<svg/g)).toHaveLength(2);
    expect(html.match(/<svg[^>]*aria-hidden="true"/g)).toHaveLength(2);
    expect(html).toContain('size-4'); // discreet, not a big bell
    expect(text(html)).toContain('Tienes 2 recordatorios');
    expect(text(html)).toContain('Parcial 1');
    expect(html).toContain('aria-label="Marcar como visto: Parcial 2"');
    expect(text(html)).toContain('Marcar todos como vistos');
  });
});
