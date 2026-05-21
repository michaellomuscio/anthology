import React, { useEffect, useState, useCallback, useRef } from 'react';
import QRCode from 'qrcode';

const station = window.station;

function timeLeft(expiresAt) {
  const ms = Math.max(0, expiresAt - Date.now());
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtDate(t) {
  if (!t) return '—';
  return new Date(t).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function kindLabel(kind) {
  if (kind === 'tailscale') return 'Tailscale';
  if (kind === 'lan') return 'Local network';
  if (kind === 'public') return 'Public IP';
  if (kind === 'tunnel') return 'Cloudflare Tunnel';
  return 'Address';
}

function kindHint(kind) {
  if (kind === 'tailscale') return 'Best for use away from your home network.';
  if (kind === 'lan') return 'Works while your phone is on the same Wi-Fi.';
  if (kind === 'public') return 'Reachable from the internet — verify intended.';
  if (kind === 'tunnel') return 'Works anywhere — even behind work-wifi firewalls.';
  return '';
}

export default function PhonePairing({ onClose }) {
  const [info, setInfo] = useState(null);
  const [tokens, setTokens] = useState([]);
  const [pairing, setPairing] = useState(null);
  const [qrUrl, setQrUrl] = useState(null);
  const [, forceTick] = useState(0);
  const tickRef = useRef(null);
  const [pushConfig, setPushConfig] = useState(null);
  const [pushUrlDraft, setPushUrlDraft] = useState('');
  const [pushSecretDraft, setPushSecretDraft] = useState('');
  const [pushSaving, setPushSaving] = useState(false);
  const [tunnel, setTunnel] = useState(null);
  const [tunnelBusy, setTunnelBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [i, t, p, tn] = await Promise.all([
        station.bridgeInfo(),
        station.bridgeTokensList(),
        station.bridgePushConfig ? station.bridgePushConfig() : Promise.resolve({ pushConfigured: false }),
        station.tunnelStatus ? station.tunnelStatus() : Promise.resolve(null),
      ]);
      setInfo(i);
      setTokens(t || []);
      setPushConfig(p);
      setPushUrlDraft((d) => d || (p && p.workerUrl) || '');
      if (tn) setTunnel(tn);
    } catch (_) { /* best effort */ }
  }, []);

  const startTunnel = async () => {
    if (tunnelBusy) return;
    setTunnelBusy(true);
    try { await station.tunnelStart(); }
    catch (e) { /* status payload will surface the lastError */ }
    finally { setTunnelBusy(false); refresh(); }
  };
  const stopTunnel = async () => {
    if (tunnelBusy) return;
    setTunnelBusy(true);
    try { await station.tunnelStop(); } finally { setTunnelBusy(false); refresh(); }
  };
  const pairViaTunnel = async () => {
    if (!tunnel?.url) return;
    try {
      const host = new URL(tunnel.url).hostname;
      const p = await station.bridgePairStart({ tunnelHost: host, tunnelPort: 443 });
      setPairing(p);
      const url = await QRCode.toDataURL(p.url, {
        width: 240, margin: 1, errorCorrectionLevel: 'M',
        color: { dark: '#0A0A0B', light: '#FFFFFF' },
      });
      setQrUrl(url);
      refresh();
    } catch (e) { console.error('tunnel pair start failed', e); }
  };

  const savePushConfig = async () => {
    setPushSaving(true);
    try {
      const next = await station.bridgePushConfigSet({
        workerUrl: pushUrlDraft.trim(),
        // Empty string keeps the existing secret; treat null vs empty differently
        workerSecret: pushSecretDraft.length > 0 ? pushSecretDraft : undefined,
      });
      setPushConfig(next);
      setPushSecretDraft('');
    } finally {
      setPushSaving(false);
    }
  };

  const clearPushConfig = async () => {
    if (!window.confirm('Clear push relay config? Phones will stop receiving push notifications.')) return;
    setPushSaving(true);
    try {
      const next = await station.bridgePushConfigSet({ workerUrl: '', workerSecret: '' });
      setPushConfig(next);
      setPushUrlDraft('');
      setPushSecretDraft('');
    } finally {
      setPushSaving(false);
    }
  };

  useEffect(() => {
    refresh();
    const offClients = station.onBridgeClients(() => refresh());
    const offTunnel = station.onTunnelStatus ? station.onTunnelStatus((s) => setTunnel(s)) : null;
    const interval = setInterval(refresh, 4000);
    return () => {
      try { offClients && offClients(); } catch (_) {}
      try { offTunnel && offTunnel(); } catch (_) {}
      clearInterval(interval);
    };
  }, [refresh]);

  // Countdown ticker while pairing is active
  useEffect(() => {
    if (!pairing) {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    tickRef.current = setInterval(() => {
      forceTick((n) => n + 1);
      if (Date.now() > pairing.expiresAt) {
        // Auto-cancel UI when the code expires
        setPairing(null);
        setQrUrl(null);
      }
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [pairing]);

  const startPair = async () => {
    try {
      const p = await station.bridgePairStart();
      setPairing(p);
      const url = await QRCode.toDataURL(p.url, {
        width: 240, margin: 1, errorCorrectionLevel: 'M',
        color: { dark: '#0A0A0B', light: '#FFFFFF' },
      });
      setQrUrl(url);
      refresh();
    } catch (e) {
      console.error('pair start failed', e);
    }
  };

  const cancelPair = async () => {
    try { await station.bridgePairCancel(); } catch (_) {}
    setPairing(null);
    setQrUrl(null);
    refresh();
  };

  const revoke = async (id, label) => {
    if (!window.confirm(`Revoke "${label}"? The device will be signed out immediately.`)) return;
    await station.bridgeTokenRevoke(id);
    refresh();
  };

  if (!info) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header"><h2>Phone</h2><p>Loading…</p></div>
        </div>
      </div>
    );
  }

  if (!info.running) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header"><h2>Phone</h2><p>Bridge server is not running. Restart Anthology.</p></div>
          <div className="modal-footer">
            <div className="actions"><button type="button" onClick={onClose}>Close</button></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Phone</h2>
          <p>
            Connect your iPhone to view and control sessions remotely.
            {info.clientCount > 0 ? (
              <> · <strong>{info.clientCount}</strong> connected now</>
            ) : null}
          </p>
        </div>

        <div className="modal-body">
          {/* Pairing flow */}
          {pairing ? (
            <div className="phone-pair-active">
              <div className="phone-pair-qr">
                {qrUrl ? <img src={qrUrl} alt="Pair QR code" width="240" height="240" /> : null}
                <div className="phone-pair-countdown">
                  Code expires in <strong>{timeLeft(pairing.expiresAt)}</strong>
                </div>
              </div>
              <div className="phone-pair-details">
                <div className="phone-pair-code-row">
                  <div className="field-label">Manual code</div>
                  <div className="phone-pair-code">{pairing.code}</div>
                </div>

                <div className="field">
                  <div className="field-label">Connection</div>
                  <div className="phone-pair-conn">
                    <div className="phone-pair-conn-host">
                      <span className={`phone-pair-kind phone-pair-kind--${pairing.preferredKind}`}>
                        {kindLabel(pairing.preferredKind)}
                      </span>
                      <code>{pairing.preferredHost}:{pairing.port}</code>
                    </div>
                    <div className="phone-pair-conn-hint">{kindHint(pairing.preferredKind)}</div>
                  </div>
                </div>

                {pairing.addresses && pairing.addresses.length > 1 ? (
                  <details className="phone-pair-other">
                    <summary>Other addresses</summary>
                    <ul>
                      {pairing.addresses.slice(1).map((a) => (
                        <li key={`${a.iface}-${a.ip}`}>
                          <span className={`phone-pair-kind phone-pair-kind--${a.kind}`}>{kindLabel(a.kind)}</span>
                          <code>{a.ip}:{pairing.port}</code>
                          <span className="phone-pair-iface">{a.iface}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                <div className="phone-pair-instructions">
                  Open Anthology on your iPhone, tap <strong>Pair Mac</strong>, scan the QR — or type the
                  6-digit code with the host above.
                </div>
              </div>
            </div>
          ) : (
            <div className="phone-pair-idle">
              <p className="phone-pair-blurb">
                Pairing creates a long-lived bearer token on your phone. The token never leaves the
                device pair — it's stored hashed on this Mac and in iOS Keychain. Revoke any time.
              </p>
              <div className="phone-pair-network-list">
                {info.addresses && info.addresses.length > 0 ? (
                  <ul>
                    {info.addresses.map((a) => (
                      <li key={`${a.iface}-${a.ip}`}>
                        <span className={`phone-pair-kind phone-pair-kind--${a.kind}`}>{kindLabel(a.kind)}</span>
                        <code>{a.ip}:{info.port}</code>
                        <span className="phone-pair-iface">{a.iface}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="phone-pair-warn">
                    No reachable network interfaces. Connect to Wi-Fi or start Tailscale.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Cloudflare Tunnel — public URL that works behind firewalls */}
          <div className="phone-pair-tunnel">
            <div className="field-label">Cloudflare Tunnel (works anywhere)</div>
            <p className="phone-pair-blurb">
              When LAN / Tailscale can't reach your Mac (work wifi blocks it, you're on cellular, etc.),
              start a Cloudflare Tunnel and pair through that — both devices connect outbound to Cloudflare,
              so no firewall needs to allow inbound. Quick tunnels are free; the URL changes each restart.
            </p>
            {!tunnel?.installed ? (
              <div className="phone-pair-tunnel-row">
                <span className="phone-pair-kind phone-pair-kind--public">Not installed</span>
                <code>brew install cloudflared</code>
                <span className="phone-pair-tunnel-hint">Install once, then come back here.</span>
              </div>
            ) : tunnel?.running && tunnel?.url ? (
              <div className="phone-pair-tunnel-row">
                <span className="phone-pair-kind phone-pair-kind--tunnel">Running</span>
                <code>{tunnel.url}</code>
                <div className="phone-pair-tunnel-actions">
                  <button
                    type="button"
                    onClick={pairViaTunnel}
                    disabled={!!pairing}
                  >
                    Pair via tunnel
                  </button>
                  <button type="button" onClick={stopTunnel} disabled={tunnelBusy}>Stop tunnel</button>
                </div>
              </div>
            ) : (
              <div className="phone-pair-tunnel-row">
                <span className="phone-pair-kind phone-pair-kind--lan">Stopped</span>
                <button
                  type="button"
                  className="primary"
                  onClick={startTunnel}
                  disabled={tunnelBusy}
                >
                  {tunnelBusy ? 'Starting…' : 'Start tunnel'}
                </button>
                {tunnel?.lastError && (
                  <span className="phone-pair-tunnel-hint phone-pair-tunnel-err">{tunnel.lastError}</span>
                )}
              </div>
            )}
          </div>

          {/* Push relay config */}
          <div className="phone-pair-push">
            <div className="field-label">Push relay (optional)</div>
            <p className="phone-pair-blurb">
              Wakes your phone when a session goes <code>waiting</code> or <code>error</code> while
              the iOS app is closed. Requires a Cloudflare Worker (free) and an APNs auth key.
              Setup steps: see <code>anthology-push-worker/README.md</code>.
            </p>
            <div className="phone-pair-push-status">
              {pushConfig?.pushConfigured ? (
                <span className="phone-pair-kind phone-pair-kind--tailscale">Configured</span>
              ) : (
                <span className="phone-pair-kind phone-pair-kind--public">Not configured</span>
              )}
              <span className="phone-pair-push-meta">
                {tokens.filter((t) => t.hasPush).length} of {tokens.length} paired devices registered for push
              </span>
            </div>
            <div className="phone-pair-push-form">
              <div className="field">
                <div className="field-label">Worker URL</div>
                <input
                  value={pushUrlDraft}
                  onChange={(e) => setPushUrlDraft(e.target.value)}
                  placeholder="https://anthology-push.your-subdomain.workers.dev"
                />
              </div>
              <div className="field">
                <div className="field-label">
                  Worker secret {pushConfig?.workerSecretSet ? '(set — leave blank to keep)' : ''}
                </div>
                <input
                  type="password"
                  value={pushSecretDraft}
                  onChange={(e) => setPushSecretDraft(e.target.value)}
                  placeholder={pushConfig?.workerSecretSet ? '••••••••' : 'paste WORKER_SECRET'}
                />
              </div>
              <div className="phone-pair-push-actions">
                <button
                  type="button"
                  onClick={savePushConfig}
                  disabled={pushSaving || !pushUrlDraft.trim() || (!pushConfig?.workerSecretSet && pushSecretDraft.length === 0)}
                >
                  {pushSaving ? 'Saving…' : 'Save'}
                </button>
                {pushConfig?.pushConfigured ? (
                  <button type="button" onClick={clearPushConfig} className="phone-pair-revoke">Clear</button>
                ) : null}
              </div>
            </div>
          </div>

          {/* Paired devices */}
          <div className="phone-pair-devices">
            <div className="field-label">Paired devices ({tokens.length})</div>
            {tokens.length === 0 ? (
              <div className="phone-pair-empty">No devices paired yet.</div>
            ) : (
              <ul className="phone-pair-token-list">
                {tokens.map((t) => (
                  <li key={t.id}>
                    <div className="phone-pair-token-info">
                      <div className="phone-pair-token-label">
                        {t.label}
                        {t.hasPush ? (
                          <span className="phone-pair-push-badge" title="Registered for push notifications">push</span>
                        ) : null}
                      </div>
                      <div className="phone-pair-token-meta">
                        Paired {fmtDate(t.createdAt)} · Last seen {fmtDate(t.lastUsedAt)}
                      </div>
                    </div>
                    <button type="button" className="phone-pair-revoke" onClick={() => revoke(t.id, t.label)}>
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <div className="hint">
            Bridge listening on port <code>{info.port}</code>
          </div>
          <div className="actions">
            {pairing ? (
              <button type="button" onClick={cancelPair}>Cancel pairing</button>
            ) : (
              <button type="button" className="primary" onClick={startPair}>Pair new device</button>
            )}
            <button type="button" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
