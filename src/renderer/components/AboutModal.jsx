import React from 'react';
import beeMark from '../assets/bee-mark.svg';

const REPO_URL = 'https://github.com/michaellomuscio/anthology';
const AUTHOR_URL = 'https://www.michaellomuscio.com';
const LICENSE_URL = 'https://github.com/michaellomuscio/anthology/blob/main/LICENSE';

const VERSION = '0.4.0';

export default function AboutModal({ onClose }) {
  const open = (href) => {
    try { window.open(href, '_blank', 'noopener,noreferrer'); }
    catch (_) {}
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal about-modal" onClick={(e) => e.stopPropagation()}>
        <div className="about-modal-body">
          <div className="about-mark">
            <img src={beeMark} alt="Anthology" />
          </div>
          <div className="about-title">Anthology</div>
          <div className="about-version">version {VERSION}</div>
          <div className="about-tagline">
            A native macOS app for orchestrating many Claude Code sessions at once.
          </div>
          <div className="about-meta">
            <div>
              Created by{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); open(AUTHOR_URL); }}>
                Lomuscio Labs
              </a>
            </div>
            <div>
              <a href="#" onClick={(e) => { e.preventDefault(); open(LICENSE_URL); }}>
                Apache License 2.0
              </a>
              {' · '}
              <a href="#" onClick={(e) => { e.preventDefault(); open(REPO_URL); }}>
                GitHub
              </a>
            </div>
          </div>
          <div className="about-companion">
            Companion projects: <a href="#" onClick={(e) => { e.preventDefault(); open('https://github.com/michaellomuscio/anthology-ios'); }}>iOS app</a>
            {' · '}
            <a href="#" onClick={(e) => { e.preventDefault(); open('https://github.com/michaellomuscio/anthology-push-worker'); }}>push relay</a>
          </div>
        </div>
        <div className="modal-footer">
          <div className="hint" />
          <div className="actions">
            <button type="button" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
