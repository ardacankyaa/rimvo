import { useEffect, useRef, useState } from 'react';
import { legalTitles, policies, policyVersion, type LegalPage } from './policies';
import { getRememberPreferences, setRememberPreferences } from './preference-storage';
import './legal.css';
import { BrandMark } from '../ui/BrandMark';
export interface LegalPanelProps { readonly page: LegalPage; readonly onClose: () => void }
export function LegalPanel({ page, onClose }: LegalPanelProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [remember, setRemember] = useState(getRememberPreferences);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    node.showModal();
    return () => node.close();
  }, []);
  return <dialog ref={dialog} className="legal-dialog" aria-labelledby="legal-title" lang="tr"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    } }}>
    <header className="legal-dialog__header">
      <div><span className="brand-caption"><BrandMark />RIMVO</span><h2 id="legal-title">{legalTitles[page]}</h2></div>
      <button type="button" aria-label="Kapat" onClick={onClose} autoFocus>×</button>
    </header>
    <div className="legal-dialog__body" tabIndex={0} aria-label={legalTitles[page] + ' metni'}>
      <p className="legal-dialog__date">Yerel açık kaynak sürüm · {policyVersion}</p>
      {policies[page].map(section => <section key={section.heading}>
        <h3>{section.heading}</h3>
        {section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
      </section>)}
      {page === 'cookies' && <fieldset className="legal-dialog__preference">
        <legend>Tema tercihi</legend>
        <label><input type="checkbox" checked={remember} onChange={event => {
          const requested = event.target.checked;
          const enabled = setRememberPreferences(requested, document.body.dataset.theme === 'light' ? 'light' : 'dark');
          setRemember(enabled); setStorageError(requested && !enabled);
        }} />Tema tercihimi bu cihazda hatırla</label>
        <p>İsteğe bağlı · 180 gün · İstediğin zaman kapatabilirsin.</p>
        {storageError && <p role="status">Tarayıcı bu tercihin saklanmasına izin vermedi. RIMVO’yu kullanmaya devam edebilirsin.</p>}
      </fieldset>}
      {page === 'terms' && <p className="legal-dialog__licenses">
        <a href={import.meta.env.BASE_URL + 'THIRD_PARTY_LICENSES.txt'} target="_blank" rel="noopener noreferrer">Üçüncü taraf lisansları (yeni sekme)</a>
        <a href={import.meta.env.BASE_URL + 'demo-tracks/LICENSE.txt'} target="_blank" rel="noopener noreferrer">Örnek parça lisansı (yeni sekme)</a>
      </p>}
    </div>
  </dialog>;
}

