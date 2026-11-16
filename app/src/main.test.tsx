import { describe, expect, it, vi } from 'vitest';

const render = vi.hoisted(() => vi.fn());
vi.mock('react-dom/client', () => ({ createRoot: vi.fn(() => ({ render })) }));
vi.mock('./App.tsx', () => ({ default: () => null }));
vi.mock('./routing/client', () => ({ RoutingClient: class { kind = 'client'; } }));

describe('main', () => {
  it('mounts the app with a routing client', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await import('./main');
    const tree = render.mock.calls[0][0];
    expect(tree.props.children.props.client).toEqual({ kind: 'client' });
  });
});
