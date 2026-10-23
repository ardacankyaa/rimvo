import { t, useLanguage } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { englishPolicies, hostingReferences, legalTitles, policies, policyVersion, type LegalPage } from './policies';
import { getRememberPreferences, setRememberPreferences } from './preference-storage';
import './legal.css';
import { BrandMark } from '../ui/BrandMark';
export interface LegalPanelProps { readonly page: LegalPage; readonly onClose: () => void }
export function LegalPanel({ page, onClose }: LegalPanelProps) {
  const language = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const [remember, setRemember] = useState(getRememberPreferences);
  const [storageError, setStorageError] = useState(false);
  const pageSections = (language === 'tr' ? policies : englishPolicies)[page];
  const hostingHeading = language === 'tr' ? 'İnternet ve barındırma' : 'Hosting and control';
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    node.showModal();
    return () => node.close();
  }, []);
  return <dialog ref={dialog} className="legal-dialog" aria-labelledby="legal-title" lang={language}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    } }}>
    <header className="legal-dialog__header">
      <div><span className="brand-caption"><BrandMark />{t("RIMVO")}</span><h2 id="legal-title">{t(legalTitles[page])}</h2></div>
      <button type="button" aria-label={t("Close")} onClick={onClose} autoFocus>×</button>
    </header>
    <div className="legal-dialog__body" tabIndex={0} aria-label={t(legalTitles[page]) + (language === 'tr' ? ' metni' : ' text')}>
      <p className="legal-dialog__date">RIMVO · {policyVersion}</p>
      {pageSections.map(section => <section key={section.heading}>
        <h3>{t(section.heading)}</h3>
        {section.paragraphs.map(paragraph => <p key={paragraph}>{t(paragraph)}</p>)}
        {page === 'privacy' && section.heading === hostingHeading && <p className="legal-dialog__licenses">
          {hostingReferences[language].map(reference => <a key={reference.href} href={reference.href} target="_blank" rel="noopener noreferrer">{reference.label}</a>)}
        </p>}
      </section>)}
      {page === 'cookies' && <fieldset className="legal-dialog__preference">
        <legend>{t("Theme preference")}</legend>
        <label><input type="checkbox" checked={remember} onChange={event => {
          const requested = event.target.checked;
          const enabled = setRememberPreferences(requested, document.body.dataset.theme === 'light' ? 'light' : 'dark');
          setRemember(enabled); setStorageError(requested && !enabled);
        }} />{t("Remember my theme on this device")}</label>
        <p>{t("Optional · 180 days · You can turn this off at any time.")}</p>
        {storageError && <p role="status">{t("The browser did not allow this preference to be stored. You can continue using RIMVO.")}</p>}
      </fieldset>}
      {page === 'terms' && <p className="legal-dialog__licenses">
        <a href={import.meta.env.BASE_URL + 'THIRD_PARTY_LICENSES.txt'} target="_blank" rel="noopener noreferrer">{t("Third-party licenses (new tab)")}</a>
        <a href={import.meta.env.BASE_URL + 'demo-tracks/LICENSE.txt'} target="_blank" rel="noopener noreferrer">{t("Demo track license (new tab)")}</a>
      </p>}
    </div>
  </dialog>;
}

