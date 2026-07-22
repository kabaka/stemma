/**
 * Oracle for the sidebar's persistent SMART-on-FHIR sync chip (DR-0016): hidden when there
 * are no connections, and on click navigates to the pedigree + requests a sync for the
 * connection that is most overdue (`lastSyncAt ?? createdAt`, oldest wins) — the SAME
 * `requestedSyncId` seam the OAuth-callback success path uses, verified directly against
 * the real stores rather than mocked, since this component's whole job is wiring them
 * together correctly.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SmartSyncChip } from './SmartSyncChip';
import { useSmartConnectionStore, type SmartConnection } from '@/store/useSmartConnectionStore';
import { useStore } from '@/store/useStore';

function connection(overrides: Partial<SmartConnection>): SmartConnection {
  return {
    id: 'conn-1',
    fhirBaseUrl: 'https://fhir.example.org/api/FHIR/R4',
    authorizeEndpoint: 'https://fhir.example.org/oauth/authorize',
    tokenEndpoint: 'https://fhir.example.org/oauth/token',
    clientId: 'stemma-test-client',
    patientId: 'pat-1',
    scopesGranted: [],
    offlineAccessGranted: false,
    stayConnected: false,
    lastSyncAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  useSmartConnectionStore.setState({ connections: [], requestedSyncId: null });
  useStore.getState().setView('overview');
});
afterEach(() => {
  useSmartConnectionStore.setState({ connections: [], requestedSyncId: null });
});

describe('SmartSyncChip', () => {
  it('renders nothing when there are no SMART-on-FHIR connections', () => {
    const { container } = render(<SmartSyncChip />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a compact connected/synced summary when a connection exists', () => {
    useSmartConnectionStore.setState({
      connections: [connection({ lastSyncAt: '2026-06-01T00:00:00.000Z' })],
    });
    render(<SmartSyncChip />);

    expect(screen.getByRole('button', { name: /health record connected/i })).toBeInTheDocument();
  });

  it('clicking navigates to the pedigree and requests a sync for the most-overdue connection', async () => {
    const user = userEvent.setup();
    useSmartConnectionStore.setState({
      connections: [
        connection({ id: 'stale', lastSyncAt: '2026-01-01T00:00:00.000Z' }),
        connection({ id: 'fresh', lastSyncAt: '2026-06-01T00:00:00.000Z' }),
      ],
    });
    render(<SmartSyncChip />);

    await user.click(screen.getByRole('button', { name: /health records connected/i }));

    expect(useStore.getState().view).toBe('tree');
    expect(useSmartConnectionStore.getState().requestedSyncId).toBe('stale');
  });

  it('treats a never-synced connection (lastSyncAt null) as the most overdue', async () => {
    const user = userEvent.setup();
    useSmartConnectionStore.setState({
      connections: [
        connection({ id: 'synced', lastSyncAt: '2026-06-01T00:00:00.000Z' }),
        connection({ id: 'never-synced', lastSyncAt: null, createdAt: '2026-05-01T00:00:00.000Z' }),
      ],
    });
    render(<SmartSyncChip />);

    await user.click(screen.getByRole('button', { name: /health records connected/i }));

    expect(useSmartConnectionStore.getState().requestedSyncId).toBe('never-synced');
  });
});
